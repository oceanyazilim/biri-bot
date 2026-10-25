const dateFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** 25.10.2026 */
export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

/** 25.10.2026 14:03:12 */
export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

/** Discord dynamic timestamp, rendered in each viewer's local time. */
export function discordTimestamp(date: Date, style: 'f' | 'F' | 'R' | 'T' | 'd' = 'f'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

export function userMention(id: string | null | undefined): string {
  return id ? `<@${id}>` : '*Bilinmiyor*';
}

export function channelMention(id: string): string {
  return `<#${id}>`;
}

export function roleMention(id: string): string {
  return `<@&${id}>`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} saniye`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} dakika` : `${minutes} dakika ${rest} saniye`;
}

/** Truncates text to fit embed field limits. */
export function clip(text: string, max = 1024): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function yesNo(value: boolean): string {
  return value ? 'Evet' : 'Hayır';
}

export function onOff(value: boolean): string {
  return value ? '✅ Açık' : '⛔ Kapalı';
}

export function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
