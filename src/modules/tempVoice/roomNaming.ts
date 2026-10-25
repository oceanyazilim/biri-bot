import { DISCORD_CHANNEL_NAME_MAX, TEMP_VOICE_ROOM_PREFIX } from '../../config/constants';

const BACK_VOWELS_UNROUNDED = new Set(['a', 'ı']);
const FRONT_VOWELS_UNROUNDED = new Set(['e', 'i']);
const BACK_VOWELS_ROUNDED = new Set(['o', 'u']);
const FRONT_VOWELS_ROUNDED = new Set(['ö', 'ü']);
const ALL_VOWELS = new Set([...BACK_VOWELS_UNROUNDED, ...FRONT_VOWELS_UNROUNDED, ...BACK_VOWELS_ROUNDED, ...FRONT_VOWELS_ROUNDED]);

const ROOM_WORD = 'Odası';

/** Removes control characters and collapses whitespace. */
export function sanitizeName(raw: string): string {
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, (char) => (char === '‍' ? char : ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Truncates by code points so emoji and Turkish characters are never split. */
export function truncateCodePoints(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join('').trimEnd();
}

/**
 * Builds the Turkish genitive ("-ın/-in/-un/-ün", with buffer "n" after vowels)
 * following vowel harmony, e.g. Emirhan → Emirhan'ın, Ahmet → Ahmet'in,
 * Ayşe → Ayşe'nin. Returns null when the name has no usable Turkish vowel.
 */
export function turkishGenitive(name: string): string | null {
  const chars = Array.from(name);
  const lastChar = chars[chars.length - 1];
  if (!lastChar || !/[\p{L}\p{N}]/u.test(lastChar)) return null;

  const lower = name.toLocaleLowerCase('tr-TR');
  const lowerChars = Array.from(lower);
  let lastVowel: string | undefined;
  for (let i = lowerChars.length - 1; i >= 0; i--) {
    const char = lowerChars[i];
    if (char && ALL_VOWELS.has(char)) {
      lastVowel = char;
      break;
    }
  }
  if (!lastVowel) return null;

  const endsWithVowel = ALL_VOWELS.has(lowerChars[lowerChars.length - 1] ?? '');
  let vowel: string;
  if (BACK_VOWELS_UNROUNDED.has(lastVowel)) vowel = 'ı';
  else if (FRONT_VOWELS_UNROUNDED.has(lastVowel)) vowel = 'i';
  else if (BACK_VOWELS_ROUNDED.has(lastVowel)) vowel = 'u';
  else vowel = 'ü';

  return `${name}'${endsWithVowel ? 'n' : ''}${vowel}n`;
}

/** "🔊・Emirhan'ın Odası", always within Discord's channel name limit. */
export function buildRoomName(displayName: string): string {
  const clean = sanitizeName(displayName) || 'Kullanıcı';
  const fixedLength = Array.from(TEMP_VOICE_ROOM_PREFIX).length + ` ${ROOM_WORD}`.length + 5; // 5 = longest suffix "'nın"+1
  const name = truncateCodePoints(clean, DISCORD_CHANNEL_NAME_MAX - fixedLength);
  const possessive = turkishGenitive(name);
  const body = possessive ? `${possessive} ${ROOM_WORD}` : `${name} ${ROOM_WORD}`;
  return truncateCodePoints(`${TEMP_VOICE_ROOM_PREFIX}${body}`, DISCORD_CHANNEL_NAME_MAX);
}

export type RoomNameValidation = { ok: true; name: string } | { ok: false; reason: string };

/** Validates a user supplied room name for /isim and the settings modal. */
export function validateCustomRoomName(raw: string): RoomNameValidation {
  const clean = sanitizeName(raw);
  if (clean.length === 0) return { ok: false, reason: 'Oda adı boş olamaz.' };
  if (/(discord\.gg|discord(app)?\.com\/invite)\//i.test(clean)) {
    return { ok: false, reason: 'Oda adında davet bağlantısı kullanılamaz.' };
  }
  const withPrefix = clean.startsWith(TEMP_VOICE_ROOM_PREFIX) ? clean : `${TEMP_VOICE_ROOM_PREFIX}${clean}`;
  if (Array.from(withPrefix).length > DISCORD_CHANNEL_NAME_MAX) {
    return { ok: false, reason: `Oda adı en fazla ${DISCORD_CHANNEL_NAME_MAX - Array.from(TEMP_VOICE_ROOM_PREFIX).length} karakter olabilir.` };
  }
  return { ok: true, name: withPrefix };
}
