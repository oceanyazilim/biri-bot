import {
  AuditLogEvent,
  PermissionFlagsBits,
  type Guild,
  type GuildAuditLogsEntry,
  type GuildBan,
  type GuildMember,
  type NonThreadGuildBasedChannel,
  type PartialGuildMember,
  type Role,
} from 'discord.js';
import { LOG_CHANNEL_KINDS, PRIVILEGED_ROLE_MASK } from '../../config/constants';
import type { GuardRepository } from '../../database/repositories/types';
import type { SelfActionRegistry, SelfActionType } from '../../services/SelfActionRegistry';
import type { GuardModule, TargetType } from '../../types/guard';
import type { Logger } from '../../utils/logger';
import type { EnsureResult, LogChannelService } from '../logging/LogChannelService';
import type { AuditLogCorrelator, AuditLogSource } from './attribution/AuditLogCorrelator';
import type { AuditEntryLike } from './detectors';
import type { GuardConfigService } from './GuardConfigService';
import type { SecurityEventProcessor } from './SecurityEventProcessor';

interface FallbackMeta {
  module: GuardModule;
  eventType: string;
  targetType: TargetType;
  targetName: string | null;
  selfType: SelfActionType | null;
  /** A missing audit entry is expected and harmless (e.g. a voluntary leave is not a kick). */
  ignoreWhenMissing?: boolean;
}

export function auditSource(guild: Guild): AuditLogSource {
  return {
    id: guild.id,
    canViewAuditLog: () => Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)),
    fetchEntries: async (action, limit) => {
      const logs = await guild.fetchAuditLogs({ type: action, limit });
      return [...logs.entries.values()] as unknown as AuditEntryLike[];
    },
  };
}

/**
 * Entry point for Guard-related gateway events. Audit log entries are the
 * primary signal; gateway events only trigger a correlation fallback when the
 * matching entry did not arrive.
 */
export class GuardService {
  constructor(
    private readonly processor: SecurityEventProcessor,
    private readonly correlator: AuditLogCorrelator,
    private readonly config: GuardConfigService,
    private readonly repo: GuardRepository,
    private readonly logChannels: LogChannelService,
    private readonly selfActions: SelfActionRegistry,
    private readonly logger: Logger,
    private readonly sourceFor: (guild: Guild) => AuditLogSource = auditSource,
  ) {}

  async onAuditLogEntry(guild: Guild, entry: GuildAuditLogsEntry): Promise<void> {
    const like = entry as unknown as AuditEntryLike;
    this.correlator.ingest(guild.id, like);
    await this.processor.processAuditEntry(guild, like, 'GATEWAY_AUDIT');
  }

  onChannelDelete(channel: NonThreadGuildBasedChannel): Promise<void> {
    return this.fallback(channel.guild, AuditLogEvent.ChannelDelete, channel.id, {
      module: 'CHANNEL_DELETE',
      eventType: 'CHANNEL_DELETE',
      targetType: 'CHANNEL',
      targetName: channel.name,
      selfType: 'CHANNEL_DELETE',
    });
  }

  onChannelCreate(channel: NonThreadGuildBasedChannel): Promise<void> {
    return this.fallback(channel.guild, AuditLogEvent.ChannelCreate, channel.id, {
      module: 'CHANNEL_CREATE',
      eventType: 'CHANNEL_CREATE',
      targetType: 'CHANNEL',
      targetName: channel.name,
      selfType: 'CHANNEL_CREATE',
    });
  }

  onRoleDelete(role: Role): Promise<void> {
    return this.fallback(role.guild, AuditLogEvent.RoleDelete, role.id, {
      module: 'ROLE_DELETE',
      eventType: 'ROLE_DELETE',
      targetType: 'ROLE',
      targetName: role.name,
      selfType: null,
    });
  }

  onRoleCreate(role: Role): Promise<void> {
    // Integration roles are created by Discord when a bot joins; BOT_ADD covers those.
    if (role.managed) return Promise.resolve();
    return this.fallback(role.guild, AuditLogEvent.RoleCreate, role.id, {
      module: 'ROLE_CREATE',
      eventType: 'ROLE_CREATE',
      targetType: 'ROLE',
      targetName: role.name,
      selfType: null,
    });
  }

  onBanAdd(ban: GuildBan): Promise<void> {
    return this.fallback(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, {
      module: 'MEMBER_BAN',
      eventType: 'MEMBER_BAN',
      targetType: 'USER',
      targetName: ban.user.tag,
      selfType: null,
    });
  }

  /** Member removals are only kicks when a MemberKick audit entry exists. */
  onMemberRemove(member: GuildMember | PartialGuildMember): Promise<void> {
    if (member.id === member.client.user.id) return Promise.resolve();
    return this.fallback(member.guild, AuditLogEvent.MemberKick, member.id, {
      module: 'MEMBER_KICK',
      eventType: 'MEMBER_KICK',
      targetType: 'USER',
      targetName: member.user?.tag ?? null,
      selfType: null,
      ignoreWhenMissing: true,
    });
  }

  private async fallback(guild: Guild, action: AuditLogEvent, targetId: string, meta: FallbackMeta): Promise<void> {
    const observedAt = Date.now();
    if (meta.selfType && this.selfActions.isSelfAction(guild.id, meta.selfType, targetId)) return;
    try {
      const settings = await this.config.get(guild.id);
      if (!settings.enabled || !settings.modules[meta.module].enabled) return;
    } catch {
      return;
    }

    const result = await this.correlator.correlate(this.sourceFor(guild), action, targetId, observedAt);
    if (result.status === 'MATCHED') {
      await this.processor.processAuditEntry(guild, result.entry, result.source);
      return;
    }
    if (meta.ignoreWhenMissing && result.status === 'NOT_FOUND') return;
    // Biri may have registered the action while we were waiting.
    if (meta.selfType && this.selfActions.isSelfAction(guild.id, meta.selfType, targetId)) return;

    await this.processor.processUnattributed(guild, {
      module: meta.module,
      eventType: meta.eventType,
      targetId,
      targetType: meta.targetType,
      targetName: meta.targetName,
      attributionFailure: result.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : result.reason,
      occurredAt: new Date(observedAt),
    });
  }

  /** /guard-kur: creates the protected log structure and enables Guard (mode unchanged). */
  async setup(guild: Guild, actorId: string): Promise<{ logs: EnsureResult; warnings: string[] }> {
    const logs = await this.logChannels.ensureStructure(guild, LOG_CHANNEL_KINDS);
    await this.config.ensureModules(guild.id);
    const current = await this.config.get(guild.id);
    await this.config.update(guild.id, {
      enabled: true,
      mode: current.mode,
      activatedById: actorId,
      activatedAt: new Date(),
    });
    return { logs, warnings: this.diagnose(guild) };
  }

  /** Permission and hierarchy problems that would stop Guard from working. */
  diagnose(guild: Guild): string[] {
    const me = guild.members.me;
    if (!me) return ['Bot üyesi sunucuda bulunamadı.'];
    const warnings: string[] = [];
    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      warnings.push('**Denetim Kaydını Görüntüle** yetkisi yok: sorumlu kişiler belirlenemez ve hiçbir otomatik yaptırım uygulanmaz.');
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      warnings.push('**Rolleri Yönet** yetkisi yok: Aktif modda rol alma ve rol iadesi yapılamaz.');
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      warnings.push('**Kanalları Yönet** yetkisi yok: log kanalları oluşturulamaz ve kurtarılamaz.');
    }
    const botTop = me.roles.highest.position;
    const above = guild.roles.cache.filter(
      (role) => role.id !== guild.id && !role.managed && role.position >= botTop && (role.permissions.bitfield & PRIVILEGED_ROLE_MASK) !== 0n,
    );
    if (above.size > 0) {
      warnings.push(
        `Botun rolünün üzerinde veya aynı seviyesinde **${above.size}** yetkili rol var. Bu rollere yaptırım uygulanamaz; Biri rolünü rol listesinde olabildiğince yukarı taşıyın.`,
      );
    }
    return warnings;
  }

  /** Retention cleanup and memory sweeps. */
  async maintenance(guilds: Iterable<Guild>): Promise<void> {
    this.processor.tracker.sweep();
    for (const guild of guilds) {
      try {
        const settings = await this.config.get(guild.id);
        const before = new Date(Date.now() - settings.logRetentionDays * 24 * 60 * 60 * 1000);
        const purged = await this.repo.purgeBefore(guild.id, before);
        if (purged > 0) this.logger.info({ guildId: guild.id, purged }, 'Eski güvenlik kayıtları temizlendi');
      } catch (error) {
        this.logger.warn({ err: error, guildId: guild.id }, 'Kayıt saklama temizliği başarısız');
      }
    }
  }
}
