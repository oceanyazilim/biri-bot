import {
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type EmbedBuilder,
  type Guild,
  type GuildMember,
  type NewsChannel,
  type TextChannel,
  type User,
} from 'discord.js';
import { COLORS } from '../../config/constants';
import { describeError, discordErrorCode } from '../../utils/discordErrors';
import { clip, formatDuration, userLabel, userMention } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import type { SecurityEventProcessor } from '../guard/SecurityEventProcessor';
import { brandEmbed } from '../logging/embeds';
import type { SelfActionRegistry } from '../../services/SelfActionRegistry';

export type ModerationAction = 'BAN' | 'KICK' | 'UNBAN';

export interface ModerationResult {
  ok: boolean;
  message: string;
  /** The action was stopped because Guard sanctioned the moderator. */
  blockedByGuard?: boolean;
}

interface ActionSpec {
  permission: bigint;
  permissionLabel: string;
  module: 'MEMBER_BAN' | 'MEMBER_KICK';
  verb: string;
  past: string;
  emoji: string;
}

const ACTIONS: Record<Exclude<ModerationAction, 'UNBAN'>, ActionSpec> = {
  BAN: { permission: PermissionFlagsBits.BanMembers, permissionLabel: 'Üyeleri Yasakla', module: 'MEMBER_BAN', verb: 'yasaklayamazsın', past: 'sunucudan yasaklandı', emoji: '🔨' },
  KICK: { permission: PermissionFlagsBits.KickMembers, permissionLabel: 'Üyeleri At', module: 'MEMBER_KICK', verb: 'atamazsın', past: 'sunucudan atıldı', emoji: '👢' },
};

const ENFORCED = new Set(['ROLES_STRIPPED', 'PARTIAL', 'FAILED', 'ESCALATED']);

/** Role position alone grants nothing; the permission itself must be enabled on Biri's role. */
const botPermissionHint = (label: string, channel = false): string =>
  `Biri'nin **${label}** yetkisi yok${channel ? ' (bu kanalda)' : ''}.
` +
  `Rolün en üstte olması yetmez, iznin kendisi açık olmalı: **Sunucu Ayarları → Roller → Biri → ${label}** iznini açın` +
  `${channel ? ' ve kanal izinlerinde Biri için kapatılmadığından emin olun' : ''}, ya da botu güncel davet bağlantısıyla yeniden ekleyin.`;

const fail = (message: string, blockedByGuard = false): ModerationResult => ({ ok: false, message, blockedByGuard });

export type NukeableChannel = TextChannel | NewsChannel;

export interface NukeRequest {
  guild: Guild;
  moderator: GuildMember;
  channel: NukeableChannel;
  reason: string | null;
  invocationId: string;
}

export interface NukeResult extends ModerationResult {
  channel?: NukeableChannel;
}

type ModerationLogKind = 'MEMBER' | 'CHANNEL';

export interface ModerationRequest {
  action: ModerationAction;
  guild: Guild;
  moderator: GuildMember;
  targetId: string;
  reason: string | null;
  /** Unique per invocation (message id), used for Guard deduplication. */
  invocationId: string;
  /** Ban only: how many seconds of the user's recent messages to delete (0–604800). */
  deleteMessageSeconds?: number;
  /** How the moderator invoked it, as typed (`/ban`, `.yargi`). Shown in logs and Guard reports. */
  command?: string;
}

function deletionWindow(seconds: number): string {
  if (seconds % 86_400 === 0) return `Son ${seconds / 86_400} gün`;
  if (seconds % 3_600 === 0) return `Son ${seconds / 3_600} saat`;
  return `Son ${formatDuration(seconds)}`;
}

/**
 * Server bans and kicks issued through Biri. Enforces Discord's hierarchy
 * rules for both the moderator and the bot, and feeds every action into Guard
 * attributed to the moderator, so bot-proxied mass bans are still detected.
 */
export class ModerationService {
  private logSink: ((guildId: string, embed: EmbedBuilder, kind: ModerationLogKind) => void) | null = null;

  constructor(
    private readonly processor: SecurityEventProcessor,
    private readonly logger: Logger,
    private readonly selfActions?: SelfActionRegistry,
  ) {}

  setLogSink(sink: (guildId: string, embed: EmbedBuilder, kind: ModerationLogKind) => void): void {
    this.logSink = sink;
  }

  async execute(request: ModerationRequest): Promise<ModerationResult> {
    const { action, guild, moderator, targetId } = request;
    if (action === 'UNBAN') return this.unban(request);
    const spec = ACTIONS[action];
    const me = guild.members.me;

    if (!moderator.permissions.has(spec.permission)) return fail(`Bu komut için **${spec.permissionLabel}** yetkin yok.`);
    if (!me?.permissions.has(spec.permission)) return fail(botPermissionHint(spec.permissionLabel));
    if (targetId === moderator.id) return fail(`Kendini ${spec.verb}.`);
    if (targetId === guild.ownerId) return fail(`Sunucu sahibini ${spec.verb}.`);
    if (targetId === me.id) return fail(`Biri'yi bu komutla ${spec.verb}.`);

    const target = guild.members.cache.get(targetId) ?? (await guild.members.fetch(targetId).catch(() => null));
    if (!target && action === 'KICK') return fail('Bu kullanıcı sunucuda değil.');
    // Banning by id: make sure the account exists before it counts towards Guard thresholds.
    let user: User | null = target?.user ?? null;
    if (!user) {
      try {
        user = await guild.client.users.fetch(targetId);
      } catch (error) {
        if (discordErrorCode(error) === RESTJSONErrorCodes.UnknownUser) return fail(`\`${targetId}\` kimliğine sahip bir Discord kullanıcısı bulunamadı.`);
      }
    }
    if (target) {
      const isOwner = moderator.id === guild.ownerId;
      if (!isOwner && target.roles.highest.position >= moderator.roles.highest.position) {
        return fail(`${userMention(target.id)} kullanıcısının rolü seninkiyle aynı seviyede veya daha yüksek; onu ${spec.verb}.`);
      }
      if (target.roles.highest.position >= me.roles.highest.position) {
        return fail(`${userMention(target.id)} kullanıcısının rolü Biri'nin rolüyle aynı seviyede veya daha yüksek. Biri rolünü yukarı taşıyın.`);
      }
    }

    // Guard first: if this action completes a mass-ban/kick burst, stop it.
    const reasonText = request.reason?.trim() || null;
    const guard = await this.processor
      .processCommandAction(guild, {
        module: spec.module,
        command: request.command ?? (action === 'BAN' ? '/ban' : '/kick'),
        executorId: moderator.id,
        targetId,
        targetName: user?.tag ?? null,
        reason: reasonText,
        dedupeId: `cmd:${request.invocationId}`,
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, guildId: guild.id }, 'Moderasyon işlemi Guard tarafından değerlendirilemedi');
        return null;
      });
    const sanctioned = guard?.outcome && !guard.outcome.duplicate && ENFORCED.has(guard.outcome.action);
    if (sanctioned || !moderator.permissions.has(spec.permission)) {
      return fail(
        '🛡️ Biri Guard kısa sürede çok fazla işlem algıladı. Bu işlem **engellendi** ve yöneticiler bilgilendirildi.',
        true,
      );
    }

    const auditReason = clip(`${moderator.user.tag} (${moderator.id}): ${reasonText ?? 'Sebep belirtilmedi'}`, 512);
    if (target && !target.user.bot) {
      await target
        .send(`${spec.emoji} **${guild.name}** sunucusundan ${action === 'BAN' ? 'yasaklandın' : 'atıldın'}.\nSebep: ${reasonText ?? 'Belirtilmedi'}`)
        .catch(() => undefined);
    }

    const deleteSeconds = action === 'BAN' ? (request.deleteMessageSeconds ?? 0) : 0;
    try {
      if (action === 'BAN') await guild.bans.create(targetId, { reason: auditReason, deleteMessageSeconds: deleteSeconds });
      else await target!.kick(auditReason);
    } catch (error) {
      return fail(`İşlem başarısız: ${describeError(error)}`);
    }

    const lines = [
      `**Kullanıcı:** ${userLabel(targetId, user?.tag)}`,
      `**Yetkili:** ${userLabel(moderator.id, moderator.user.tag)}`,
      `**Sebep:** ${reasonText ?? 'Belirtilmedi'}`,
    ];
    if (action === 'BAN' && !target) lines.push('**Not:** Kullanıcı sunucuda değildi, kimliğiyle yasaklandı.');
    if (deleteSeconds > 0) lines.push(`**Silinen mesajlar:** ${deletionWindow(deleteSeconds)}`);
    this.log(
      guild.id,
      brandEmbed(action === 'BAN' ? COLORS.critical : COLORS.warning)
        .setTitle(action === 'BAN' ? '🔨 Üye Yasaklandı' : '👢 Üye Atıldı')
        .setDescription(lines.join('\n')),
      user,
      request.command,
    );
    return {
      ok: true,
      message: `${spec.emoji} ${userMention(targetId)}${user ? ` \`${user.tag}\`` : ''} ${spec.past}.\n**Yetkili:** ${userMention(moderator.id)}\n**Sebep:** ${reasonText ?? 'Belirtilmedi'}`,
    };
  }

  private log(guildId: string, embed: EmbedBuilder, user: User | null, command: string | undefined, kind: ModerationLogKind = 'MEMBER'): void {
    const avatar = user?.displayAvatarURL?.();
    if (avatar) embed.setThumbnail(avatar);
    if (command) embed.setFooter({ text: `Biri • Komut: ${command}` });
    this.logSink?.(guildId, embed, kind);
  }

  /** Lifting a ban is not a destructive action, so it is logged but not counted by Guard. */
  private async unban(request: ModerationRequest): Promise<ModerationResult> {
    const { guild, moderator, targetId } = request;
    if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) return fail('Bu komut için **Üyeleri Yasakla** yetkin yok.');
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) return fail(botPermissionHint('Üyeleri Yasakla'));

    // Looked up first so the log can name the user and show why they were banned.
    const ban = await guild.bans.fetch(targetId).catch((error: unknown) => (discordErrorCode(error) === RESTJSONErrorCodes.UnknownBan ? ('NOT_BANNED' as const) : null));
    if (ban === 'NOT_BANNED') return fail(`${userMention(targetId)} (\`${targetId}\`) yasaklı değil.`);

    const reasonText = request.reason?.trim() || null;
    try {
      await guild.bans.remove(targetId, clip(`${moderator.user.tag} (${moderator.id}): ${reasonText ?? 'Sebep belirtilmedi'}`, 512));
    } catch (error) {
      if (discordErrorCode(error) === RESTJSONErrorCodes.UnknownBan) return fail(`${userMention(targetId)} (\`${targetId}\`) yasaklı değil.`);
      return fail(`İşlem başarısız: ${describeError(error)}`);
    }

    const lines = [
      `**Kullanıcı:** ${userLabel(targetId, ban?.user.tag)}`,
      `**Yetkili:** ${userLabel(moderator.id, moderator.user.tag)}`,
      `**Sebep:** ${reasonText ?? 'Belirtilmedi'}`,
    ];
    if (ban?.reason) lines.push(`**Yasaklanma sebebi:** ${clip(ban.reason, 300)}`);
    this.log(guild.id, brandEmbed(COLORS.success).setTitle('✅ Yasak Kaldırıldı').setDescription(lines.join('\n')), ban?.user ?? null, request.command);
    return {
      ok: true,
      message: `✅ ${userMention(targetId)}${ban ? ` \`${ban.user.tag}\`` : ''} kullanıcısının yasağı kaldırıldı.\n**Yetkili:** ${userMention(moderator.id)}\n**Sebep:** ${reasonText ?? 'Belirtilmedi'}`,
    };
  }

  /**
   * Wipes a text channel by cloning it (name, topic, permissions, slowmode,
   * category and position are kept) and deleting the original. Counted by
   * Guard as a channel deletion attributed to the moderator.
   */
  async nuke(request: NukeRequest): Promise<NukeResult> {
    const { guild, moderator, channel } = request;
    const me = guild.members.me;
    if (!channel.permissionsFor(moderator).has(PermissionFlagsBits.ManageChannels)) return fail('Bu kanal için **Kanalları Yönet** yetkin yok.');
    if (!me || !channel.permissionsFor(me).has(PermissionFlagsBits.ManageChannels)) return fail(botPermissionHint('Kanalları Yönet', true));

    const reasonText = request.reason?.trim() || null;
    const guard = await this.processor
      .processCommandAction(guild, {
        module: 'CHANNEL_DELETE',
        command: '/nuke',
        executorId: moderator.id,
        targetId: channel.id,
        targetType: 'CHANNEL',
        targetName: channel.name,
        reason: reasonText,
        dedupeId: `cmd:${request.invocationId}`,
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, guildId: guild.id }, 'Nuke işlemi Guard tarafından değerlendirilemedi');
        return null;
      });
    const sanctioned = guard?.outcome && !guard.outcome.duplicate && ENFORCED.has(guard.outcome.action);
    if (sanctioned || !channel.permissionsFor(moderator).has(PermissionFlagsBits.ManageChannels)) {
      return fail('🛡️ Biri Guard kısa sürede çok fazla kanal silme algıladı. Bu işlem **engellendi** ve yöneticiler bilgilendirildi.', true);
    }

    const auditReason = clip(`Nuke — ${moderator.user.tag} (${moderator.id}): ${reasonText ?? 'Sebep belirtilmedi'}`, 512);
    const position = channel.rawPosition;
    let fresh: NukeableChannel;
    try {
      fresh = await channel.clone({ reason: auditReason });
    } catch (error) {
      return fail(`Kanal kopyalanamadı: ${describeError(error)}`);
    }
    this.selfActions?.register(guild.id, 'CHANNEL_DELETE', channel.id);
    try {
      await channel.delete(auditReason);
    } catch (error) {
      this.selfActions?.unregister(guild.id, 'CHANNEL_DELETE', channel.id);
      await fresh.delete('Nuke başarısız, kopya kaldırıldı').catch(() => undefined);
      return fail(`Kanal silinemedi: ${describeError(error)}`);
    }
    if (fresh.rawPosition !== position) await fresh.setPosition(position, { reason: auditReason }).catch(() => undefined);

    await fresh
      .send({
        embeds: [
          brandEmbed(COLORS.critical)
            .setTitle('💥 Kanal Sıfırlandı')
            .setDescription(`Bu kanal ${userMention(moderator.id)} tarafından sıfırlandı.${reasonText ? `\n**Sebep:** ${reasonText}` : ''}`),
        ],
        allowedMentions: { parse: [] },
      })
      .catch(() => undefined);

    const text = `💥 **#${channel.name}** kanalı sıfırlandı → ${fresh.toString()}\n**Yetkili:** ${userMention(moderator.id)}\n**Sebep:** ${reasonText ?? 'Belirtilmedi'}`;
    this.log(
      guild.id,
      brandEmbed(COLORS.critical)
        .setTitle('💥 Kanal Sıfırlandı (Nuke)')
        .setDescription(
          `**Kanal:** ${fresh.toString()} \`#${channel.name}\`\n**Yetkili:** ${userLabel(moderator.id, moderator.user.tag)}\n**Sebep:** ${reasonText ?? 'Belirtilmedi'}\n` +
            `**Eski kanal ID:** \`${channel.id}\`\n**Yeni kanal ID:** \`${fresh.id}\``,
        ),
      null,
      '/nuke',
      'CHANNEL',
    );
    return { ok: true, message: text, channel: fresh };
  }
}
