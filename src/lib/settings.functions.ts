import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { query } from "./db.server";
import { requireUser } from "./session.server";

export const getMySettings = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const rows = await query<{ display_name: string | null; avatar_data: string | null }>(
    "SELECT display_name, avatar_data FROM user_settings WHERE user_id = ? LIMIT 1",
    [user.id],
  );
  return {
    displayName: rows[0]?.display_name ?? user.username,
    avatar: rows[0]?.avatar_data ?? null,
  };
});

export const saveAvatar = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        // data URL – capped at ~4MB base64 (~3MB original)
        avatar: z.string().max(4_500_000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await query(
      `INSERT INTO user_settings (user_id, display_name, avatar_data)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE avatar_data = VALUES(avatar_data)`,
      [user.id, user.username, data.avatar],
    );
    return { ok: true };
  });

export const saveDisplayName = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z.object({ displayName: z.string().trim().min(1).max(32) }).parse(d),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    await query(
      `INSERT INTO user_settings (user_id, display_name)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)`,
      [user.id, data.displayName],
    );
    return { ok: true };
  });
