import { PermissionFlagsBits, type Guild, type GuildMember, type VoiceBasedChannel } from 'discord.js';
import { COLORS, MAX_ROOM_OVERWRITES, MAX_VOICE_USER_LIMIT } from '../../config/constants';
import type { TempVoiceRepository, TempVoiceRoom } from '../../database/repositories/types';
import { BoundedTtlMap } from '../../utils/collections';
import { describeError } from '../../utils/discordErrors';
import { channelMention, userMention } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import { brandEmbed } from '../logging/embeds';
import { validateCustomRoomName } from './roomNaming';
import type { TempVoiceService, VoiceLogSink } from './TempVoiceService';

export interface RoomActionResult {
  ok: boolean;
  message: string;
}

export interface RoomContext {
  room: TempVoiceRoom;
  channel: VoiceBasedChannel;
  actor: GuildMember;
  /** True when the actor manages the room through the administrator override. */
  viaAdmin: boolean;
}

const RENAME_WINDOW_MS = 10 * 60 * 1000;
const RENAME_MAX = 2;

/** Server staff who may manage any temp room (override). */
export function isRoomAdmin(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.ManageChannels);
}

/** Members a room owner may not disconnect or block: server staff with voice moderation rights. */
function isProtectedStaff(member: GuildMember): boolean {
  return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.MoveMembers);
}

const fail = (message: string): RoomActionResult => ({ ok: false, message });
const done = (message: string): RoomActionResult => ({ ok: true, message });

/**
 * Room management operations shared by slash commands and the control panel.
 * Every operation re-validates authorization; nothing here touches server-wide
 * permissions or membership — `/at` only disconnects from voice.
 */
export class RoomManager {
  private readonly renames = new BoundedTtlMap<string, number[]>(10_000, RENAME_WINDOW_MS);
  private logSink: VoiceLogSink | null = null;

  constructor(
    private readonly service: TempVoiceService,
    private readonly repo: TempVoiceRepository,
    private readonly logger: Logger,
  ) {}

  setLogSink(sink: VoiceLogSink): void {
    this.logSink = sink;
  }

  private log(guildId: string, actorId: string, channelId: string, action: string): void {
    this.logSink?.(
      guildId,
      brandEmbed(COLORS.primary).setTitle('🎛️ Oda İşlemi').setDescription(`${userMention(actorId)} • ${channelMention(channelId)}\n${action}`),
    );
  }

  /**
   * Resolves the room an actor may manage. With an explicit channel id (panel
   * buttons) that exact room is checked; otherwise the room the actor is in,
   * falling back to the room they own.
   */
  resolve(actor: GuildMember, channelId?: string): RoomContext | RoomActionResult {
    const guild = actor.guild;
    const admin = isRoomAdmin(actor);
    const contextFor = (room: TempVoiceRoom | undefined): RoomContext | null => {
      if (!room || room.guildId !== guild.id) return null;
      const channel = this.service.voiceChannel(guild, room.channelId);
      if (!channel) return null;
      return { room, channel, actor, viaAdmin: room.ownerId !== actor.id };
    };

    if (channelId) {
      const context = contextFor(this.service.getRoom(channelId));
      if (!context) return fail('Bu oda artık mevcut değil.');
      if (context.room.ownerId !== actor.id && !admin) return fail('Bu oda sana ait değil. Yalnızca oda sahibi bu odayı yönetebilir.');
      return context;
    }

    const current = contextFor(this.service.getRoom(actor.voice.channelId));
    if (current && (current.room.ownerId === actor.id || admin)) return current;

    for (const room of this.service.roomsOwnedBy(guild.id, actor.id)) {
      const owned = contextFor(room);
      if (owned) return owned;
    }
    if (current) return fail('Bu oda sana ait değil. Yalnızca oda sahibi bu odayı yönetebilir.');
    return fail('Yönetebileceğin bir geçici odan yok. Önce **➕・Oda Oluştur** kanalına katılarak bir oda oluştur.');
  }

  static isContext(value: RoomContext | RoomActionResult): value is RoomContext {
    return 'room' in value;
  }

  private botCan(channel: VoiceBasedChannel, flag: bigint): boolean {
    const me = channel.guild.members.me;
    return Boolean(me && channel.permissionsFor(me)?.has(flag));
  }

  private async setFlags(ctx: RoomContext, data: { locked?: boolean; hidden?: boolean }, success: string, logText: string) {
    if (!this.botCan(ctx.channel, PermissionFlagsBits.ManageRoles) && !this.botCan(ctx.channel, PermissionFlagsBits.Administrator)) {
      return fail('Botun bu kanalda **İzinleri Yönet** yetkisi yok.');
    }
    const previous = { locked: ctx.room.locked, hidden: ctx.room.hidden };
    const updated = await this.service.updateRoom(ctx.channel.id, data);
    if (!updated) return fail('Oda kaydı bulunamadı.');
    try {
      await this.service.applyPermissions(ctx.channel.guild, ctx.channel.id);
    } catch (error) {
      await this.service.updateRoom(ctx.channel.id, previous);
      this.logger.warn({ err: error, channelId: ctx.channel.id }, 'Oda izinleri uygulanamadı');
      return fail(`Oda izinleri güncellenemedi: ${describeError(error)}`);
    }
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, logText);
    return done(success);
  }

  lock(ctx: RoomContext) {
    if (ctx.room.locked) return Promise.resolve(fail('Oda zaten kilitli.'));
    return this.setFlags(ctx, { locked: true }, '🔒 Oda kilitlendi. Yeni kullanıcılar katılamaz; içerideki kullanıcılar kalabilir.', '🔒 Oda kilitlendi');
  }

  unlock(ctx: RoomContext) {
    if (!ctx.room.locked) return Promise.resolve(fail('Oda zaten açık.'));
    return this.setFlags(ctx, { locked: false }, '🔓 Odanın kilidi açıldı.', '🔓 Oda kilidi açıldı');
  }

  hide(ctx: RoomContext) {
    if (ctx.room.hidden) return Promise.resolve(fail('Oda zaten gizli.'));
    return this.setFlags(ctx, { hidden: true }, '🙈 Oda gizlendi. Sıradan üyeler odayı göremez.', '🙈 Oda gizlendi');
  }

  show(ctx: RoomContext) {
    if (!ctx.room.hidden) return Promise.resolve(fail('Oda zaten görünür.'));
    return this.setFlags(ctx, { hidden: false }, '👁️ Oda tekrar görünür hâle getirildi.', '👁️ Oda görünür yapıldı');
  }

  /** Disconnects a member from the room's voice channel. Never kicks from the server. */
  async disconnect(ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
    if (target.id === ctx.actor.id) return fail('Kendini odadan atamazsın.');
    if (target.id === ctx.channel.client.user.id) return fail('Biri odadan atılamaz.');
    if (target.voice.channelId !== ctx.channel.id) return fail(`${userMention(target.id)} şu anda bu odada değil.`);
    if (target.id === ctx.room.ownerId && !ctx.viaAdmin) return fail('Oda sahibi odadan atılamaz.');
    if (isProtectedStaff(target) && !isRoomAdmin(ctx.actor)) return fail('Sunucu yetkilileri odadan atılamaz.');
    if (!this.botCan(ctx.channel, PermissionFlagsBits.MoveMembers)) {
      return fail('Botun bu kanalda **Üyeleri Taşı** yetkisi yok, kullanıcı odadan çıkarılamadı.');
    }
    try {
      await target.voice.disconnect(`Biri: ${ctx.actor.user.tag} odadan çıkardı`);
    } catch (error) {
      return fail(`Kullanıcı odadan çıkarılamadı: ${describeError(error)}`);
    }
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, `👢 ${userMention(target.id)} ses odasından çıkarıldı`);
    return done(`👢 ${userMention(target.id)} ses odasından çıkarıldı. (Sunucudan atılmadı.)`);
  }

  async rename(ctx: RoomContext, rawName: string): Promise<RoomActionResult> {
    const validation = validateCustomRoomName(rawName);
    if (!validation.ok) return fail(validation.reason);
    if (validation.name === ctx.channel.name) return fail('Oda zaten bu isimde.');
    if (!this.botCan(ctx.channel, PermissionFlagsBits.ManageChannels)) return fail('Botun bu kanalda **Kanalları Yönet** yetkisi yok.');

    const now = Date.now();
    const history = (this.renames.get(ctx.channel.id) ?? []).filter((at) => now - at < RENAME_WINDOW_MS);
    if (history.length >= RENAME_MAX) {
      const waitSec = Math.ceil((RENAME_WINDOW_MS - (now - (history[0] ?? now))) / 1000);
      return fail(`Discord sınırı: bir oda 10 dakikada en fazla ${RENAME_MAX} kez yeniden adlandırılabilir. ${Math.ceil(waitSec / 60)} dakika sonra tekrar dene.`);
    }
    history.push(now);
    this.renames.set(ctx.channel.id, history);
    try {
      await ctx.channel.setName(validation.name, `Biri: ${ctx.actor.user.tag} yeniden adlandırdı`);
    } catch (error) {
      return fail(`Oda adı değiştirilemedi: ${describeError(error)}`);
    }
    await this.service.updateRoom(ctx.channel.id, { name: validation.name });
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, `✏️ Oda adı **${validation.name}** olarak değiştirildi`);
    return done(`✏️ Oda adı **${validation.name}** olarak değiştirildi.`);
  }

  async setLimit(ctx: RoomContext, limit: number): Promise<RoomActionResult> {
    if (!Number.isInteger(limit) || limit < 0 || limit > MAX_VOICE_USER_LIMIT) {
      return fail(`Kullanıcı limiti 0 ile ${MAX_VOICE_USER_LIMIT} arasında olmalı (0 = limitsiz).`);
    }
    if (!this.botCan(ctx.channel, PermissionFlagsBits.ManageChannels)) return fail('Botun bu kanalda **Kanalları Yönet** yetkisi yok.');
    try {
      await ctx.channel.setUserLimit(limit, `Biri: ${ctx.actor.user.tag}`);
    } catch (error) {
      return fail(`Limit değiştirilemedi: ${describeError(error)}`);
    }
    await this.service.updateRoom(ctx.channel.id, { userLimit: limit });
    const text = limit === 0 ? '♾️ Oda limiti kaldırıldı.' : `👥 Oda limiti **${limit}** olarak ayarlandı.`;
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, text);
    return done(text);
  }

  async block(ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
    if (target.id === ctx.actor.id) return fail('Kendini engelleyemezsin.');
    if (target.id === ctx.room.ownerId) return fail('Oda sahibi engellenemez.');
    if (target.user.bot) return fail('Botlar engellenemez.');
    if (isProtectedStaff(target)) return fail('Sunucu yetkilileri oda engellemesinden etkilenmez.');
    if ((await this.service.projectedOverwriteCount(ctx.channel.guild, ctx.room, ctx.channel, target.id)) > MAX_ROOM_OVERWRITES) {
      return fail('Bu oda için izin sınırına ulaşıldı. Önce bazı engelleri veya izinleri kaldır.');
    }
    const added = await this.repo.addRestriction(ctx.room.id, target.id, ctx.actor.id);
    if (!added) return fail(`${userMention(target.id)} zaten engelli.`);
    await this.repo.removeAllowed(ctx.room.id, target.id);
    const applied = await this.applyOrRollback(ctx, () => this.repo.removeRestriction(ctx.room.id, target.id));
    if (!applied.ok) return applied;
    if (target.voice.channelId === ctx.channel.id && this.botCan(ctx.channel, PermissionFlagsBits.MoveMembers)) {
      await target.voice.disconnect('Biri: odadan engellendi').catch(() => undefined);
    }
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, `⛔ ${userMention(target.id)} odadan engellendi`);
    return done(`⛔ ${userMention(target.id)} bu odaya katılamaz. (Bu yalnızca odaya özeldir, sunucu yasağı değildir.)`);
  }

  async unblock(ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
    const removed = await this.repo.removeRestriction(ctx.room.id, target.id);
    if (!removed) return fail(`${userMention(target.id)} bu odada engelli değil.`);
    const applied = await this.applyOrRollback(ctx, async () => {
      await this.repo.addRestriction(ctx.room.id, target.id, ctx.actor.id);
    });
    if (!applied.ok) return applied;
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, `✅ ${userMention(target.id)} engeli kaldırıldı`);
    return done(`✅ ${userMention(target.id)} için oda engeli kaldırıldı.`);
  }

  async allow(ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
    if (target.id === ctx.room.ownerId) return fail('Oda sahibinin zaten tam erişimi var.');
    if (target.user.bot) return fail('Botlara özel oda izni verilemez.');
    if ((await this.service.projectedOverwriteCount(ctx.channel.guild, ctx.room, ctx.channel, target.id)) > MAX_ROOM_OVERWRITES) {
      return fail('Bu oda için izin sınırına ulaşıldı. Önce bazı engelleri veya izinleri kaldır.');
    }
    const added = await this.repo.addAllowed(ctx.room.id, target.id, ctx.actor.id);
    if (!added) return fail(`${userMention(target.id)} zaten özel erişime sahip.`);
    const wasBlocked = await this.repo.removeRestriction(ctx.room.id, target.id);
    const applied = await this.applyOrRollback(ctx, async () => {
      await this.repo.removeAllowed(ctx.room.id, target.id);
      if (wasBlocked) await this.repo.addRestriction(ctx.room.id, target.id, ctx.actor.id);
    });
    if (!applied.ok) return applied;
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, `🎟️ ${userMention(target.id)} kullanıcısına özel erişim verildi`);
    return done(`🎟️ ${userMention(target.id)} artık oda kilitli veya gizli olsa bile katılabilir.`);
  }

  async disallow(ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
    const removed = await this.repo.removeAllowed(ctx.room.id, target.id);
    if (!removed) return fail(`${userMention(target.id)} için özel erişim bulunmuyor.`);
    const applied = await this.applyOrRollback(ctx, async () => {
      await this.repo.addAllowed(ctx.room.id, target.id, ctx.actor.id);
    });
    if (!applied.ok) return applied;
    this.log(ctx.channel.guild.id, ctx.actor.id, ctx.channel.id, `🚫 ${userMention(target.id)} özel erişimi kaldırıldı`);
    return done(`🚫 ${userMention(target.id)} kullanıcısının özel oda erişimi kaldırıldı.`);
  }

  private async applyOrRollback(ctx: RoomContext, rollback: () => Promise<unknown>): Promise<RoomActionResult> {
    try {
      await this.service.applyPermissions(ctx.channel.guild, ctx.channel.id);
      return done('');
    } catch (error) {
      await rollback().catch(() => undefined);
      this.logger.warn({ err: error, channelId: ctx.channel.id }, 'Oda izinleri uygulanamadı');
      return fail(`Oda izinleri güncellenemedi: ${describeError(error)}`);
    }
  }

  async transfer(ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
    if (target.user.bot) return fail('Sahiplik bir bota devredilemez.');
    if (target.id === ctx.room.ownerId) return fail(`${userMention(target.id)} zaten odanın sahibi.`);
    if (target.voice.channelId !== ctx.channel.id) return fail('Yeni sahip şu anda odada bulunmalı.');
    const result = await this.service.transferOwnership(ctx.channel.guild, ctx.channel.id, target.id, {
      expectedOwnerId: ctx.room.ownerId,
      actorId: ctx.actor.id,
    });
    if (result.ok) return done(`👑 Oda sahipliği ${userMention(target.id)} kullanıcısına devredildi.`);
    switch (result.reason) {
      case 'OWNER_CHANGED':
        return fail('Oda sahipliği bu sırada değişti. Lütfen tekrar dene.');
      case 'NOT_IN_ROOM':
        return fail('Yeni sahip şu anda odada bulunmalı.');
      default:
        return fail('Oda bulunamadı.');
    }
  }

  async close(ctx: RoomContext): Promise<RoomActionResult> {
    const deleted = await this.service.deleteRoom(ctx.channel.guild, ctx.channel.id, {
      reason: ctx.viaAdmin ? 'admin' : 'owner',
      actorId: ctx.actor.id,
    });
    return deleted ? done('🗑️ Oda kapatıldı.') : fail('Oda kapatılamadı. Botun **Kanalları Yönet** yetkisini kontrol et.');
  }

  /** Room details for /oda and the control panel. */
  async details(guild: Guild, room: TempVoiceRoom, channel: VoiceBasedChannel) {
    const [restrictions, allowed] = await Promise.all([this.repo.listRestrictions(room.id), this.repo.listAllowed(room.id)]);
    return {
      memberCount: this.service.humanCount(channel),
      userLimit: channel.userLimit,
      blocked: restrictions.map((entry) => entry.userId),
      allowed: allowed.map((entry) => entry.userId),
      guildId: guild.id,
    };
  }
}
