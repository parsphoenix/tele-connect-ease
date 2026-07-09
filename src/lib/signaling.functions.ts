/**
 * MySQL-backed long-polling signaling for WebRTC.
 * Standalone Node/cPanel deployment can replace with WebSocket; API stays the same.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db.server";
import { requireUser } from "./session.server";

export const sendSignal = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        roomCode: z.string(),
        toUser: z.number().int(),
        payload: z.string().max(200000),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await query(
      "INSERT INTO signaling (room_code, from_user, to_user, payload) VALUES (?, ?, ?, ?)",
      [data.roomCode.toUpperCase(), user.id, data.toUser, data.payload],
    );
    return { ok: true };
  });

export const pollSignals = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ roomCode: z.string(), sinceId: z.number().int().default(0) }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    // heartbeat presence
    await query(
      `INSERT INTO presence (user_id, room_code, status) VALUES (?, ?, 'in_call')
       ON DUPLICATE KEY UPDATE room_code = VALUES(room_code), status = 'in_call', last_ping = NOW()`,
      [user.id, data.roomCode.toUpperCase()],
    );
    const rows = await query<{
      id: number;
      from_user: number;
      payload: string;
      created_at: Date;
    }>(
      `SELECT id, from_user, payload, created_at FROM signaling
       WHERE room_code = ? AND to_user = ? AND id > ?
       ORDER BY id ASC LIMIT 100`,
      [data.roomCode.toUpperCase(), user.id, data.sinceId],
    );
    // cleanup old signals >5 min
    await query("DELETE FROM signaling WHERE created_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE)");
    return rows;
  });

export const listActiveUsers = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ roomCode: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser();
    const rows = await query<{ user_id: number; username: string }>(
      `SELECT p.user_id, u.username FROM presence p
       JOIN users u ON u.id = p.user_id
       WHERE p.room_code = ? AND p.last_ping > DATE_SUB(NOW(), INTERVAL 15 SECOND)`,
      [data.roomCode.toUpperCase()],
    );
    return rows;
  });
