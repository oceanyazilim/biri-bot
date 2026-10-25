import { MessageFlags } from 'discord.js';
import { roomInfoEmbed } from '../../modules/tempVoice/panel';
import type { SlashCommand } from '../../types/command';
import { replyError } from '../../utils/interactions';
import { voiceCommandBuilder } from './shared';

/** Shows information about the room the caller is in (or owns). Read-only, so no ownership needed. */
const command: SlashCommand = {
  category: 'voice',
  data: voiceCommandBuilder('oda', 'Bulunduğun geçici odanın bilgilerini gösterir'),
  async execute(interaction, app) {
    const member = interaction.member;
    const room =
      app.tempVoice.getRoom(member.voice.channelId) ?? app.tempVoice.roomsOwnedBy(interaction.guildId, member.id)[0];
    const channel = room ? app.tempVoice.voiceChannel(interaction.guild, room.channelId) : null;
    if (!room || !channel) return replyError(interaction, 'Şu anda bir geçici odada değilsin ve sahip olduğun bir oda yok.');
    const details = await app.rooms.details(interaction.guild, room, channel);
    await interaction.reply({ embeds: [roomInfoEmbed(room, channel, details)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

export default command;
