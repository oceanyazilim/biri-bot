import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildBasedChannel,
  type OverwriteResolvable,
  type TextChannel,
} from 'discord.js';
import {
  COLORS,
  LOG_CATEGORY_NAME,
  LOG_CHANNEL_NAMES,
  LOG_CHANNEL_TOPICS,
  LOG_RECOVERY_MAX,
  LOG_RECOVERY_WINDOW_MS,
  type LogChannelKind,
  type LogStructureKind,
} from '../../config/constants';
import type { GuardRepository, LogChannelConfig, LogChannelRepository } from '../../database/repositories/types';
import type { SelfActionRegistry } from '../../services/SelfActionRegistry';
import { KeyedMutex } from '../../utils/async';
import { describeError } from '../../utils/discordErrors';
import { channelMention, formatDateTime } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import { TimerRegistry } from '../../utils/timers';
import { brandEmbed } from './embeds';
import type { ChannelResolver, LogDispatcher } from './LogDispatcher';

export interface EnsureResult {
  created: LogStructureKind[];
  reused: LogStructureKind[];
  failed: Array<{ kind: LogStructureKind; reason: string }>;
}

const RECOVERY_DELAY_MS = 3_000;

/**
 * Creates, reuses and recovers Biri's protected log category and channels.
 * Channel IDs are persisted so restarts never create duplicates.
 */
export class LogChannelService implements ChannelResolver {
  private readonly cache = new Map<string, Map<LogStructureKind, LogChannelConfig>>();
  private readonly mutex = new KeyedMutex();
  private readonly recoveryTimers: TimerRegistry;
  private dispatcher: LogDispatcher | null = null;

  constructor(
    private readonly repo: LogChannelRepository,
    private readonly guardRepo: GuardRepository,
    private readonly selfActions: SelfActionRegistry,
    private readonly logger: Logger,
  ) {
    this.recoveryTimers = new TimerRegistry((key, error) => this.logger.error({ err: error, key }, 'Log kanalı kurtarma hatası'));
  }

  attachDispatcher(dispatcher: LogDispatcher): void {
    this.dispatcher = dispatcher;
  }

  private async load(guildId: string): Promise<Map<LogStructureKind, LogChannelConfig>> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const rows = await this.repo.list(guildId);
    const map = new Map<LogStructureKind, LogChannelConfig>();
    for (const row of rows) map.set(row.kind as LogStructureKind, row);
    this.cache.set(guildId, map);
    return map;
  }

  async getChannelId(guildId: string, kind: LogChannelKind): Promise<string | null> {
    try {
      return (await this.load(guildId)).get(kind)?.channelId ?? null;
    } catch (error) {
      this.logger.warn({ err: error, guildId }, 'Log kanalı yapılandırması okunamadı');
      return null;
    }
  }

  /** Returns the log structure kind for a channel id, or null when it is not a Biri log channel. */
  async kindOf(guildId: string, channelId: string): Promise<LogStructureKind | null> {
    const map = await this.load(guildId);
    for (const [kind, row] of map) if (row.channelId === channelId) return kind;
    return null;
  }

  async isConfigured(guildId: string): Promise<boolean> {
    return (await this.load(guildId)).size > 0;
  }

  missingPermissions(guild: Guild): string[] {
    const me = guild.members.me;
    if (!me) return ['Bot üyesi bulunamadı'];
    const missing: string[] = [];
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) missing.push('Kanalları Yönet');
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) missing.push('Rolleri Yönet');
    if (!me.permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('Kanalları Görüntüle');
    if (!me.permissions.has(PermissionFlagsBits.SendMessages)) missing.push('Mesaj Gönder');
    if (!me.permissions.has(PermissionFlagsBits.EmbedLinks)) missing.push('Bağlantı Yerleştir');
    return missing;
  }

  private overwrites(guild: Guild): OverwriteResolvable[] {
    const botId = guild.members.me?.id ?? guild.client.user.id;
    return [
      { id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: botId,
        type: OverwriteType.Member,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ];
  }

  /**
   * Ensures the category and requested log channels exist. Existing channels
   * (by stored id, then by name inside the category) are reused.
   */
  ensureStructure(guild: Guild, kinds: readonly LogChannelKind[]): Promise<EnsureResult> {
    return this.mutex.run(`ensure:${guild.id}`, () => this.ensureStructureLocked(guild, kinds));
  }

  private async ensureStructureLocked(guild: Guild, kinds: readonly LogChannelKind[]): Promise<EnsureResult> {
    const result: EnsureResult = { created: [], reused: [], failed: [] };
    const map = await this.load(guild.id);

    const category = await this.ensureCategory(guild, map, result);
    if (!category) return result;

    for (const kind of kinds) {
      try {
        const existing = await this.existingChannel(guild, map.get(kind)?.channelId);
        if (existing && existing.type === ChannelType.GuildText) {
          if (existing.parentId !== category.id) {
            this.selfActions.register(guild.id, 'CHANNEL_UPDATE', existing.id);
            await existing.setParent(category.id, { lockPermissions: true });
          }
          result.reused.push(kind);
          continue;
        }
        const byName = category.children.cache.find(
          (child): child is TextChannel => child.type === ChannelType.GuildText && child.name === LOG_CHANNEL_NAMES[kind],
        );
        if (byName) {
          map.set(kind, await this.repo.upsert(guild.id, kind, byName.id));
          result.reused.push(kind);
          continue;
        }
        const channel = await guild.channels.create({
          name: LOG_CHANNEL_NAMES[kind],
          type: ChannelType.GuildText,
          parent: category.id,
          topic: LOG_CHANNEL_TOPICS[kind],
          permissionOverwrites: this.overwrites(guild),
          reason: 'Biri log kanalı kurulumu',
        });
        this.selfActions.register(guild.id, 'CHANNEL_CREATE', channel.id);
        map.set(kind, await this.repo.upsert(guild.id, kind, channel.id));
        result.created.push(kind);
      } catch (error) {
        this.logger.warn({ err: error, guildId: guild.id, kind }, 'Log kanalı oluşturulamadı');
        result.failed.push({ kind, reason: describeError(error) });
      }
    }
    return result;
  }

  private async ensureCategory(
    guild: Guild,
    map: Map<LogStructureKind, LogChannelConfig>,
    result: EnsureResult,
  ): Promise<CategoryChannel | null> {
    try {
      const stored = await this.existingChannel(guild, map.get('CATEGORY')?.channelId);
      if (stored && stored.type === ChannelType.GuildCategory) {
        result.reused.push('CATEGORY');
        return stored;
      }
      const byName = guild.channels.cache.find(
        (channel): channel is CategoryChannel => channel.type === ChannelType.GuildCategory && channel.name === LOG_CATEGORY_NAME,
      );
      if (byName) {
        map.set('CATEGORY', await this.repo.upsert(guild.id, 'CATEGORY', byName.id));
        result.reused.push('CATEGORY');
        return byName;
      }
      const category = await guild.channels.create({
        name: LOG_CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: this.overwrites(guild),
        reason: 'Biri güvenlik log kategorisi',
      });
      this.selfActions.register(guild.id, 'CHANNEL_CREATE', category.id);
      map.set('CATEGORY', await this.repo.upsert(guild.id, 'CATEGORY', category.id));
      result.created.push('CATEGORY');
      return category;
    } catch (error) {
      this.logger.warn({ err: error, guildId: guild.id }, 'Log kategorisi oluşturulamadı');
      result.failed.push({ kind: 'CATEGORY', reason: describeError(error) });
      return null;
    }
  }

  private async existingChannel(guild: Guild, channelId: string | undefined): Promise<GuildBasedChannel | null> {
    if (!channelId) return null;
    return guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  }

  /**
   * Called for every deleted channel. When it is one of Biri's log channels the
   * deletion is recorded and a rate-limited recovery is scheduled.
   */
  async handleChannelDeleted(guild: Guild, channelId: string, channelName: string): Promise<void> {
    if (this.selfActions.isSelfAction(guild.id, 'CHANNEL_DELETE', channelId)) return;
    const kind = await this.kindOf(guild.id, channelId);
    if (!kind) return;

    await this.guardRepo
      .recordEvent({
        guildId: guild.id,
        module: 'SYSTEM',
        eventType: 'LOG_CHANNEL_DELETED',
        auditEntryId: null,
        executorId: null,
        executorVerified: false,
        targetId: channelId,
        targetType: 'CHANNEL',
        targetName: channelName,
        details: JSON.stringify({ kind }),
        severity: 'HIGH',
        actionTaken: 'LOGGED',
        actionSucceeded: null,
        occurredAt: new Date(),
      })
      .catch((error: unknown) => this.logger.error({ err: error, guildId: guild.id }, 'Log kanalı silme olayı kaydedilemedi'));

    const row = (await this.load(guild.id)).get(kind);
    if (!row) return;
    const now = Date.now();
    const windowStart = row.recoveryWindowStart?.getTime() ?? 0;
    const inWindow = now - windowStart < LOG_RECOVERY_WINDOW_MS;
    const count = inWindow ? row.recoveryCount : 0;
    if (count >= LOG_RECOVERY_MAX) {
      this.logger.warn({ guildId: guild.id, kind }, 'Log kanalı kurtarma sınırına ulaşıldı; yeniden oluşturulmuyor');
      this.dispatcher?.enqueue(
        guild.id,
        'SYSTEM',
        brandEmbed(COLORS.critical)
          .setTitle('⚙️ Log Kanalı Kurtarma Durduruldu')
          .setDescription(
            `\`${channelName}\` kanalı kısa sürede tekrar tekrar silindi. Döngüyü önlemek için otomatik kurtarma durduruldu.\n` +
              'Kanalları yeniden oluşturmak için `/guard-kur` komutunu kullanın.',
          ),
      );
      return;
    }
    const nextWindowStart = inWindow && row.recoveryWindowStart ? row.recoveryWindowStart : new Date(now);
    row.recoveryCount = count + 1;
    row.recoveryWindowStart = nextWindowStart;
    await this.repo.updateRecovery(row.id, row.recoveryCount, nextWindowStart).catch(() => undefined);

    // Wait briefly so the recovery does not race an ongoing mass deletion, then rebuild.
    this.recoveryTimers.schedule(`recover:${guild.id}`, RECOVERY_DELAY_MS, async () => {
      const kinds = [...(await this.load(guild.id)).keys()].filter((k): k is LogChannelKind => k !== 'CATEGORY');
      const ensured = await this.ensureStructure(guild, kinds);
      if (ensured.created.length === 0) return;
      const target = await this.getChannelId(guild.id, 'SYSTEM');
      this.dispatcher?.enqueue(
        guild.id,
        'SYSTEM',
        brandEmbed(COLORS.warning)
          .setTitle('⚙️ Log Kanalı Kurtarıldı')
          .setDescription(
            `Silinen log yapısı yeniden oluşturuldu: **${ensured.created.join(', ')}**\n` +
              `Zaman: ${formatDateTime(new Date())}${target ? `\nSistem kanalı: ${channelMention(target)}` : ''}`,
          ),
      );
    });
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  shutdown(): void {
    this.recoveryTimers.cancelAll();
  }
}
