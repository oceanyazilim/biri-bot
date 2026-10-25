import { embedLength, type APIEmbed, type Client, type EmbedBuilder, type MessageMentionOptions } from 'discord.js';
import { COLORS, type LogChannelKind } from '../../config/constants';
import type { Logger } from '../../utils/logger';
import { brandEmbed } from './embeds';

interface QueuedLog {
  embed: APIEmbed;
}

interface ChannelQueue {
  guildId: string;
  kind: LogChannelKind;
  items: QueuedLog[];
  dropped: number;
}

export interface ChannelResolver {
  getChannelId(guildId: string, kind: LogChannelKind): Promise<string | null>;
}

const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_MESSAGE_EMBED_CHARS = 5_800;
const MAX_QUEUE_PER_CHANNEL = 50;

/**
 * Rate-limited delivery of log embeds. Routine logs are batched (up to 10 embeds
 * per message) and flushed periodically; when a queue overflows the excess is
 * summarized instead of spamming the channel. Security records are always
 * persisted in the database before reaching this class, so dropping a Discord
 * message never loses data.
 */
export class LogDispatcher {
  private readonly queues = new Map<string, ChannelQueue>();
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;

  constructor(
    private readonly client: Client,
    private readonly resolver: ChannelResolver,
    private readonly logger: Logger,
    private readonly flushIntervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush();
  }

  /** Queues a routine log embed. */
  enqueue(guildId: string, kind: LogChannelKind, embed: EmbedBuilder): void {
    const key = `${guildId}:${kind}`;
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { guildId, kind, items: [], dropped: 0 };
      this.queues.set(key, queue);
    }
    if (queue.items.length >= MAX_QUEUE_PER_CHANNEL) {
      queue.dropped++;
      return;
    }
    queue.items.push({ embed: embed.toJSON() });
  }

  /** Sends immediately (critical incident reports, alerts with mentions). Returns whether delivery succeeded. */
  async sendNow(
    guildId: string,
    kind: LogChannelKind,
    embeds: EmbedBuilder[],
    options: { content?: string; allowedMentions?: MessageMentionOptions } = {},
  ): Promise<boolean> {
    const channel = await this.resolveChannel(guildId, kind);
    if (!channel) return false;
    try {
      await channel.send({
        content: options.content,
        embeds: embeds.slice(0, MAX_EMBEDS_PER_MESSAGE),
        allowedMentions: options.allowedMentions ?? { parse: [] },
      });
      return true;
    } catch (error) {
      this.logger.warn({ err: error, guildId, kind }, 'Log mesajı gönderilemedi');
      return false;
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const [key, queue] of this.queues) {
        if (queue.items.length === 0 && queue.dropped === 0) {
          this.queues.delete(key);
          continue;
        }
        await this.flushQueue(queue);
      }
    } finally {
      this.flushing = false;
    }
  }

  private async flushQueue(queue: ChannelQueue): Promise<void> {
    const batch: APIEmbed[] = [];
    let chars = 0;
    while (queue.items.length > 0 && batch.length < MAX_EMBEDS_PER_MESSAGE) {
      const next = queue.items[0];
      if (!next) break;
      const size = embedLength(next.embed);
      if (batch.length > 0 && chars + size > MAX_MESSAGE_EMBED_CHARS) break;
      queue.items.shift();
      batch.push(next.embed);
      chars += size;
    }
    if (queue.dropped > 0 && batch.length < MAX_EMBEDS_PER_MESSAGE) {
      batch.push(
        brandEmbed(COLORS.warning)
          .setTitle('📦 Kayıtlar Özetlendi')
          .setDescription(
            `Yoğun aktivite nedeniyle **${queue.dropped}** kayıt bu kanala tek tek gönderilmedi.\n` +
              'Tüm güvenlik olayları veritabanında saklanmaya devam ediyor (`/guard-olaylar`).',
          )
          .toJSON(),
      );
      queue.dropped = 0;
    }
    if (batch.length === 0) return;

    const channel = await this.resolveChannel(queue.guildId, queue.kind);
    if (!channel) {
      queue.items.length = 0;
      return;
    }
    try {
      await channel.send({ embeds: batch, allowedMentions: { parse: [] } });
    } catch (error) {
      this.logger.warn({ err: error, guildId: queue.guildId, kind: queue.kind }, 'Toplu log gönderimi başarısız');
    }
  }

  private async resolveChannel(guildId: string, kind: LogChannelKind) {
    const channelId = (await this.resolver.getChannelId(guildId, kind)) ?? (await this.resolver.getChannelId(guildId, 'GENERAL'));
    if (!channelId) return null;
    const channel = this.client.channels.cache.get(channelId) ?? (await this.client.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return null;
    return channel;
  }
}
