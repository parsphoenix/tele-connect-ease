/**
 * Standalone Node.js server for cPanel Node.js Selector deployment.
 * Serves the built frontend (dist/) + provides WebSocket signaling + API + MySQL.
 *
 * Usage on cPanel:
 *   1. Setup Node.js app pointing to this file
 *   2. Run: npm install
 *   3. Copy .env.example to .env and fill in MySQL credentials
 *   4. Run migrations: node server/migrate.js
 *   5. Build frontend on your machine: bun run build && upload the output
 *   6. Start the app.
 */
import express from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { WebSocketServer } from "ws";
import mysql from "mysql2/promise";
import http from "node:http";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  ssl: process.env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
});

const app = express();
app.use(express.json({ limit: "1mb" }));

// Cookie helpers
function parseCookies(req) {
  const raw = req.headers.cookie || "";
  const out = {};
  raw.split(";").forEach((p) => {
    const [k, ...r] = p.trim().split("=");
    if (k) out[k] = decodeURIComponent(r.join("="));
  });
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=/`, `HttpOnly`, `SameSite=Lax`];
  if (opts.maxAge) parts.push(`Max-Age=${opts.maxAge}`);
  if (process.env.NODE_ENV === "production") parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

async function currentUser(req) {
  const token = parseCookies(req).parstalk_session;
  if (!token) return null;
  const [rows] = await pool.query(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token=? AND s.expires_at > NOW() LIMIT 1`,
    [token],
  );
  return rows[0] || null;
}
function requireUser(handler) {
  return async (req, res) => {
    const u = await currentUser(req);
    if (!u) return res.status(401).json({ error: "UNAUTHORIZED" });
    req.user = u;
    return handler(req, res);
  };
}

// --- Auth ---
app.post("/api/auth", async (req, res) => {
  try {
    const { username, password, captchaAnswer, captchaExpected } = req.body;
    if (Number(captchaAnswer) !== Number(captchaExpected))
      return res.status(400).json({ error: "CAPTCHA_INVALID" });
    if (!/^[a-zA-Z0-9_\u0600-\u06FF]{3,32}$/.test(username || ""))
      return res.status(400).json({ error: "INVALID_USERNAME" });
    const [rows] = await pool.query(
      "SELECT id, password_hash FROM users WHERE username=? LIMIT 1",
      [username],
    );
    let userId;
    if (rows[0]) {
      const ok = await bcrypt.compare(password, rows[0].password_hash);
      if (!ok) return res.status(401).json({ error: "INVALID_CREDENTIALS" });
      userId = rows[0].id;
    } else {
      const hash = await bcrypt.hash(password, 10);
      const [r] = await pool.query(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        [username, hash],
      );
      userId = r.insertId;
      await pool.query(
        "INSERT IGNORE INTO user_settings (user_id, display_name) VALUES (?, ?)",
        [userId, username],
      );
    }
    const token = crypto.randomBytes(48).toString("hex");
    const expires = new Date(Date.now() + 30 * 86400 * 1000);
    await pool.query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
      token,
      userId,
      expires,
    ]);
    setCookie(res, "parstalk_session", token, { maxAge: 30 * 86400 });
    res.json({ userId, username });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "SERVER_ERROR" });
  }
});

app.get("/api/me", async (req, res) => {
  res.json(await currentUser(req));
});
app.post("/api/logout", async (req, res) => {
  const token = parseCookies(req).parstalk_session;
  if (token) await pool.query("DELETE FROM sessions WHERE token=?", [token]);
  setCookie(res, "parstalk_session", "", { maxAge: 0 });
  res.json({ ok: true });
});

// --- Rooms ---
app.get("/api/rooms", requireUser(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.id, r.code, r.name, u.username as owner, r.max_users,
     (SELECT COUNT(*) FROM room_members m WHERE m.room_id=r.id) as member_count
     FROM rooms r JOIN users u ON u.id=r.owner_id
     WHERE r.is_public=TRUE ORDER BY r.created_at DESC LIMIT 50`,
  );
  res.json(rows);
}));
app.post("/api/rooms", requireUser(async (req, res) => {
  const { name, isPublic = true, maxUsers = 16 } = req.body;
  const alpha = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => alpha[Math.floor(Math.random() * alpha.length)]).join("");
  await pool.query(
    "INSERT INTO rooms (code, name, owner_id, is_public, max_users) VALUES (?, ?, ?, ?, ?)",
    [code, name, req.user.id, isPublic, Math.min(16, Math.max(2, maxUsers))],
  );
  res.json({ code });
}));

// --- ICE ---
app.get("/api/ice", (req, res) => {
  const servers = [{ urls: "stun:stun.l.google.com:19302" }];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }
  res.json(servers);
});

// --- Serve frontend (built dist) ---
const distDir = path.join(ROOT, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return res.status(404).end();
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  console.warn("dist/ folder not found. Run `bun run build` and upload the output.");
}

// --- HTTP + WebSocket signaling ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

/** roomCode -> Map<userId, ws> */
const rooms = new Map();

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, "http://x");
  const token = parseCookies(req).parstalk_session;
  const roomCode = (url.searchParams.get("room") || "").toUpperCase();
  if (!token || !roomCode) return ws.close(1008, "auth");
  const [rows] = await pool.query(
    "SELECT u.id, u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>NOW()",
    [token],
  );
  const user = rows[0];
  if (!user) return ws.close(1008, "auth");
  if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
  const room = rooms.get(roomCode);
  room.set(user.id, ws);

  const others = Array.from(room.keys()).filter((id) => id !== user.id);
  ws.send(JSON.stringify({ type: "peers", users: others.map((id) => ({ id, username: (room.get(id)?._username) || String(id) })) }));
  ws._username = user.username;
  for (const [id, sock] of room) {
    if (id !== user.id && sock.readyState === 1) {
      sock.send(JSON.stringify({ type: "join", id: user.id, username: user.username }));
    }
  }
  ws.on("message", (buf) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg.to && room.has(msg.to)) {
        const target = room.get(msg.to);
        if (target.readyState === 1) {
          target.send(JSON.stringify({ type: "signal", from: user.id, payload: msg.payload }));
        }
      }
    } catch {}
  });
  ws.on("close", () => {
    room.delete(user.id);
    for (const [, sock] of room) {
      if (sock.readyState === 1) sock.send(JSON.stringify({ type: "leave", id: user.id }));
    }
    if (room.size === 0) rooms.delete(roomCode);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`ParsTalk server on :${PORT}`);
});
