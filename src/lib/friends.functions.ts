import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db.server";
import { requireUser } from "./session.server";

export const listFriends = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const rows = await query<{
    id: number;
    username: string;
    status: "pending" | "accepted";
    direction: "incoming" | "outgoing";
    presence: string | null;
  }>(
    `SELECT
       CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END as id,
       u.username,
       f.status,
       CASE WHEN f.requester_id = ? THEN 'outgoing' ELSE 'incoming' END as direction,
       (SELECT p.status FROM presence p WHERE p.user_id = u.id AND p.last_ping > DATE_SUB(NOW(), INTERVAL 30 SECOND)) as presence
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
     WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status <> 'blocked'`,
    [user.id, user.id, user.id, user.id, user.id],
  );
  return rows;
});

export const addFriend = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ username: z.string().trim().min(3) }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const target = await query<{ id: number }>("SELECT id FROM users WHERE username = ?", [
      data.username,
    ]);
    if (!target[0]) throw new Error("USER_NOT_FOUND");
    if (target[0].id === user.id) throw new Error("SELF_FRIEND");
    await query(
      "INSERT IGNORE INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, 'pending')",
      [user.id, target[0].id],
    );
    return { ok: true };
  });

export const acceptFriend = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ friendId: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await query(
      "UPDATE friendships SET status='accepted' WHERE requester_id = ? AND addressee_id = ? AND status='pending'",
      [data.friendId, user.id],
    );
    return { ok: true };
  });

export const removeFriend = createServerFn({ method: "POST" })
  .validator((d: unknown) => z.object({ friendId: z.number().int() }).parse(d))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await query(
      `DELETE FROM friendships
       WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      [user.id, data.friendId, data.friendId, user.id],
    );
    return { ok: true };
  });
