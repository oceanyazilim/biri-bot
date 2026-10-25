import { PermissionFlagsBits, RESTJSONErrorCodes, type EmbedBuilder, type Guild, type GuildMember } from 'discord.js';
import { COLORS } from '../../config/constants';
import { describeError, discordErrorCode } from '../../utils/discordErrors';
import { clip, userMention } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import type { SecurityEventProcessor } from '../guard/SecurityEventProcessor';
import { brandEmbed } from '../logging/embeds';

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

const fail = (message: string, blockedByGuard = false): ModerationResult => ({ ok: false, message, blockedByGuard });

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
}

/**
 * Server bans and kicks issued through Biri. Enforces Discord's hierarchy
 * rules for both the moderator and the bot, and feeds every action into Guard
 * attributed to the moderator, so bot-proxied mass bans are still detected.
 */
export class ModerationService {
  private logSink: ((guildId: string, embed: EmbedBuilder) => void) | null = null;

  constructor(
    private readonly processor: SecurityEventProcessor,
    private readonly logger: Logger,
  ) {}

  setLogSink(sink: (guildId: string, embed: EmbedBuilder) => void): void {
    this.logSink = sink;
  }

  async execute(request: ModerationRequest): Promise<ModerationResult> {
    const { action, guild, moderator, targetId } = request;
    if (action === 'UNBAN') return this.unban(request);
    const spec = ACTIONS[action];
    const me = guild.members.me;

    if (!moderator.permissions.has(spec.permission)) return fail(`Bu komut için **${spec.permissionLabel}** yetkin yok.`);
    if (!me?.permissions.has(spec.permission)) return fail(`Biri'nin **${spec.permissionLabel}** yetkisi yok.`);
    if (targetId === moderator.id) return fail(`Kendini ${spec.verb}.`);
    if (targetId === guild.ownerId) return fail(`Sunucu sahibini ${spec.verb}.`);
    if (targetId === me.id) return fail(`Biri'yi bu komutla ${spec.verb}.`);

    const target = guild.members.cache.get(targetId) ?? (await guild.members.fetch(targetId).catch(() => null));
    if (!target && action === 'KICK') return fail('Bu kullanıcı sunucuda değil.');
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
        command: action === 'BAN' ? 'ban' : 'kick',
        executorId: moderator.id,
        targetId,
        targetName: target?.user.tag ?? null,
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

    try {
      if (action === 'BAN') await guild.bans.create(targetId, { reason: auditReason, deleteMessageSeconds: request.deleteMessageSeconds ?? 0 });
      else await target!.kick(auditReason);
    } catch (error) {
      return fail(`İşlem başarısız: ${describeError(error)}`);
    }

    const text = `${spec.emoji} ${userMention(targetId)} ${spec.past}.\n**Yetkili:** ${userMention(moderator.id)}\n**Sebep:** ${reasonText ?? 'Belirtilmedi'}`;
    this.logSink?.(
      guild.id,
      brandEmbed(action === 'BAN' ? COLORS.critical : COLORS.warning)
        .setTitle(action === 'BAN' ? '🔨 Üye Yasaklandı' : '👢 Üye Atıldı')
        .setDescription(`${text}\n**Kullanıcı ID:** \`${targetId}\``),
    );
    return { ok: true, message: text };
  }

  /** Lifting a ban is not a destructive action, so it is logged but not counted by Guard. */
  private async unban(request: ModerationRequest): Promise<ModerationResult> {
    const { guild, moderator, targetId } = request;
    if (!moderator.permissions.has(PermissionFlagsBits.BanMembers)) return fail('Bu komut için **Üyeleri Yasakla** yetkin yok.');
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) return fail("Biri'nin **Üyeleri Yasakla** yetkisi yok.");

    const reasonText = request.reason?.trim() || null;
    try {
      await guild.bans.remove(targetId, clip(`${moderator.user.tag} (${moderator.id}): ${reasonText ?? 'Sebep belirtilmedi'}`, 512));
    } catch (error) {
      if (discordErrorCode(error) === RESTJSONErrorCodes.UnknownBan) return fail(`${userMention(targetId)} (\`${targetId}\`) yasaklı değil.`);
      return fail(`İşlem başarısız: ${describeError(error)}`);
    }

    const text = `✅ ${userMention(targetId)} kullanıcısının yasağı kaldırıldı.
**Yetkili:** ${userMention(moderator.id)}
**Sebep:** ${reasonText ?? 'Belirtilmedi'}`;
    this.logSink?.(
      guild.id,
      brandEmbed(COLORS.success).setTitle('✅ Yasak Kaldırıldı').setDescription(`${text}
**Kullanıcı ID:** \`${targetId}\``),
    );
    return { ok: true, message: text };
  }
}
