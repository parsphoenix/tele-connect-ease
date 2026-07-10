import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { query } from "./db.server";
import { requireUser } from "./session.server";

function makeCode(len = 6) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

/** Auto-clean rooms with no active members (older than 2 min) */
async function cleanupEmptyRooms() {
  await query(
    `DELETE r FROM rooms r
     LEFT JOIN room_members m ON m.room_id = r.id
     WHERE m.user_id IS NULL AND r.created_at < DATE_SUB(NOW(), INTERVAL 2 MINUTE)`,
  );
}

export const listPublicRooms = createServerFn({ method: "GET" }).handler(async () => {
  await requireUser();
  await cleanupEmptyRooms();
  const rows = await query<{
    id: number;
    code: string;
    name: string;
    owner: string;
    owner_id: number;
    member_count: number;
    max_users: number;
    has_password: number;
  }>(
    `SELECT r.id, r.code, r.name, u.username as owner, r.owner_id, r.max_users,
     (r.password_hash IS NOT NULL) as has_password,
     (SELECT COUNT(*) FROM room_members m WHERE m.room_id = r.id) as member_count
     FROM rooms r JOIN users u ON u.id = r.owner_id
     WHERE r.is_public = TRUE
     ORDER BY r.created_at DESC LIMIT 15`,
  );
  return rows;
});

export const createRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(64),
        isPublic: z.boolean().default(false),
        maxUsers: z.number().int().min(2).max(16).default(16),
        password: z.string().max(64).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const code = makeCode();
    const pwHash = data.password ? await bcrypt.hash(data.password, 10) : null;
    await query(
      "INSERT INTO rooms (code, name, owner_id, is_public, max_users, password_hash) VALUES (?, ?, ?, ?, ?, ?)",
      [code, data.name, user.id, data.isPublic, data.maxUsers, pwHash],
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
      has_password: number;
    }>(
      `SELECT id, code, name, owner_id, max_users, is_public, (password_hash IS NOT NULL) as has_password
       FROM rooms WHERE code = ? LIMIT 1`,
      [data.code.toUpperCase()],
    );
    if (!rows[0]) throw new Error("ROOM_NOT_FOUND");
    return rows[0];
  });

export const joinRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ code: z.string(), password: z.string().max(64).optional() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await query<{
      id: number;
      max_users: number;
      owner_id: number;
      password_hash: string | null;
    }>(
      "SELECT id, max_users, owner_id, password_hash FROM rooms WHERE code = ? LIMIT 1",
      [data.code.toUpperCase()],
    );
    const room = rows[0];
    if (!room) throw new Error("ROOM_NOT_FOUND");
    // Check ban
    const bans = await query<{ c: number }>(
      "SELECT COUNT(*) as c FROM room_bans WHERE room_id = ? AND user_id = ?",
      [room.id, user.id],
    );
    if ((bans[0]?.c ?? 0) > 0) throw new Error("BANNED");
    // Check password
    if (room.password_hash && room.owner_id !== user.id) {
      if (!data.password) throw new Error("PASSWORD_REQUIRED");
      const ok = await bcrypt.compare(data.password, room.password_hash);
      if (!ok) throw new Error("PASSWORD_INVALID");
    }
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
    return { ok: true, roomId: room.id, isOwner: room.owner_id === user.id };
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
      // If empty, delete room immediately
      const c = await query<{ c: number }>(
        "SELECT COUNT(*) as c FROM room_members WHERE room_id = ?",
        [rows[0].id],
      );
      if ((c[0]?.c ?? 0) === 0) {
        await query("DELETE FROM rooms WHERE id = ?", [rows[0].id]);
      }
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
    const rows = await query<{
      id: number;
      username: string;
      joined_at: Date;
      owner_id: number;
    }>(
      `SELECT u.id, u.username, m.joined_at, r.owner_id
       FROM room_members m JOIN rooms r ON r.id = m.room_id
       JOIN users u ON u.id = m.user_id
       WHERE r.code = ?
       ORDER BY m.joined_at ASC`,
      [data.code.toUpperCase()],
    );
    return rows;
  });

/** Owner-only: ban a user from the room (removes them & prevents rejoin) */
export const banFromRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ code: z.string(), userId: z.number().int() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await query<{ id: number; owner_id: number }>(
      "SELECT id, owner_id FROM rooms WHERE code = ? LIMIT 1",
      [data.code.toUpperCase()],
    );
    if (!rows[0]) throw new Error("ROOM_NOT_FOUND");
    if (rows[0].owner_id !== user.id) throw new Error("NOT_OWNER");
    if (rows[0].owner_id === data.userId) throw new Error("CANNOT_BAN_OWNER");
    await query(
      "INSERT IGNORE INTO room_bans (room_id, user_id) VALUES (?, ?)",
      [rows[0].id, data.userId],
    );
    await query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", [
      rows[0].id,
      data.userId,
    ]);
    return { ok: true };
  });

/** Owner-only: kick without permanent ban */
export const kickFromRoom = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ code: z.string(), userId: z.number().int() }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await query<{ id: number; owner_id: number }>(
      "SELECT id, owner_id FROM rooms WHERE code = ? LIMIT 1",
      [data.code.toUpperCase()],
    );
    if (!rows[0]) throw new Error("ROOM_NOT_FOUND");
    if (rows[0].owner_id !== user.id) throw new Error("NOT_OWNER");
    if (rows[0].owner_id === data.userId) throw new Error("CANNOT_KICK_OWNER");
    await query("DELETE FROM room_members WHERE room_id = ? AND user_id = ?", [
      rows[0].id,
      data.userId,
    ]);
    return { ok: true };
  });
