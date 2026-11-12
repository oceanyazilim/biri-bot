import { AuditLogEvent, PermissionFlagsBits, type EmbedBuilder, type Guild } from 'discord.js';
import { COLORS } from '../../config/constants';
import type { YargiRecord, YargiRepository } from '../../database/repositories/types';
import { describeError } from '../../utils/discordErrors';
import { clip, discordTimestamp, userLabel } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import { brandEmbed } from '../logging/embeds';

export type YargiTrigger = 'UNBAN' | 'JOIN';

/** How long after a ban removal its audit entry is still attributed to it. */
const UNBAN_AUDIT_WINDOW_MS = 30_000;

/**
 * Permanent bans issued with `.yargi`. A judged user stays banned until
 * `.unyargı`: when anyone lifts the ban another way (Discord menu, `/unban`,
 * another bot) or the user gets back in, Biri bans them again.
 */
export class YargiService {
  private logSink: ((guildId: string, embed: EmbedBuilder) => void) | null = null;
  /** Users currently being re-banned, so overlapping events act once. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly repo: YargiRepository,
    private readonly logger: Logger,
  ) {}

  setLogSink(sink: (guildId: string, embed: EmbedBuilder) => void): void {
    this.logSink = sink;
  }

  record(entry: { guildId: string; userId: string; userTag: string | null; moderatorId: string; reason: string | null }): Promise<void> {
    return this.repo.upsert(entry);
  }

  find(guildId: string, userId: string): Promise<YargiRecord | null> {
    return this.repo.find(guildId, userId);
  }

  list(guildId: string): Promise<YargiRecord[]> {
    return this.repo.list(guildId);
  }

  /** Removes the user from the list and returns the record that was removed. */
  async release(guildId: string, userId: string): Promise<YargiRecord | null> {
    const record = await this.repo.find(guildId, userId);
    if (record) await this.repo.remove(guildId, userId);
    return record;
  }

  /** Puts a removed record back, e.g. when lifting the ban failed afterwards. */
  restore(record: YargiRecord): Promise<void> {
    return this.repo.upsert(record);
  }

  /** Bans a judged user again. Returns whether a ban was issued. Never throws. */
  async enforce(guild: Guild, userId: string, trigger: YargiTrigger, userTag: string | null = null): Promise<boolean> {
    const key = `${guild.id}:${userId}`;
    if (this.inFlight.has(key)) return false;
    this.inFlight.add(key);
    try {
      const record = await this.repo.find(guild.id, userId);
      if (!record) return false;
      const tag = userTag ?? record.userTag;
      // Read before banning: the ban removal entry is what tells us who lifted it.
      const liftedBy = trigger === 'UNBAN' ? await this.unbanExecutor(guild, userId) : null;

      if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        this.report(guild, record, tag, trigger, liftedBy, "Biri'nin **Üyeleri Yasakla** yetkisi olmadığı için tekrar yasaklanamadı!");
        return false;
      }
      try {
        await guild.bans.create(userId, {
          reason: clip(`Yargı (kalıcı) — ilk karar ${record.moderatorId}: ${record.reason ?? 'Sebep belirtilmedi'}. Kaldırmak için .unyargı`, 512),
        });
      } catch (error) {
        this.logger.warn({ err: error, guildId: guild.id, userId }, 'Yargılı kullanıcı tekrar yasaklanamadı');
        this.report(guild, record, tag, trigger, liftedBy, `Tekrar yasaklanamadı: ${describeError(error)}`);
        return false;
      }
      await this.repo.incrementReban(guild.id, userId).catch(() => undefined);
      this.report(guild, { ...record, rebanCount: record.rebanCount + 1 }, tag, trigger, liftedBy, null);
      return true;
    } catch (error) {
      this.logger.error({ err: error, guildId: guild.id, userId }, 'Yargı kontrolü başarısız');
      return false;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async unbanExecutor(guild: Guild, userId: string): Promise<string | null> {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
    try {
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanRemove, limit: 5 });
      const entry = [...logs.entries.values()].find(
        (e) => e.targetId === userId && Date.now() - e.createdTimestamp < UNBAN_AUDIT_WINDOW_MS,
      );
      return entry?.executorId ?? null;
    } catch {
      return null;
    }
  }

  private report(guild: Guild, record: YargiRecord, tag: string | null, trigger: YargiTrigger, liftedBy: string | null, failure: string | null): void {
    const lines = [
      `**Kullanıcı:** ${userLabel(record.userId, tag)}`,
      trigger === 'UNBAN'
        ? `**Olay:** Yasağı kaldırıldı${liftedBy ? ` — kaldıran: ${userLabel(liftedBy)}` : ''}`
        : '**Olay:** Sunucuya tekrar katıldı',
      `**İlk karar:** ${userLabel(record.moderatorId)} • ${discordTimestamp(record.createdAt, 'f')}`,
      `**Sebep:** ${record.reason ?? 'Belirtilmedi'}`,
    ];
    if (!failure) lines.push(`**Tekrar yasaklanma:** ${record.rebanCount}. kez`);
    else lines.push(`❌ ${failure}`);
    lines.push('', 'Yargıyı yalnızca yetkili kişiler `.unyargı` ile kaldırabilir.');
    this.logSink?.(
      guild.id,
      brandEmbed(failure ? COLORS.warning : COLORS.critical)
        .setTitle(failure ? '⚠️ Yargılı Kullanıcı Yasaklanamadı' : '⚖️ Yargılı Kullanıcı Tekrar Yasaklandı')
        .setDescription(lines.join('\n')),
    );
  }
}
