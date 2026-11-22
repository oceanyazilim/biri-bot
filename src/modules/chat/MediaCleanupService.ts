import { ChannelType, PermissionFlagsBits, type Guild, type GuildTextBasedChannel, type Message } from 'discord.js';
import type { Logger } from '../../utils/logger';
import { TimerRegistry } from '../../utils/timers';

export interface MediaCleanupOptions {
  /** Channels to clean. Empty = channels named like "chat" / "sohbet". */
  channelIds: string[];
  delayMs: number;
}

const LINK_PATTERN = /\bhttps?:\/\/\S+|\bdiscord(?:\.gg|(?:app)?\.com\/invite)\/\S+/i;
/** Channel names (lower-cased, letters and digits only) treated as the chat channel when no ids are configured. */
const CHAT_CHANNEL_NAMES = new Set(['chat', 'sohbet', 'genelchat', 'genelsohbet', 'chatkanali', 'sohbetkanali']);
/** Discord only bulk-deletes messages younger than 14 days. */
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60_000;

export function normalizeChannelName(name: string): string {
  return name
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9çğöşü]/g, '');
}

/** Images, GIFs, videos, any file, and links (including GIF links from the picker). */
export function isMediaMessage(message: Pick<Message, 'content' | 'attachments' | 'embeds'>): boolean {
  if (message.attachments.size > 0) return true;
  if (message.embeds.some((embed) => embed.image || embed.video)) return true;
  return LINK_PATTERN.test(message.content);
}

/**
 * Removes images, GIFs and links from the chat channel a fixed time after they
 * were posted. Pending deletions live in memory; after a restart `sweepGuild`
 * catches up on messages that were posted before the bot went down.
 */
export class MediaCleanupService {
  private readonly timers: TimerRegistry;

  constructor(
    private readonly options: MediaCleanupOptions,
    private readonly logger: Logger,
  ) {
    this.timers = new TimerRegistry((key, error) => this.logger.warn({ err: error, key }, 'Medya temizleme zamanlayıcısı hata verdi'));
  }

  isCleanedChannel(channel: { id: string; name?: string; parentId?: string | null }): boolean {
    if (this.options.channelIds.length > 0) return this.options.channelIds.includes(channel.id);
    return typeof channel.name === 'string' && CHAT_CHANNEL_NAMES.has(normalizeChannelName(channel.name));
  }

  handleMessage(message: Message<true>): void {
    if (message.author.id === message.client.user.id) return;
    if (!this.isCleanedChannel(message.channel) || !isMediaMessage(message)) return;
    const age = Date.now() - message.createdTimestamp;
    this.schedule(message, this.options.delayMs - age);
  }

  private schedule(message: Message<true>, delayMs: number): void {
    this.timers.schedule(`media:${message.id}`, delayMs, async () => {
      if (message.pinned) return;
      await message.delete().catch((error: unknown) => this.logger.debug({ err: error, messageId: message.id }, 'Medya mesajı silinemedi'));
    });
  }

  /** Startup catch-up: deletes overdue media among the latest 100 messages and schedules the rest. */
  async sweepGuild(guild: Guild): Promise<void> {
    const me = guild.members.me;
    for (const channel of guild.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) continue;
      if (!this.isCleanedChannel(channel)) continue;
      if (!me || !channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ReadMessageHistory)) {
        this.logger.warn({ guildId: guild.id, channelId: channel.id }, 'Sohbet medya temizliği için Mesajları Yönet / Mesaj Geçmişini Oku yetkisi eksik');
        continue;
      }
      await this.sweepChannel(channel).catch((error: unknown) => this.logger.warn({ err: error, channelId: channel.id }, 'Sohbet kanalı taranamadı'));
    }
  }

  private async sweepChannel(channel: GuildTextBasedChannel): Promise<void> {
    const messages = await channel.messages.fetch({ limit: 100 });
    const now = Date.now();
    const overdue: Message<true>[] = [];
    for (const message of messages.values()) {
      if (message.author.id === channel.client.user.id || message.pinned || !isMediaMessage(message)) continue;
      const age = now - message.createdTimestamp;
      if (age >= this.options.delayMs) overdue.push(message);
      else this.schedule(message, this.options.delayMs - age);
    }
    const bulk = overdue.filter((m) => now - m.createdTimestamp < BULK_DELETE_MAX_AGE_MS);
    if (bulk.length > 1 && 'bulkDelete' in channel) await channel.bulkDelete(bulk, true);
    else for (const message of bulk) await message.delete().catch(() => undefined);
    for (const message of overdue.filter((m) => now - m.createdTimestamp >= BULK_DELETE_MAX_AGE_MS)) await message.delete().catch(() => undefined);
  }

  get pending(): number {
    return this.timers.size;
  }

  shutdown(): void {
    this.timers.cancelAll();
  }
}
