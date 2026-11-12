export interface ParsedPrefixCommand {
  name: string;
  args: string[];
}

/**
 * `.yargi 123 sebep` → { name: 'yargi', args: ['123', 'sebep'] }. Returns null for non-commands.
 * Names are folded so `.yargı`, `.YARGI` and `.yargi` are the same command.
 */
export function parsePrefixCommand(content: string, prefix: string): ParsedPrefixCommand | null {
  if (!content.startsWith(prefix)) return null;
  const rest = content.slice(prefix.length);
  // A space right after the prefix ("... ve sonra") is ordinary text, not a command.
  if (rest.length === 0 || /^\s/.test(rest)) return null;
  const parts = rest.split(/\s+/).filter(Boolean);
  const name = parts.shift()!.toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
  return { name, args: parts };
}

/** Accepts a user mention (`<@id>` / `<@!id>`) or a raw snowflake. */
export function parseUserId(token: string | undefined): string | null {
  if (!token) return null;
  const match = /^<@!?(\d{17,20})>$/.exec(token) ?? /^(\d{17,20})$/.exec(token);
  return match?.[1] ?? null;
}
