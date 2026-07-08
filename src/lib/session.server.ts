import crypto from "node:crypto";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { query } from "./db.server";

const COOKIE_NAME = "parstalk_session";
const SESSION_DAYS = 30;

export function generateToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

export function getSessionTokenFromRequest(): string | null {
  try {
    return getCookie(COOKIE_NAME) ?? null;
  } catch {
    return null;
  }
}

export function setSessionCookie(token: string) {
  setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie() {
  setCookie(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
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
