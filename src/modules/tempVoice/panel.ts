import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type EmbedBuilder,
  type VoiceBasedChannel,
} from 'discord.js';
import { COLORS, MAX_VOICE_USER_LIMIT, TEMP_VOICE_ROOM_PREFIX } from '../../config/constants';
import type { TempVoiceRoom } from '../../database/repositories/types';
import { customId } from '../../types/command';
import { channelMention, discordTimestamp, userMention } from '../../utils/format';
import { brandEmbed } from '../logging/embeds';

export interface RoomDetails {
  memberCount: number;
  userLimit: number;
  blocked: string[];
  allowed: string[];
}

export function roomStatusText(room: TempVoiceRoom): string {
  return `${room.locked ? '🔒 Kilitli' : '🔓 Açık'} • ${room.hidden ? '🙈 Gizli' : '👁️ Görünür'}`;
}

export function roomInfoEmbed(room: TempVoiceRoom, channel: VoiceBasedChannel, details: RoomDetails, title = 'Biri • Oda Bilgisi'): EmbedBuilder {
  const limit = details.userLimit > 0 ? String(details.userLimit) : '∞';
  return brandEmbed(COLORS.primary)
    .setTitle(title)
    .addFields(
      { name: 'Oda', value: `${channelMention(channel.id)}\n${channel.name.replace(TEMP_VOICE_ROOM_PREFIX, '')}`, inline: true },
      { name: 'Sahip', value: userMention(room.ownerId), inline: true },
      { name: 'Durum', value: roomStatusText(room), inline: true },
      { name: 'Üyeler', value: `${details.memberCount}/${limit}`, inline: true },
      { name: 'Engelliler', value: String(details.blocked.length), inline: true },
      { name: 'Özel İzinliler', value: String(details.allowed.length), inline: true },
      { name: 'Oluşturulma', value: discordTimestamp(room.createdAt, 'R'), inline: true },
    );
}

export function buildRoomPanel(room: TempVoiceRoom, channel: VoiceBasedChannel, details: RoomDetails) {
  const embed = roomInfoEmbed(room, channel, details, 'Biri • Oda Yönetimi').setDescription(
    'Aşağıdaki düğmelerle odanı yönetebilirsin. Yetkiler yalnızca bu oda için geçerlidir.',
  );
  const id = channel.id;
  const first = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId('room', 'lock', id))
      .setLabel(room.locked ? 'Kilidi Aç' : 'Kilitle')
      .setEmoji(room.locked ? '🔓' : '🔒')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(customId('room', 'hide', id))
      .setLabel(room.hidden ? 'Göster' : 'Gizle')
      .setEmoji(room.hidden ? '👁️' : '🙈')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('room', 'users', id)).setLabel('Kullanıcı Yönetimi').setEmoji('👥').setStyle(ButtonStyle.Primary),
  );
  const second = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId('room', 'settings', id)).setLabel('Oda Ayarları').setEmoji('⚙️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('room', 'transfer', id)).setLabel('Sahipliği Devret').setEmoji('👑').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(customId('room', 'close', id)).setLabel('Odayı Kapat').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [first, second] };
}

export const USER_OPERATIONS = {
  kick: { placeholder: '👢 Odadan çıkarılacak kullanıcıyı seç' },
  block: { placeholder: '⛔ Engellenecek kullanıcıyı seç' },
  unblock: { placeholder: '✅ Engeli kaldırılacak kullanıcıyı seç' },
  allow: { placeholder: '🎟️ Özel izin verilecek kullanıcıyı seç' },
  disallow: { placeholder: '🚫 Özel izni kaldırılacak kullanıcıyı seç' },
} as const;

export type UserOperation = keyof typeof USER_OPERATIONS;

export function isUserOperation(value: string): value is UserOperation {
  return value in USER_OPERATIONS;
}

export function buildUserManagement(channelId: string) {
  const rows = (Object.keys(USER_OPERATIONS) as UserOperation[]).map((operation) =>
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(customId('room', 'user', operation, channelId))
        .setPlaceholder(USER_OPERATIONS[operation].placeholder)
        .setMinValues(1)
        .setMaxValues(1),
    ),
  );
  return {
    embeds: [brandEmbed().setTitle('👥 Kullanıcı Yönetimi').setDescription('Yapmak istediğin işlemin menüsünden bir kullanıcı seç.')],
    components: rows,
  };
}

export function buildTransferMenu(channelId: string) {
  return {
    embeds: [brandEmbed().setTitle('👑 Sahipliği Devret').setDescription('Odada bulunan ve sahipliği devretmek istediğin kullanıcıyı seç.')],
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(customId('room', 'transferSelect', channelId))
          .setPlaceholder('Yeni oda sahibi')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ],
  };
}

export function buildCloseConfirmation(channelId: string) {
  return {
    embeds: [
      brandEmbed(COLORS.warning)
        .setTitle('🗑️ Odayı Kapat')
        .setDescription('Odayı kapatmak istediğine emin misin? İçerideki herkesin bağlantısı kesilir ve oda silinir.'),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId('room', 'closeYes', channelId)).setLabel('Evet, kapat').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(customId('room', 'closeNo', channelId)).setLabel('Vazgeç').setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

export function buildSettingsModal(channelId: string, currentName: string, currentLimit: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(customId('room', 'settingsModal', channelId))
    .setTitle('Oda Ayarları')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Oda adı')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(95)
          .setValue(currentName.replace(TEMP_VOICE_ROOM_PREFIX, '').slice(0, 95)),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('limit')
          .setLabel(`Kullanıcı limiti (0-${MAX_VOICE_USER_LIMIT}, 0 = limitsiz)`)
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(2)
          .setValue(String(currentLimit)),
      ),
    );
}

export const HUB_CHANNEL_NAME = '🎛️・oda-paneli';

/**
 * The persistent control panel posted in the temp voice category. Its buttons
 * carry no room id: every click acts on the clicking member's own room, so a
 * single message serves everyone and keeps working across restarts.
 */
export function buildHubPanel(creatorChannelId: string) {
  const embed = brandEmbed(COLORS.primary)
    .setTitle('🎛️ Biri • Oda Kontrol Paneli')
    .setDescription(
      `${channelMention(creatorChannelId)} kanalına katılarak kendi ses odanı oluştur, sonra odanı buradan yönet.\n\n` +
        'Düğmeler **yalnızca senin odan** üzerinde işlem yapar ve yanıtları sadece sen görürsün.',
    )
    .addFields(
      { name: '🔒 Erişim', value: 'Kilitle, kilidi aç, gizle veya göster', inline: true },
      { name: '👥 Kullanıcılar', value: 'Odadan at, engelle, özel izin ver', inline: true },
      { name: '⚙️ Oda', value: 'İsim ve limit, sahiplik devri, kapatma', inline: true },
    );
  const button = (action: string, label: string, emoji: string, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(customId('hub', action)).setLabel(label).setEmoji(emoji).setStyle(style);
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('lock', 'Kilitle', '🔒'),
        button('unlock', 'Kilidi Aç', '🔓'),
        button('hide', 'Gizle', '🙈'),
        button('show', 'Göster', '👁️'),
        button('info', 'Oda Bilgisi', 'ℹ️', ButtonStyle.Primary),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('kick', 'Odadan At', '👢'),
        button('block', 'Engelle', '⛔'),
        button('unblock', 'Engeli Kaldır', '✅'),
        button('allow', 'İzin Ver', '🎟️'),
        button('disallow', 'İzni Kaldır', '🚫'),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button('settings', 'İsim / Limit', '✏️'),
        button('transfer', 'Sahipliği Devret', '👑'),
        button('close', 'Odayı Kapat', '🗑️', ButtonStyle.Danger),
      ),
    ],
  };
}

/** A single user picker for one operation, used by the control panel. */
export function buildUserPicker(operation: UserOperation, channelId: string) {
  return {
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(customId('room', 'user', operation, channelId))
          .setPlaceholder(USER_OPERATIONS[operation].placeholder)
          .setMinValues(1)
          .setMaxValues(1),
      ),
    ],
  };
}
