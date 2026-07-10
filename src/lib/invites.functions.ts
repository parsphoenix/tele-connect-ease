import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db.server";
import { requireUser } from "./session.server";

/** Send room invite to a friend (uses signaling table as generic message channel; roomCode="_INV_") */
export const sendInvite = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        toUser: z.number().int(),
        roomCode: z.string().min(3).max(16),
        message: z.string().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const payload = JSON.stringify({
      type: "invite",
      roomCode: data.roomCode.toUpperCase(),
      from: user.username,
      message: data.message ?? "",
    });
    await query(
      "INSERT INTO signaling (room_code, from_user, to_user, payload) VALUES (?, ?, ?, ?)",
      ["_INV_", user.id, data.toUser, payload],
    );
    return { ok: true };
  });

/** Poll pending invites for the current user (independent of any room) */
export const pollInvites = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ sinceId: z.number().int().default(0) }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await query<{ id: number; from_user: number; payload: string }>(
      `SELECT id, from_user, payload FROM signaling
       WHERE room_code = '_INV_' AND to_user = ? AND id > ?
       ORDER BY id ASC LIMIT 20`,
      [user.id, data.sinceId],
    );
    return rows;
  });
