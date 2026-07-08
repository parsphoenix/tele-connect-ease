import crypto from "node:crypto";
import { getWebRequest, getHeaders, setHeader } from "@tanstack/react-start/server";
import { query } from "./db.server";

const COOKIE_NAME = "parstalk_session";
const SESSION_DAYS = 30;

export function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

function parseCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function getSessionTokenFromRequest(): string | null {
  try {
    const req = getWebRequest();
    if (req) return parseCookie(req.headers.get("cookie"), COOKIE_NAME);
  } catch {}
  try {
    const headers = getHeaders() as Record<string, string | undefined>;
    return parseCookie(headers.cookie, COOKIE_NAME);
  } catch {}
  return null;
}

export function setSessionCookie(token: string) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
  setHeader("set-cookie", cookie);
}

export function clearSessionCookie() {
  setHeader("set-cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function createSession(userId: number): Promise<string> {
  const token = generateToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000);
  await query("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)", [
    token,
    userId,
    expires,
  ]);
  return token;
}

export async function getSessionUser(): Promise<{
  id: number;
  username: string;
} | null> {
  const token = getSessionTokenFromRequest();
  if (!token) return null;
  const rows = await query<{ id: number; username: string; expires_at: Date }>(
    `SELECT u.id, u.username, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > NOW() LIMIT 1`,
    [token],
  );
  if (!rows[0]) return null;
  // sliding session: update last_seen
  await query("UPDATE users SET last_seen = NOW() WHERE id = ?", [rows[0].id]);
  return { id: rows[0].id, username: rows[0].username };
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function destroySession() {
  const token = getSessionTokenFromRequest();
  if (token) await query("DELETE FROM sessions WHERE token = ?", [token]);
  clearSessionCookie();
}
