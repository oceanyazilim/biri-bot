import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Client, ComponentEmojiResolvable } from 'discord.js';
import type { Logger } from '../utils/logger';

/**
 * Panel icons. Each one is a PNG in assets/emojis uploaded as an application
 * emoji (Developer Portal → Emojis), so it works in every server without
 * needing a server emoji slot. Until the upload succeeded, the Unicode
 * fallback is shown.
 */
export const PANEL_ICONS = {
  lock: { name: 'biri_lock', fallback: '🔒' },
  unlock: { name: 'biri_unlock', fallback: '🔓' },
  hide: { name: 'biri_hide', fallback: '🙈' },
  show: { name: 'biri_show', fallback: '👁️' },
  info: { name: 'biri_info', fallback: 'ℹ️' },
  kick: { name: 'biri_kick', fallback: '👢' },
  block: { name: 'biri_block', fallback: '⛔' },
  unblock: { name: 'biri_unblock', fallback: '✅' },
  allow: { name: 'biri_allow', fallback: '🎟️' },
  disallow: { name: 'biri_disallow', fallback: '🚫' },
  pull: { name: 'biri_pull', fallback: '🎯' },
  edit: { name: 'biri_edit', fallback: '✏️' },
  crown: { name: 'biri_crown', fallback: '👑' },
  trash: { name: 'biri_trash', fallback: '🗑️' },
  users: { name: 'biri_users', fallback: '👥' },
  infinity: { name: 'biri_infinity', fallback: '♾️' },
} as const;

export type PanelIcon = keyof typeof PANEL_ICONS;

const ASSET_DIR = path.resolve(__dirname, '..', '..', 'assets', 'emojis');
const uploaded = new Map<string, string>();

/** Emoji for a button or select option: the uploaded icon, or its Unicode fallback. */
export function icon(key: PanelIcon): ComponentEmojiResolvable {
  const { name, fallback } = PANEL_ICONS[key];
  const id = uploaded.get(name);
  return id ? { id, name } : fallback;
}

/** Inline form for embed text (`<:name:id>`), or the Unicode fallback. */
export function inlineIcon(key: PanelIcon): string {
  const { name, fallback } = PANEL_ICONS[key];
  const id = uploaded.get(name);
  return id ? `<:${name}:${id}>` : fallback;
}

/** Uploads missing icons as application emojis and remembers their ids. Never throws. */
export async function syncPanelIcons(client: Client<true>, logger: Logger): Promise<void> {
  try {
    const existing = await client.application.emojis.fetch();
    for (const emoji of existing.values()) if (emoji.name) uploaded.set(emoji.name, emoji.id);
    for (const { name } of Object.values(PANEL_ICONS)) {
      if (uploaded.has(name)) continue;
      const attachment = await readFile(path.join(ASSET_DIR, `${name}.png`));
      const emoji = await client.application.emojis.create({ attachment, name });
      uploaded.set(name, emoji.id);
    }
    logger.info({ icons: Object.keys(PANEL_ICONS).length }, 'Panel ikonları hazır');
  } catch (error) {
    logger.warn({ err: error }, 'Panel ikonları yüklenemedi; standart emojiler kullanılacak');
  }
}

/** Test helper. */
export function resetPanelIcons(): void {
  uploaded.clear();
}
