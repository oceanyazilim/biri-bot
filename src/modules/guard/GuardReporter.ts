import type { EmbedBuilder, Guild } from 'discord.js';
import {
  COLORS,
  MODE_LABELS,
  MODULE_INCIDENT_TITLES,
  MODULE_LABELS,
  MODULE_LOG_CHANNEL,
  SEVERITY_COLORS,
  SEVERITY_LABELS,
} from '../../config/constants';
import type { GuardRepository } from '../../database/repositories/types';
import type { GuardModule, GuardSettings, NormalizedSecurityEvent, Severity } from '../../types/guard';
import { severityRank } from '../../types/guard';
import { BoundedTtlMap } from '../../utils/collections';
import { clip, formatDate, formatDateTime, roleMention, userMention } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import { brandEmbed } from '../logging/embeds';
import type { LogDispatcher } from '../logging/LogDispatcher';
import type { PolicyDecision } from './policies/ProtectionPolicy';
import type { IncidentOutcome } from './enforcement/IncidentManager';

const EVENT_TYPE_LABELS: Record<string, string> = {
  CHANNEL_DELETE: 'Kanal Silindi',
  CHANNEL_CREATE: 'Kanal Oluşturuldu',
  EVERYONE_CHANNEL_OVERWRITE_ESCALATED: '@everyone için Tehlikeli Kanal İzni',
  ROLE_DELETE: 'Rol Silindi',
  ROLE_CREATE: 'Rol Oluşturuldu',
  ROLE_CREATED_WITH_DANGEROUS_PERMISSIONS: 'Tehlikeli Yetkili Rol Oluşturuldu',
  ROLE_PERMISSIONS_ESCALATED: 'Role Tehlikeli Yetki Verildi',
  EVERYONE_PERMISSIONS_ESCALATED: '@everyone Rolüne Tehlikeli Yetki Verildi',
  PRIVILEGED_ROLE_GRANTED: 'Üyeye Yetkili Rol Verildi',
  TRUSTED_ROLE_GRANTED: 'Üyeye Güvenilir Rol Verildi',
  MEMBER_BAN: 'Üye Yasaklandı',
  MEMBER_KICK: 'Üye Atıldı',
  MEMBER_PRUNE: 'Üye Temizliği (Prune)',
  WEBHOOK_CREATE: 'Webhook Oluşturuldu',
  WEBHOOK_UPDATE: 'Webhook Düzenlendi',
  WEBHOOK_DELETE: 'Webhook Silindi',
  BOT_ADD: 'Bot Eklendi',
  UNKNOWN_BOT_ADDED: 'Bilinmeyen Bot Eklendi',
  TRUSTED_BOT_ADDED: 'Güvenilir Bot Eklendi',
  GUILD_UPDATE: 'Sunucu Ayarı Değişti',
};

const COUNT_LABELS: Record<GuardModule, string> = {
  CHANNEL_DELETE: 'Silinen Kanal Sayısı',
  CHANNEL_CREATE: 'Oluşturulan Kanal Sayısı',
  ROLE_DELETE: 'Silinen Rol Sayısı',
  ROLE_CREATE: 'Oluşturulan Rol Sayısı',
  PERMISSION_ESCALATION: 'Tehlikeli Değişiklik Sayısı',
  MEMBER_BAN: 'Yasaklanan Üye Sayısı',
  MEMBER_KICK: 'Atılan Üye Sayısı',
  WEBHOOK: 'Webhook İşlem Sayısı',
  BOT_ADD: 'Eklenen Bot Sayısı',
  GUILD_UPDATE: 'Ayar Değişikliği Sayısı',
};

const ACTION_LABELS: Record<string, string> = {
  NONE: 'Yok',
  LOGGED: 'Yalnızca Kayıt',
  ALERTED: 'Yöneticiler Uyarıldı',
  ROLES_STRIPPED: 'Yönetilebilir Roller Alındı',
  PARTIAL: 'Rollerin Bir Kısmı Alındı',
  FAILED: 'Rol Alma Başarısız',
  ESCALATED: 'Yöneticilere İletildi (Yaptırım Uygulanamadı)',
};

const EXEMPTION_LABELS: Record<string, string> = {
  OWNER: 'Sunucu sahibi (kalıcı muafiyet)',
  TRUSTED_USER: 'Güvenilir kullanıcı',
  TRUSTED_ROLE: 'Güvenilir role sahip',
  TRUSTED_BOT: 'Güvenilir bot',
  TRUST_CHECK_FAILED: 'Güven listesi okunamadı — güvenlik için yaptırım durduruldu',
};

export function eventTypeLabel(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export interface EventReport {
  event: NormalizedSecurityEvent;
  severity: Severity;
  decision: PolicyDecision;
  count: number;
  spanSec: number;
  exemption: string | null;
  settings: GuardSettings;
}

/** Builds Guard embeds and routes them to the right log channels. */
export class GuardReporter {
  private readonly alertCooldown = new BoundedTtlMap<string, true>(10_000, 30_000);

  constructor(
    private readonly dispatcher: LogDispatcher,
    private readonly repo: GuardRepository,
    private readonly logger: Logger,
  ) {}

  private targetText(event: NormalizedSecurityEvent): string {
    const name = event.targetName ? `**${clip(event.targetName, 80)}**` : null;
    switch (event.targetType) {
      case 'USER':
        return event.targetId ? `${userMention(event.targetId)} (\`${event.targetId}\`)` : '*Bilinmiyor*';
      case 'ROLE':
        return [name, event.targetId ? `\`${event.targetId}\`` : null].filter(Boolean).join(' ') || '*Bilinmiyor*';
      case 'GUILD':
        return 'Sunucu';
      default:
        return [name, event.targetId ? `\`${event.targetId}\`` : null].filter(Boolean).join(' ') || '*Bilinmiyor*';
    }
  }

  private executorText(event: NormalizedSecurityEvent): string {
    if (!event.executorId) return '❔ *Doğrulanamadı*';
    return `${userMention(event.executorId)} (\`${event.executorId}\`)${event.executorVerified ? '' : ' — ❔ doğrulanmadı'}`;
  }

  eventEmbed(report: EventReport): EmbedBuilder {
    const { event, severity, decision } = report;
    const embed = brandEmbed(SEVERITY_COLORS[severity])
      .setTitle(`${severityRank(severity) >= severityRank('HIGH') ? '🚨' : '📝'} ${eventTypeLabel(event.eventType)}`)
      .addFields(
        { name: 'İşlemi Yapan', value: this.executorText(event), inline: true },
        { name: 'Hedef', value: this.targetText(event), inline: true },
        { name: 'Risk Seviyesi', value: SEVERITY_LABELS[severity], inline: true },
      );
    if (event.executorVerified && report.count > 1) {
      embed.addFields({
        name: COUNT_LABELS[event.module],
        value: `${report.count} (${report.settings.modules[event.module].windowSec} sn pencere)`,
        inline: true,
      });
    }
    const permissions = event.details.permissions;
    if (Array.isArray(permissions) && permissions.length > 0) {
      embed.addFields({ name: 'Verilen Yetkiler', value: clip(permissions.join(', ')), inline: false });
    }
    const changes = event.details.changes;
    if (Array.isArray(changes) && changes.length > 0) {
      const lines = (changes as Array<{ label: string; old: unknown; new: unknown }>).map(
        (change) => `• **${change.label}**: \`${String(change.old ?? '—')}\` → \`${String(change.new ?? '—')}\``,
      );
      embed.addFields({ name: 'Değişiklikler', value: clip(lines.join('\n')), inline: false });
    }
    if (report.exemption) embed.addFields({ name: 'Muafiyet', value: EXEMPTION_LABELS[report.exemption] ?? report.exemption, inline: true });
    if (!event.executorVerified) {
      embed.addFields({
        name: 'Doğrulama',
        value: '❔ Sorumlu kişi denetim kaydından güvenilir şekilde belirlenemedi. **Otomatik yaptırım uygulanmadı.**',
      });
    }
    embed.addFields({
      name: 'Kaynak',
      value: `${event.auditEntryId ? `Denetim kaydı \`${event.auditEntryId}\`` : 'Gateway olayı'} • ${formatDateTime(event.occurredAt)}`,
    });
    if (decision.reason === 'AUTO_STRIP_DISABLED') {
      embed.setDescription('Eşik aşıldı ancak bu modülde otomatik rol alma kapalı.');
    }
    return embed;
  }

  /** Routine event log + (rate-limited) guard alert for high-risk events. */
  reportEvent(guild: Guild, report: EventReport): void {
    const embed = this.eventEmbed(report);
    this.dispatcher.enqueue(guild.id, MODULE_LOG_CHANNEL[report.event.module], embed);
    if (!report.decision.notify || report.decision.openIncident) return;
    const key = `${guild.id}:${report.event.executorId ?? 'unknown'}:${report.event.module}`;
    if (this.alertCooldown.has(key)) return;
    this.alertCooldown.set(key, true);
    this.dispatcher.enqueue(guild.id, 'GUARD', this.eventEmbed(report));
  }

  incidentEmbed(outcome: IncidentOutcome, report: EventReport): EmbedBuilder {
    const success = outcome.action === 'ROLES_STRIPPED';
    const statusText =
      outcome.action === 'ROLES_STRIPPED'
        ? '✅ Koruma Başarılı'
        : outcome.action === 'PARTIAL'
          ? '⚠️ Kısmen Başarılı'
          : outcome.action === 'FAILED' || outcome.action === 'ESCALATED'
            ? '❌ Yaptırım Uygulanamadı — Manuel Müdahale Gerekli'
            : outcome.action === 'ALERTED'
              ? '📣 Uyarı Modu — Yaptırım Uygulanmadı'
              : '👁️ İzleme Modu — Yalnızca Kayıt';

    const embed = brandEmbed(success ? COLORS.critical : SEVERITY_COLORS[report.severity])
      .setTitle('🚨 Biri Guard — Şüpheli İşlem Algılandı')
      .addFields(
        { name: 'İşlem', value: MODULE_INCIDENT_TITLES[report.event.module], inline: true },
        { name: 'İşlemi Yapan', value: this.executorText(report.event), inline: true },
        { name: COUNT_LABELS[report.event.module], value: String(report.count), inline: true },
        { name: 'Süre', value: `${Math.max(1, report.spanSec)} saniye`, inline: true },
        { name: 'Risk Seviyesi', value: SEVERITY_LABELS[report.severity], inline: true },
        { name: 'Koruma Modu', value: MODE_LABELS[report.settings.mode], inline: true },
        { name: 'Uygulanan İşlem', value: actionLabel(outcome.action), inline: true },
        { name: 'Tarih', value: formatDate(report.event.occurredAt), inline: true },
        { name: 'Durum', value: statusText, inline: true },
      );

    if (outcome.removedRoles.length > 0) {
      embed.addFields({ name: `Alınan Roller (${outcome.removedRoles.length})`, value: clip(outcome.removedRoles.map((r) => `${roleMention(r.roleId)} \`${r.roleName}\``).join('\n')) });
    }
    if (outcome.failedRoles.length > 0) {
      embed.addFields({
        name: `Alınamayan Roller (${outcome.failedRoles.length})`,
        value: clip(outcome.failedRoles.map((r) => `${roleMention(r.roleId)} — ${r.reason}`).join('\n')),
      });
    }
    if (outcome.reason) embed.addFields({ name: 'Açıklama', value: clip(outcome.reason) });
    if (outcome.persistenceFailed && outcome.snapshotRoleIds.length > 0) {
      embed.addFields({
        name: '⚠️ Veritabanı Yedeği',
        value: clip(`Olay veritabanına yazılamadı. Alınan rol kimlikleri:\n${outcome.snapshotRoleIds.join(', ')}`),
      });
    }
    embed.addFields({
      name: 'Olay Kimliği',
      value: `${outcome.incidentId ? `\`${outcome.incidentId}\`` : '—'}${report.event.auditEntryId ? ` • Denetim kaydı \`${report.event.auditEntryId}\`` : ''}`,
    });
    if (outcome.action === 'ROLES_STRIPPED' || outcome.action === 'PARTIAL') {
      embed.setFooter({ text: `Biri • Rolleri geri vermek için: /guard-iade` });
    }
    return embed;
  }

  /** Critical incident report: sent immediately, mentions configured responders, optionally DMs the owner. */
  async reportIncident(guild: Guild, outcome: IncidentOutcome, report: EventReport): Promise<void> {
    const embed = this.incidentEmbed(outcome, report);
    const mentionRoles = report.settings.notifyRoleIds;
    const mentionOwner = report.settings.notifyOwner && report.decision.notify;
    const content = report.decision.notify
      ? [mentionOwner ? userMention(guild.ownerId) : null, ...mentionRoles.map(roleMention)].filter(Boolean).join(' ') || undefined
      : undefined;

    const delivered = await this.dispatcher.sendNow(guild.id, 'GUARD', [embed], {
      content,
      allowedMentions: { users: mentionOwner ? [guild.ownerId] : [], roles: mentionRoles },
    });
    this.dispatcher.enqueue(guild.id, MODULE_LOG_CHANNEL[report.event.module], this.eventEmbed(report));

    if (report.settings.notifyOwner && report.decision.notify && severityRank(report.severity) >= severityRank('CRITICAL')) {
      try {
        const owner = await guild.fetchOwner();
        await owner.send({ content: `🛡️ **${guild.name}** sunucusunda kritik bir güvenlik olayı algılandı.`, embeds: [embed] });
      } catch (error) {
        this.logger.debug({ err: error, guildId: guild.id }, 'Sunucu sahibine DM gönderilemedi');
      }
    }
    if (!delivered) this.logger.warn({ guildId: guild.id, incidentId: outcome.incidentId }, 'Olay raporu Discord’a iletilemedi; veritabanında saklandı');
  }

  /** Records a sensitive Guard configuration change both in the database and the system log. */
  async recordConfigChange(guild: Guild, actorId: string, summary: string, details: Record<string, unknown> = {}): Promise<void> {
    await this.repo
      .recordEvent({
        guildId: guild.id,
        module: 'CONFIG',
        eventType: 'GUARD_CONFIG_CHANGED',
        auditEntryId: null,
        executorId: actorId,
        executorVerified: true,
        targetId: guild.id,
        targetType: 'GUILD',
        targetName: null,
        details: JSON.stringify({ summary, ...details }),
        severity: 'MEDIUM',
        actionTaken: 'LOGGED',
        actionSucceeded: null,
        occurredAt: new Date(),
      })
      .catch((error: unknown) => this.logger.error({ err: error, guildId: guild.id }, 'Yapılandırma değişikliği kaydedilemedi'));
    this.dispatcher.enqueue(
      guild.id,
      'SYSTEM',
      brandEmbed(COLORS.warning).setTitle('⚙️ Guard Yapılandırması Değişti').setDescription(`${userMention(actorId)}: ${summary}`),
    );
  }

  moduleLabel(module: GuardModule): string {
    return MODULE_LABELS[module];
  }
}
