import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db.server";
import { requireUser } from "./session.server";

function makeCode(len = 6) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export const listPublicRooms = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  const rows = await query<{
    id: number;
    code: string;
    name: string;
    owner: string;
    member_count: number;
    max_users: number;
  }>(
    `SELECT r.id, r.code, r.name, u.username as owner, r.max_users,
     (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) as member_count
     FROM rooms r JOIN users u ON u.id = r.owner_id
     WHERE r.is_public = TRUE
     ORDER BY r.created_at DESC LIMIT 50`,
  );
  return rows;
});

export const createRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(64),
        isPublic: z.boolean().default(true),
        maxUsers: z.number().int().min(2).max(16).default(16),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const code = makeCode();
    await query(
      "INSERT INTO rooms (code, name, owner_id, is_public, max_users) VALUES (?, ?, ?, ?, ?)",
      [code, data.name, user.id, data.isPublic, data.maxUsers],
    );
    return { code };
  });

export const getRoom = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ code: z.string().min(3).max(16) }).parse(d))
  .handler(async ({ data }) => {
    await requireUser();
    const rows = await query<{
      id: number;
      code: string;
      name: string;
      owner_id: number;
      max_users: number;
      is_public: number;
    }>("SELECT id, code, name, owner_id, max_users, is_public FROM rooms WHERE code = ? LIMIT 1", [
      data.code.toUpperCase(),
    ]);
    if (!rows[0]) throw new Error("ROOM_NOT_FOUND");
    return rows[0];
  });

export const joinRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await query<{ id: number; max_users: number }>(
      "SELECT id, max_users FROM rooms WHERE code = ? LIMIT 1",
      [data.code.toUpperCase()],
    );
    const room = rows[0];
    if (!room) throw new Error("ROOM_NOT_FOUND");
    const count = await query<{ c: number }>(
      "SELECT COUNT(*) as c FROM room_members WHERE room_id = ?",
      [room.id],
    );
    if ((count[0]?.c ?? 0) >= room.max_users) throw new Error("ROOM_FULL");
    await query(
      "INSERT INTO room_members (room_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE joined_at = NOW()",
      [room.id, user.id],
    );
    await query(
      `INSERT INTO presence (user_id, room_code, status) VALUES (?, ?, 'in_call')
       ON DUPLICATE KEY UPDATE room_code = VALUES(room_code), status = 'in_call'`,
      [user.id, data.code.toUpperCase()],
    );
    return { ok: true, roomId: room.id };
  });

export const leaveRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await query<{ id: number }>("SELECT id FROM rooms WHERE code = ? LIMIT 1", [
      data.code.toUpperCase(),
    ]);
    if (rows[0]) {
      await query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", [
        rows[0].id,
        user.id,
      ]);
    }
    await query(
      `INSERT INTO presence (user_id, room_code, status) VALUES (?, NULL, 'online')
       ON DUPLICATE KEY UPDATE room_code = NULL, status = 'online'`,
      [user.id],
    );
    return { ok: true };
  });

export const listRoomMembers = createServerFn({ method: "GET" })
  .validator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data }) => {
    await requireUser();
    const rows = await query<{ id: number; username: string; joined_at: Date }>(
      `SELECT u.id, u.username, m.joined_at
       FROM room_members m JOIN rooms r ON r.id = m.room_id
       JOIN users u ON u.id = m.user_id
       WHERE r.code = ?
       ORDER BY m.joined_at ASC`,
      [data.code.toUpperCase()],
    );
    return rows;
  });
