import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { App } from '../../core/App';
import { COLORS } from '../../config/constants';
import { brandEmbed, errorEmbed, successEmbed } from '../../modules/logging/embeds';
import type { NukeableChannel } from '../../modules/moderation/ModerationService';
import type { SlashCommand } from '../../types/command';
import { clip } from '../../utils/format';
import { replyError } from '../../utils/interactions';
import { ModerationRefused, moderationCommandBuilder } from './shared';

const CONFIRM_TIMEOUT_MS = 30_000;

/** Channels Biri manages itself must not be wiped: their ids are stored in the database. */
export async function protectedChannelReason(app: App, guildId: string, channelId: string): Promise<string | null> {
  if (await app.logChannels.kindOf(guildId, channelId)) return 'Bu kanal bir Biri log kanalı; sıfırlanamaz.';
  const config = await app.tempVoice.getConfig(guildId);
  if (config?.panelChannelId === channelId) return 'Bu kanal oda paneli kanalı; sıfırlanamaz.';
  return null;
}

const command: SlashCommand = {
  category: 'moderation',
  data: moderationCommandBuilder('nuke', 'Kanalı sıfırlar: kopyasını oluşturur ve eski kanalı tüm mesajlarıyla siler', PermissionFlagsBits.ManageChannels)
    .addChannelOption((option) =>
      option
        .setName('kanal')
        .setDescription('Sıfırlanacak kanal (boş bırakılırsa bu kanal)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addStringOption((option) => option.setName('sebep').setDescription('Sıfırlama sebebi').setMaxLength(400)),
  async execute(interaction, app) {
    const picked = interaction.options.getChannel('kanal') ?? interaction.channel;
    if (!picked || (picked.type !== ChannelType.GuildText && picked.type !== ChannelType.GuildAnnouncement)) {
      return replyError(interaction, 'Yalnızca yazı ve duyuru kanalları sıfırlanabilir.');
    }
    const channel = picked as NukeableChannel;
    const blocked = await protectedChannelReason(app, interaction.guildId, channel.id);
    if (blocked) return replyError(interaction, blocked);

    if (!(await confirm(interaction, channel))) return;
    const result = await app.moderation.nuke({
      guild: interaction.guild,
      moderator: interaction.member,
      channel,
      reason: interaction.options.getString('sebep') ? clip(interaction.options.getString('sebep', true), 400) : null,
      invocationId: interaction.id,
    });
    // The reply may live in the deleted channel; the interaction webhook usually still works, but never fail on it.
    await interaction
      .editReply({ embeds: [result.ok ? successEmbed(result.message, '💥 Kanal Sıfırlandı') : errorEmbed(result.message)], components: [], allowedMentions: { parse: [] } })
      .catch(() => undefined);
    if (!result.ok) throw new ModerationRefused(result.message);
  },
};

async function confirm(interaction: ChatInputCommandInteraction<'cached'>, channel: NukeableChannel): Promise<boolean> {
  const confirmId = `nuke:confirm:${interaction.id}`;
  const cancelId = `nuke:cancel:${interaction.id}`;
  const reply = await interaction.reply({
    embeds: [
      brandEmbed(COLORS.warning)
        .setTitle('💥 Kanal sıfırlansın mı?')
        .setDescription(
          `${channel.toString()} kanalının **tüm mesajları kalıcı olarak silinecek**. Kanal aynı ad, konu, izinler ve konumla yeniden oluşturulur.\n\n${CONFIRM_TIMEOUT_MS / 1000} saniye içinde onaylayın.`,
        ),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setStyle(ButtonStyle.Danger).setLabel('Evet, sıfırla').setEmoji('💥'),
        new ButtonBuilder().setCustomId(cancelId).setStyle(ButtonStyle.Secondary).setLabel('Vazgeç'),
      ),
    ],
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });
  let click: ButtonInteraction;
  try {
    click = await reply.resource!.message!.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId),
      time: CONFIRM_TIMEOUT_MS,
    });
  } catch {
    await interaction.editReply({ embeds: [errorEmbed('Süre doldu, kanal sıfırlanmadı.')], components: [] }).catch(() => undefined);
    return false;
  }
  if (click.customId === cancelId) {
    await click.update({ embeds: [successEmbed('Kanal sıfırlanmadı.', 'İptal edildi')], components: [] });
    return false;
  }
  await click.update({ embeds: [brandEmbed(COLORS.warning).setDescription('⏳ Kanal sıfırlanıyor…')], components: [] });
  return true;
}

export default command;
