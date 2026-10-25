import { MessageFlags } from 'discord.js';
import { RoomManager } from '../../modules/tempVoice/RoomManager';
import { buildRoomPanel } from '../../modules/tempVoice/panel';
import type { SlashCommand } from '../../types/command';
import { replyError } from '../../utils/interactions';
import { voiceCommandBuilder } from './shared';

const command: SlashCommand = {
  category: 'voice',
  data: voiceCommandBuilder('odam', 'Odanın yönetim panelini açar'),
  async execute(interaction, app) {
    const context = app.rooms.resolve(interaction.member);
    if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
    const details = await app.rooms.details(interaction.guild, context.room, context.channel);
    await interaction.reply({
      ...buildRoomPanel(context.room, context.channel, details),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export default command;
