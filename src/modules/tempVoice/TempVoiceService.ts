import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildMember,
  type OverwriteResolvable,
  type TextChannel,
  type VoiceBasedChannel,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import {
  COLORS,
  MAX_ROOM_OVERWRITES,
  TEMP_VOICE_CATEGORY_NAME,
  TEMP_VOICE_CREATOR_NAME,
} from '../../config/constants';
import type { TempVoiceConfig, TempVoiceRepository, TempVoiceRoom } from '../../database/repositories/types';
import type { SelfActionRegistry } from '../../services/SelfActionRegistry';
import { KeyedMutex, KeyedSemaphore } from '../../utils/async';
import { BoundedTtlMap } from '../../utils/collections';
import { describeError, isUnknownResource } from '../../utils/discordErrors';
import { channelMention, userMention } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import { TimerRegistry } from '../../utils/timers';
import { brandEmbed } from '../logging/embeds';
import { JoinTracker, pickSuccessor } from './JoinTracker';
import { buildHubPanel, HUB_CHANNEL_NAME } from './panel';
import { buildRoomName } from './roomNaming';
import { computeRoomOverwrites, toOverwriteOptions, type BaseOverwrite, type RoomPermissionState } from './roomPermissions';

export interface VoiceLogSink {
  (guildId: string, embed: ReturnType<typeof brandEmbed>): void;
}

export interface TempVoiceSetupOptions {
  categoryId?: string;
  emptyDeleteDelaySec: number;
  ownerGraceSec: number;
  maxRoomsPerMember: number;
  defaultUserLimit: number;
  /** Create the persistent control panel channel (default true). */
  panel?: boolean;
}

export interface TempVoiceSetupResult {
  config: TempVoiceConfig;
  createdCategory: boolean;
  createdCreator: boolean;
  panel: PanelResult;
}

export interface PanelResult {
  channelId: string | null;
  created: boolean;
  error: string | null;
}

export type TransferResult =
  | { ok: true; previousOwnerId: string; newOwnerId: string }
  | { ok: false; reason: 'NO_ROOM' | 'OWNER_CHANGED' | 'NOT_IN_ROOM' | 'SAME_OWNER' };

const REQUIRED_VOICE_PERMISSIONS: Array<[bigint, string]> = [
  [PermissionFlagsBits.ManageChannels, 'Kanalları Yönet'],
  [PermissionFlagsBits.ManageRoles, 'Rolleri Yönet'],
  [PermissionFlagsBits.MoveMembers, 'Üyeleri Taşı'],
  [PermissionFlagsBits.ViewChannel, 'Kanalları Görüntüle'],
  [PermissionFlagsBits.Connect, 'Bağlan'],
];

/**
 * Lifecycle of join-to-create rooms: creation, empty-room cleanup, ownership
 * hand-over and restart recovery. The in-memory room index is authoritative
 * for event handling and is rebuilt from the database on startup.
 */
export class TempVoiceService {
  private readonly configs = new Map<string, TempVoiceConfig | null>();
  private readonly rooms = new Map<string, TempVoiceRoom>();
  private readonly joins = new JoinTracker();
  private readonly timers: TimerRegistry;
  private readonly userLocks = new KeyedMutex();
  private readonly roomLocks = new KeyedMutex();
  private readonly creationSlots: KeyedSemaphore;
  private readonly permissionWarnings = new BoundedTtlMap<string, true>(1_000, 10 * 60 * 1000);
  private logSink: VoiceLogSink | null = null;

  constructor(
    private readonly repo: TempVoiceRepository,
    private readonly selfActions: SelfActionRegistry,
    private readonly logger: Logger,
    options: { creationConcurrency: number },
  ) {
    this.creationSlots = new KeyedSemaphore(options.creationConcurrency);
    this.timers = new TimerRegistry((key, error) => this.logger.error({ err: error, key }, 'Geçici oda zamanlayıcısı hata verdi'));
  }

  setLogSink(sink: VoiceLogSink): void {
    this.logSink = sink;
  }

  private log(guildId: string, embed: ReturnType<typeof brandEmbed>): void {
    this.logSink?.(guildId, embed);
  }

  // ───────────────────────────── configuration ─────────────────────────────

  async getConfig(guildId: string): Promise<TempVoiceConfig | null> {
    if (this.configs.has(guildId)) return this.configs.get(guildId) ?? null;
    const config = await this.repo.getConfig(guildId);
    this.configs.set(guildId, config);
    return config;
  }

  missingPermissions(guild: Guild): string[] {
    const me = guild.members.me;
    if (!me) return REQUIRED_VOICE_PERMISSIONS.map(([, label]) => label);
    return REQUIRED_VOICE_PERMISSIONS.filter(([flag]) => !me.permissions.has(flag)).map(([, label]) => label);
  }

  /** Creates or reuses the temp voice category and creator channel (idempotent). */
  async setup(guild: Guild, options: TempVoiceSetupOptions): Promise<TempVoiceSetupResult> {
    return this.userLocks.run(`setup:${guild.id}`, async () => {
      const existing = await this.repo.getConfig(guild.id);
      let createdCategory = false;
      let createdCreator = false;

      let category: CategoryChannel | null = null;
      for (const id of [options.categoryId, existing?.categoryId]) {
        if (!id) continue;
        const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
        if (channel?.type === ChannelType.GuildCategory) {
          category = channel;
          break;
        }
      }
      category ??=
        guild.channels.cache.find(
          (channel): channel is CategoryChannel =>
            channel.type === ChannelType.GuildCategory && channel.name === TEMP_VOICE_CATEGORY_NAME,
        ) ?? null;
      if (!category) {
        category = await guild.channels.create({
          name: TEMP_VOICE_CATEGORY_NAME,
          type: ChannelType.GuildCategory,
          reason: 'Biri geçici ses odaları kurulumu',
        });
        this.selfActions.register(guild.id, 'CHANNEL_CREATE', category.id);
        createdCategory = true;
      }

      let creator: VoiceChannel | null = null;
      if (existing?.creatorChannelId) {
        const channel =
          guild.channels.cache.get(existing.creatorChannelId) ??
          (await guild.channels.fetch(existing.creatorChannelId).catch(() => null));
        if (channel?.type === ChannelType.GuildVoice) creator = channel;
      }
      creator ??=
        category.children.cache.find(
          (channel): channel is VoiceChannel => channel.type === ChannelType.GuildVoice && channel.name === TEMP_VOICE_CREATOR_NAME,
        ) ?? null;
      if (!creator) {
        creator = await guild.channels.create({
          name: TEMP_VOICE_CREATOR_NAME,
          type: ChannelType.GuildVoice,
          parent: category.id,
          reason: 'Biri oda oluşturma kanalı',
        });
        this.selfActions.register(guild.id, 'CHANNEL_CREATE', creator.id);
        createdCreator = true;
      } else if (creator.parentId !== category.id) {
        this.selfActions.register(guild.id, 'CHANNEL_UPDATE', creator.id);
        await creator.setParent(category.id, { lockPermissions: true });
      }

      const config = await this.repo.upsertConfig(guild.id, {
        categoryId: category.id,
        creatorChannelId: creator.id,
        emptyDeleteDelaySec: options.emptyDeleteDelaySec,
        ownerGraceSec: options.ownerGraceSec,
        maxRoomsPerMember: options.maxRoomsPerMember,
        defaultUserLimit: options.defaultUserLimit,
      });
      this.configs.set(guild.id, config);
      const panel = await this.ensurePanel(guild, config, { create: options.panel ?? true });
      return { config: this.configs.get(guild.id) ?? config, createdCategory, createdCreator, panel };
    });
  }

  /**
   * Creates or refreshes the persistent control panel: a read-only text channel
   * in the temp voice category holding one message with room controls. An
   * existing message is edited in place, so there is never more than one.
   */
  async ensurePanel(guild: Guild, config: TempVoiceConfig, options: { create: boolean }): Promise<PanelResult> {
    try {
      let channel: TextChannel | null = null;
      if (config.panelChannelId) {
        const stored = guild.channels.cache.get(config.panelChannelId) ?? (await guild.channels.fetch(config.panelChannelId).catch(() => null));
        if (stored?.type === ChannelType.GuildText) channel = stored;
      }
      const category = this.categoryFor(guild, config);
      let created = false;
      if (!channel && options.create) {
        channel =
          category?.children.cache.find(
            (child): child is TextChannel => child.type === ChannelType.GuildText && child.name === HUB_CHANNEL_NAME,
          ) ?? null;
        if (!channel) {
          channel = await guild.channels.create({
            name: HUB_CHANNEL_NAME,
            type: ChannelType.GuildText,
            parent: category?.id ?? null,
            topic: 'Geçici ses odanı buradaki düğmelerle yönet.',
            permissionOverwrites: this.panelOverwrites(guild, category),
            reason: 'Biri oda kontrol paneli',
          });
          this.selfActions.register(guild.id, 'CHANNEL_CREATE', channel.id);
          created = true;
        }
      }
      if (!channel) return { channelId: null, created: false, error: null };

      const payload = { ...buildHubPanel(config.creatorChannelId), allowedMentions: { parse: [] as [] } };
      const existing =
        config.panelMessageId && config.panelChannelId === channel.id
          ? await channel.messages.fetch(config.panelMessageId).catch(() => null)
          : null;
      const message = existing ? await existing.edit(payload) : await channel.send(payload);
      await this.repo.setPanel(guild.id, channel.id, message.id);
      this.configs.set(guild.id, { ...config, panelChannelId: channel.id, panelMessageId: message.id });
      return { channelId: channel.id, created, error: null };
    } catch (error) {
      this.logger.warn({ err: error, guildId: guild.id }, 'Oda kontrol paneli kurulamadı');
      return { channelId: null, created: false, error: describeError(error) };
    }
  }

  /** Category visibility is inherited; members can read the panel but not post in it. */
  private panelOverwrites(guild: Guild, category: CategoryChannel | null): OverwriteResolvable[] {
    const readOnly =
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.AddReactions |
      PermissionFlagsBits.CreatePublicThreads |
      PermissionFlagsBits.CreatePrivateThreads |
      PermissionFlagsBits.SendMessagesInThreads;
    const inherited = category ? this.categoryOverwrites(category).filter((o) => o.type === OverwriteType.Role) : [];
    const everyone = inherited.find((o) => o.id === guild.roles.everyone.id);
    const roles = inherited
      .filter((o) => o.id !== guild.roles.everyone.id)
      .map((o) => ({ id: o.id, type: OverwriteType.Role, allow: o.allow & ~readOnly, deny: o.deny }));
    return [
      ...roles,
      { id: guild.roles.everyone.id, type: OverwriteType.Role, allow: (everyone?.allow ?? 0n) & ~readOnly, deny: (everyone?.deny ?? 0n) | readOnly },
      {
        id: guild.members.me?.id ?? guild.client.user.id,
        type: OverwriteType.Member,
        allow:
          PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.ReadMessageHistory,
      },
    ];
  }

  // ───────────────────────────── room index ─────────────────────────────

  getRoom(channelId: string | null | undefined): TempVoiceRoom | undefined {
    return channelId ? this.rooms.get(channelId) : undefined;
  }

  roomsOwnedBy(guildId: string, userId: string): TempVoiceRoom[] {
    return [...this.rooms.values()].filter((room) => room.guildId === guildId && room.ownerId === userId);
  }

  activeRoomCount(guildId?: string): number {
    if (!guildId) return this.rooms.size;
    let count = 0;
    for (const room of this.rooms.values()) if (room.guildId === guildId) count++;
    return count;
  }

  async updateRoom(channelId: string, data: Parameters<TempVoiceRepository['updateRoom']>[1]): Promise<TempVoiceRoom | null> {
    const updated = await this.repo.updateRoom(channelId, data);
    if (updated) this.rooms.set(channelId, updated);
    return updated;
  }

  // ───────────────────────────── voice events ─────────────────────────────

  async handleVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
    if (oldState.channelId === newState.channelId) return;
    const member = newState.member ?? oldState.member;
    if (!member) return;
    const guild = newState.guild;

    if (oldState.channelId) await this.onLeave(guild, oldState.channelId, member);
    if (newState.channelId) await this.onJoin(guild, newState.channelId, member);
  }

  private async onJoin(guild: Guild, channelId: string, member: GuildMember): Promise<void> {
    const room = this.rooms.get(channelId);
    if (room) {
      this.timers.cancel(`delete:${channelId}`);
      this.joins.join(channelId, member.id);
      if (member.id === room.ownerId && this.timers.cancel(`transfer:${channelId}`)) {
        await this.updateRoom(channelId, { ownerLeftAt: null });
      }
      return;
    }
    const config = await this.getConfig(guild.id);
    if (config?.enabled && channelId === config.creatorChannelId && !member.user.bot) {
      await this.createRoomFor(member, config);
    }
  }

  private async onLeave(guild: Guild, channelId: string, member: GuildMember): Promise<void> {
    const room = this.rooms.get(channelId);
    if (!room) return;
    this.joins.leave(channelId, member.id);
    const channel = this.voiceChannel(guild, channelId);
    if (!channel) {
      await this.forgetRoom(channelId);
      return;
    }
    const config = await this.getConfig(guild.id);
    if (this.humanCount(channel) === 0) {
      this.scheduleDeletion(guild, channelId, (config?.emptyDeleteDelaySec ?? 10) * 1000);
      return;
    }
    if (member.id === room.ownerId) {
      await this.updateRoom(channelId, { ownerLeftAt: new Date() });
      this.scheduleTransfer(guild, channelId, (config?.ownerGraceSec ?? 30) * 1000);
    }
  }

  // ───────────────────────────── creation ─────────────────────────────

  /** Creates a room for a member waiting in the creator channel. Safe to call concurrently. */
  async createRoomFor(member: GuildMember, config: TempVoiceConfig): Promise<VoiceChannel | null> {
    const guild = member.guild;
    return this.userLocks.run(`create:${guild.id}:${member.id}`, () =>
      this.creationSlots.run(guild.id, async () => {
        // State may have changed while waiting for the lock.
        if (member.voice.channelId !== config.creatorChannelId) return null;

        const missing = this.missingPermissions(guild);
        if (missing.length > 0) {
          this.warnMissingPermissions(guild, missing);
          return null;
        }

        const owned = this.roomsOwnedBy(guild.id, member.id).filter((room) => this.voiceChannel(guild, room.channelId));
        if (owned.length >= config.maxRoomsPerMember) {
          const existing = owned[0] ? this.voiceChannel(guild, owned[0].channelId) : null;
          if (existing) await member.voice.setChannel(existing, 'Biri: mevcut odaya yönlendirme').catch(() => undefined);
          return null;
        }

        const category = this.categoryFor(guild, config);
        const name = buildRoomName(member.displayName);
        const permissionState: RoomPermissionState = {
          everyoneRoleId: guild.roles.everyone.id,
          botId: guild.members.me?.id ?? guild.client.user.id,
          ownerId: member.id,
          locked: false,
          hidden: false,
          categoryOverwrites: category ? this.categoryOverwrites(category) : [],
          allowedUserIds: [],
          blockedUserIds: [],
          connectedUserIds: [],
        };

        let channel: VoiceChannel;
        try {
          channel = await guild.channels.create({
            name,
            type: ChannelType.GuildVoice,
            parent: category?.id ?? null,
            userLimit: config.defaultUserLimit,
            permissionOverwrites: toOverwriteOptions(computeRoomOverwrites(permissionState)),
            reason: `Biri: ${member.user.tag} için geçici oda`,
          });
        } catch (error) {
          this.logger.warn({ err: error, guildId: guild.id, userId: member.id }, 'Geçici oda oluşturulamadı');
          return null;
        }
        this.selfActions.register(guild.id, 'CHANNEL_CREATE', channel.id);

        let room: TempVoiceRoom | null;
        try {
          room = await this.repo.createRoomIfUnderLimit(
            { guildId: guild.id, channelId: channel.id, ownerId: member.id, name, userLimit: config.defaultUserLimit },
            config.maxRoomsPerMember,
          );
        } catch (error) {
          this.logger.error({ err: error, guildId: guild.id }, 'Geçici oda veritabanına yazılamadı; kanal geri alınıyor');
          room = null;
        }
        if (!room) {
          await this.deleteChannelSafely(guild, channel);
          return null;
        }
        this.rooms.set(channel.id, room);

        try {
          await member.voice.setChannel(channel, 'Biri: oda sahibini odasına taşı');
          this.joins.join(channel.id, member.id);
        } catch {
          // The member left before being moved; the empty room is cleaned up normally.
          this.scheduleDeletion(guild, channel.id, config.emptyDeleteDelaySec * 1000);
        }

        await channel
          .send({
            embeds: [
              brandEmbed()
                .setTitle('🔊 Biri • Odan Hazır!')
                .setDescription('Sana özel ses odan oluşturuldu.')
                .addFields(
                  { name: 'Oda', value: name.replace(/^🔊・/, ''), inline: true },
                  { name: 'Sahip', value: userMention(member.id), inline: true },
                )
                .setFooter({ text: 'Odanı yönetmek için /odam komutunu kullanabilirsin.' }),
            ],
            allowedMentions: { parse: [] },
          })
          .catch(() => undefined);

        this.log(
          guild.id,
          brandEmbed(COLORS.success)
            .setTitle('🔊 Oda Oluşturuldu')
            .setDescription(`${channelMention(channel.id)} odası ${userMention(member.id)} için oluşturuldu.`),
        );
        return channel;
      }),
    );
  }

  private categoryFor(guild: Guild, config: TempVoiceConfig): CategoryChannel | null {
    const category = guild.channels.cache.get(config.categoryId);
    if (category?.type === ChannelType.GuildCategory) return category;
    const creator = guild.channels.cache.get(config.creatorChannelId);
    const parent = creator && 'parent' in creator ? creator.parent : null;
    return parent?.type === ChannelType.GuildCategory ? parent : null;
  }

  private categoryOverwrites(category: CategoryChannel): BaseOverwrite[] {
    return category.permissionOverwrites.cache.map((overwrite) => ({
      id: overwrite.id,
      type: overwrite.type,
      allow: overwrite.allow.bitfield,
      deny: overwrite.deny.bitfield,
    }));
  }

  private warnMissingPermissions(guild: Guild, missing: string[]): void {
    if (this.permissionWarnings.has(guild.id)) return;
    this.permissionWarnings.set(guild.id, true);
    this.logger.warn({ guildId: guild.id, missing }, 'Geçici oda için bot yetkileri eksik');
    this.log(
      guild.id,
      brandEmbed(COLORS.warning)
        .setTitle('⚠️ Eksik Yetki')
        .setDescription(`Geçici oda oluşturulamadı. Botun şu yetkileri eksik: **${missing.join(', ')}**`),
    );
  }

  // ───────────────────────────── permissions ─────────────────────────────

  async permissionState(guild: Guild, room: TempVoiceRoom, channel: VoiceBasedChannel): Promise<RoomPermissionState> {
    const config = await this.getConfig(guild.id);
    const category = config ? this.categoryFor(guild, config) : null;
    const [restrictions, allowed] = await Promise.all([this.repo.listRestrictions(room.id), this.repo.listAllowed(room.id)]);
    return {
      everyoneRoleId: guild.roles.everyone.id,
      botId: guild.members.me?.id ?? guild.client.user.id,
      ownerId: room.ownerId,
      locked: room.locked,
      hidden: room.hidden,
      categoryOverwrites: category ? this.categoryOverwrites(category) : [],
      allowedUserIds: allowed.map((entry) => entry.userId),
      blockedUserIds: restrictions.map((entry) => entry.userId),
      connectedUserIds: [...channel.members.keys()],
    };
  }

  /** Overwrite count the room would have with the given modification. */
  async projectedOverwriteCount(guild: Guild, room: TempVoiceRoom, channel: VoiceBasedChannel, extraUserId: string): Promise<number> {
    const state = await this.permissionState(guild, room, channel);
    state.allowedUserIds.push(extraUserId);
    return computeRoomOverwrites(state).length;
  }

  /** Rebuilds and applies the room's complete overwrite set in one request. */
  async applyPermissions(guild: Guild, channelId: string): Promise<void> {
    const room = this.rooms.get(channelId);
    const channel = this.voiceChannel(guild, channelId);
    if (!room || !channel) return;
    const overwrites = computeRoomOverwrites(await this.permissionState(guild, room, channel));
    if (overwrites.length > MAX_ROOM_OVERWRITES + 10) throw new Error('Kanal izin sınırı aşıldı');
    this.selfActions.register(guild.id, 'OVERWRITE_UPDATE', channelId);
    await channel.permissionOverwrites.set(toOverwriteOptions(overwrites), 'Biri: oda izinleri güncellendi');
  }

  // ───────────────────────────── deletion ─────────────────────────────

  scheduleDeletion(guild: Guild, channelId: string, delayMs: number): void {
    this.timers.schedule(`delete:${channelId}`, delayMs, () => this.deleteRoom(guild, channelId, { reason: 'empty' }).then(() => undefined));
  }

  isDeletionScheduled(channelId: string): boolean {
    return this.timers.has(`delete:${channelId}`);
  }

  isTransferScheduled(channelId: string): boolean {
    return this.timers.has(`transfer:${channelId}`);
  }

  /**
   * Deletes a tracked temp room. Untracked channels are never touched, and an
   * empty-check is repeated under the room lock unless `force` is set.
   */
  async deleteRoom(guild: Guild, channelId: string, options: { reason: 'empty' | 'owner' | 'admin'; actorId?: string }): Promise<boolean> {
    return this.roomLocks.run(`room:${channelId}`, async () => {
      const room = this.rooms.get(channelId);
      if (!room || room.guildId !== guild.id) return false;
      const config = await this.getConfig(guild.id);
      if (config && channelId === config.creatorChannelId) return false;

      const channel = this.voiceChannel(guild, channelId);
      if (channel) {
        if (options.reason === 'empty' && this.humanCount(channel) > 0) return false;
        if (options.reason !== 'empty') {
          for (const connected of channel.members.values()) {
            await connected.voice.disconnect('Biri: oda kapatıldı').catch(() => undefined);
          }
        }
        const deleted = await this.deleteChannelSafely(guild, channel);
        if (!deleted) return false;
      }
      await this.forgetRoom(channelId);
      this.log(
        guild.id,
        brandEmbed(COLORS.muted)
          .setTitle('🗑️ Oda Kapatıldı')
          .setDescription(
            `**${room.name}** odası ${
              options.reason === 'empty' ? 'boş kaldığı için otomatik olarak' : `${userMention(options.actorId)} tarafından`
            } kapatıldı.`,
          ),
      );
      return true;
    });
  }

  private async deleteChannelSafely(guild: Guild, channel: VoiceBasedChannel): Promise<boolean> {
    this.selfActions.register(guild.id, 'CHANNEL_DELETE', channel.id);
    try {
      await channel.delete('Biri: geçici oda kapatıldı');
      return true;
    } catch (error) {
      if (isUnknownResource(error)) return true;
      this.selfActions.unregister(guild.id, 'CHANNEL_DELETE', channel.id);
      this.logger.warn({ err: error, guildId: guild.id, channelId: channel.id }, 'Geçici oda silinemedi');
      return false;
    }
  }

  private async forgetRoom(channelId: string): Promise<void> {
    this.rooms.delete(channelId);
    this.joins.clear(channelId);
    this.timers.cancel(`delete:${channelId}`);
    this.timers.cancel(`transfer:${channelId}`);
    await this.repo.deleteRoom(channelId).catch((error: unknown) => this.logger.error({ err: error, channelId }, 'Oda kaydı silinemedi'));
  }

  /** A tracked room or the creator channel was deleted by someone else. */
  async handleChannelDeleted(guild: Guild, channelId: string): Promise<void> {
    if (this.rooms.has(channelId)) {
      await this.forgetRoom(channelId);
      return;
    }
    const config = await this.getConfig(guild.id);
    if (config?.panelChannelId === channelId) {
      await this.repo.setPanel(guild.id, null, null);
      this.configs.set(guild.id, { ...config, panelChannelId: null, panelMessageId: null });
      return;
    }
    if (config?.creatorChannelId === channelId) {
      await this.repo.setConfigEnabled(guild.id, false);
      this.configs.set(guild.id, { ...config, enabled: false });
      this.log(
        guild.id,
        brandEmbed(COLORS.warning)
          .setTitle('⚠️ Oda Oluşturma Kanalı Silindi')
          .setDescription('Geçici ses sistemi devre dışı bırakıldı. Yeniden etkinleştirmek için `/kur` komutunu kullanın.'),
      );
    }
  }

  // ───────────────────────────── ownership ─────────────────────────────

  private scheduleTransfer(guild: Guild, channelId: string, delayMs: number): void {
    this.timers.schedule(`transfer:${channelId}`, delayMs, async () => {
      await this.autoTransfer(guild, channelId);
    });
  }

  /** Picks a successor deterministically after the owner's grace period expired. */
  async autoTransfer(guild: Guild, channelId: string): Promise<TransferResult> {
    const room = this.rooms.get(channelId);
    const channel = this.voiceChannel(guild, channelId);
    if (!room || !channel) return { ok: false, reason: 'NO_ROOM' };
    if (channel.members.has(room.ownerId)) {
      await this.updateRoom(channelId, { ownerLeftAt: null });
      return { ok: false, reason: 'SAME_OWNER' };
    }
    const candidates = channel.members.filter((m) => !m.user.bot).map((m) => m.id);
    const successor = pickSuccessor(candidates, (userId) => this.joins.joinedAt(channelId, userId));
    if (!successor) {
      const config = await this.getConfig(guild.id);
      this.scheduleDeletion(guild, channelId, (config?.emptyDeleteDelaySec ?? 10) * 1000);
      return { ok: false, reason: 'NOT_IN_ROOM' };
    }
    return this.transferOwnership(guild, channelId, successor, { expectedOwnerId: room.ownerId, actorId: null });
  }

  /**
   * Atomically moves ownership (compare-and-swap on the stored owner), then
   * rebuilds the room permissions so only the new owner holds owner access.
   */
  async transferOwnership(
    guild: Guild,
    channelId: string,
    newOwnerId: string,
    options: { expectedOwnerId: string; actorId: string | null },
  ): Promise<TransferResult> {
    return this.roomLocks.run(`room:${channelId}`, async () => {
      const room = this.rooms.get(channelId);
      const channel = this.voiceChannel(guild, channelId);
      if (!room || !channel) return { ok: false, reason: 'NO_ROOM' } as const;
      if (room.ownerId !== options.expectedOwnerId) return { ok: false, reason: 'OWNER_CHANGED' } as const;
      if (room.ownerId === newOwnerId) return { ok: false, reason: 'SAME_OWNER' } as const;
      if (!channel.members.has(newOwnerId)) return { ok: false, reason: 'NOT_IN_ROOM' } as const;

      const swapped = await this.repo.transferOwnership(channelId, room.ownerId, newOwnerId);
      if (!swapped) {
        const fresh = await this.repo.findRoomByChannel(channelId);
        if (fresh) this.rooms.set(channelId, fresh);
        return { ok: false, reason: 'OWNER_CHANGED' } as const;
      }
      const previousOwnerId = room.ownerId;
      this.rooms.set(channelId, { ...room, ownerId: newOwnerId, ownerLeftAt: null });
      this.timers.cancel(`transfer:${channelId}`);
      // The new owner must not stay blocked in their own room.
      await this.repo.removeRestriction(room.id, newOwnerId);

      try {
        await this.applyPermissions(guild, channelId);
      } catch (error) {
        this.logger.warn({ err: error, channelId }, 'Devir sonrası izinler uygulanamadı');
      }

      const how = options.actorId ? `${userMention(options.actorId)} tarafından devredildi` : 'sahibi ayrıldığı için otomatik devredildi';
      await channel
        .send({
          embeds: [brandEmbed().setTitle('👑 Sahiplik Devredildi').setDescription(`Oda sahipliği ${userMention(newOwnerId)} kullanıcısına geçti.`)],
          allowedMentions: { users: [newOwnerId] },
        })
        .catch(() => undefined);
      this.log(
        guild.id,
        brandEmbed(COLORS.primary)
          .setTitle('👑 Sahiplik Devri')
          .setDescription(`${channelMention(channelId)}: ${userMention(previousOwnerId)} → ${userMention(newOwnerId)} (${how}).`),
      );
      return { ok: true, previousOwnerId, newOwnerId } as const;
    });
  }

  // ───────────────────────────── recovery ─────────────────────────────

  /** Rebuilds state for a guild after a restart and cleans up stale records. */
  async recoverGuild(guild: Guild): Promise<{ restored: number; removed: number }> {
    const config = await this.repo.getConfig(guild.id);
    this.configs.set(guild.id, config);
    let restored = 0;
    let removed = 0;

    const rooms = await this.repo.listRooms(guild.id);
    for (const room of rooms) {
      const channel = this.voiceChannel(guild, room.channelId) ?? (await this.fetchVoiceChannel(guild, room.channelId));
      if (!channel) {
        await this.repo.deleteRoom(room.channelId).catch(() => undefined);
        removed++;
        continue;
      }
      this.rooms.set(room.channelId, room);
      restored++;
      for (const member of channel.members.values()) this.joins.join(channel.id, member.id);
      this.reconcileRoomTimers(guild, room, channel, config);
    }

    if (config?.enabled) {
      const creator = this.voiceChannel(guild, config.creatorChannelId) ?? (await this.fetchVoiceChannel(guild, config.creatorChannelId));
      if (!creator) {
        await this.handleChannelDeleted(guild, config.creatorChannelId);
      } else {
        for (const member of creator.members.values()) {
          if (!member.user.bot) void this.createRoomFor(member, config);
        }
        // Refresh an existing panel to the current version; never create one implicitly.
        await this.ensurePanel(guild, config, { create: false });
      }
    }
    return { restored, removed };
  }

  /** Periodic safety net: drops records whose channels vanished and re-arms missing timers. */
  async sweep(guild: Guild): Promise<void> {
    const config = await this.getConfig(guild.id);
    for (const room of [...this.rooms.values()]) {
      if (room.guildId !== guild.id) continue;
      const channel = this.voiceChannel(guild, room.channelId);
      if (!channel) {
        await this.forgetRoom(room.channelId);
        continue;
      }
      this.reconcileRoomTimers(guild, room, channel, config);
    }
  }

  private reconcileRoomTimers(guild: Guild, room: TempVoiceRoom, channel: VoiceBasedChannel, config: TempVoiceConfig | null): void {
    const deleteDelay = (config?.emptyDeleteDelaySec ?? 10) * 1000;
    const grace = (config?.ownerGraceSec ?? 30) * 1000;
    if (this.humanCount(channel) === 0) {
      if (!this.isDeletionScheduled(channel.id)) this.scheduleDeletion(guild, channel.id, deleteDelay);
      return;
    }
    if (!channel.members.has(room.ownerId) && !this.isTransferScheduled(channel.id)) {
      const elapsed = room.ownerLeftAt ? Date.now() - room.ownerLeftAt.getTime() : 0;
      this.scheduleTransfer(guild, channel.id, Math.max(0, grace - elapsed));
    }
  }

  forgetGuild(guildId: string): void {
    for (const room of [...this.rooms.values()]) {
      if (room.guildId !== guildId) continue;
      this.rooms.delete(room.channelId);
      this.joins.clear(room.channelId);
      this.timers.cancel(`delete:${room.channelId}`);
      this.timers.cancel(`transfer:${room.channelId}`);
    }
    this.configs.delete(guildId);
  }

  shutdown(): void {
    this.timers.cancelAll();
  }

  // ───────────────────────────── helpers ─────────────────────────────

  voiceChannel(guild: Guild, channelId: string): VoiceBasedChannel | null {
    const channel = guild.channels.cache.get(channelId);
    return channel?.isVoiceBased() ? channel : null;
  }

  private async fetchVoiceChannel(guild: Guild, channelId: string): Promise<VoiceBasedChannel | null> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    return channel?.isVoiceBased() ? channel : null;
  }

  humanCount(channel: VoiceBasedChannel): number {
    return channel.members.filter((member) => !member.user.bot).size;
  }

  describeFailure(error: unknown): string {
    return describeError(error);
  }
}

