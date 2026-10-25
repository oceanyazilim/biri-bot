export interface ParsedPrefixCommand {
  name: string;
  args: string[];
}

/** `.ban @user sebep` → { name: 'ban', args: ['@user', 'sebep'] }. Returns null for non-commands. */
export function parsePrefixCommand(content: string, prefix: string): ParsedPrefixCommand | null {
  if (!content.startsWith(prefix)) return null;
  const parts = content.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  // Command names are ASCII; a Turkish locale would turn `KICK` into `kıck`.
  const name = parts.shift()?.toLowerCase();
  if (!name) return null;
  return { name, args: parts };
}

/** Accepts a user mention (`<@id>` / `<@!id>`) or a raw snowflake. */
export function parseUserId(token: string | undefined): string | null {
  if (!token) return null;
  const match = /^<@!?(\d{17,20})>$/.exec(token) ?? /^(\d{17,20})$/.exec(token);
  return match?.[1] ?? null;
}
