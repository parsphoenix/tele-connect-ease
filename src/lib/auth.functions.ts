import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { query } from "./db.server";
import {
  createSession,
  destroySession,
  getSessionUser,
  setSessionCookie,
} from "./session.server";

const authSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_\u0600-\u06FF]+$/),
  password: z.string().min(4).max(128),
  captchaAnswer: z.number().int(),
  captchaExpected: z.number().int(),
});

export const loginOrRegister = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => authSchema.parse(d))
  .handler(async ({ data }) => {
    if (data.captchaAnswer !== data.captchaExpected) {
      throw new Error("CAPTCHA_INVALID");
    }
    const existing = await query<{ id: number; password_hash: string }>(
      "SELECT id, password_hash FROM users WHERE username = ? LIMIT 1",
      [data.username],
    );
    let userId: number;
    if (existing[0]) {
      const ok = await bcrypt.compare(data.password, existing[0].password_hash);
      if (!ok) throw new Error("INVALID_CREDENTIALS");
      userId = existing[0].id;
    } else {
      const hash = await bcrypt.hash(data.password, 10);
      const result = (await query("INSERT INTO users (username, password_hash) VALUES (?, ?)", [
        data.username,
        hash,
      ])) as unknown as { insertId: number };
      // mysql2 returns ResultSetHeader from .query, our helper flattened rows —
      // re-query for id to be safe
      const row = await query<{ id: number }>("SELECT id FROM users WHERE username = ?", [
        data.username,
      ]);
      userId = row[0]?.id ?? result.insertId;
      await query(
        "INSERT IGNORE INTO user_settings (user_id, display_name) VALUES (?, ?)",
        [userId, data.username],
      );
    }
    const token = await createSession(userId);
    setSessionCookie(token);
    return { userId, username: data.username };
  });

export const me = createServerFn({ method: "GET" }).handler(async () => {
  return await getSessionUser();
});

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  await destroySession();
  return { ok: true };
});
