import { MessageFlags } from 'discord.js';
import { RoomManager } from '../../modules/tempVoice/RoomManager';
import { buildCloseConfirmation } from '../../modules/tempVoice/panel';
import type { SlashCommand } from '../../types/command';
import { replyError } from '../../utils/interactions';
import { voiceCommandBuilder } from './shared';

/** Asks for confirmation; the actual deletion happens in the room component handler. */
const command: SlashCommand = {
  category: 'voice',
  data: voiceCommandBuilder('oda-sil', 'Odanı onay alarak kapatır'),
  async execute(interaction, app) {
    const context = app.rooms.resolve(interaction.member);
    if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
    await interaction.reply({ ...buildCloseConfirmation(context.channel.id), flags: MessageFlags.Ephemeral });
  },
};

export default command;
