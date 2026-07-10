/** Chat helper utilities: emojis, autolink, VAD threshold. */

export const EMOJIS = [
  "😀", "😂", "😍", "😎", "😢", "😡", "👍", "👎",
  "❤️", "🔥", "🎉", "🙏", "👀", "💯", "😴",
];

/** Split text into linkified tokens for safe rendering. */
export function linkify(text: string): Array<{ type: "text" | "link"; value: string }> {
  const re = /(https?:\/\/[^\s<>"']+)/g;
  const out: Array<{ type: "text" | "link"; value: string }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ type: "text", value: text.slice(last, i) });
    out.push({ type: "link", value: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

export const CHAT_MAX_CHARS = 100;
export const CHAT_RATE_MS = 1500;
export const POKE_COOLDOWN_MS = 60_000;
export const AFK_TIMEOUT_MS = 5 * 60_000;
export const CHAT_PAGE_SIZE = 30;
