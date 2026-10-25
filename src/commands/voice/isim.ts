import type { SlashCommand } from '../../types/command';
import { runRoomAction, voiceCommandBuilder } from './shared';

const command: SlashCommand = {
  category: 'voice',
  data: voiceCommandBuilder('isim', 'Odanın adını değiştirir').addStringOption((option) =>
    option.setName('yeni-isim').setDescription('Odanın yeni adı').setRequired(true).setMinLength(1).setMaxLength(95),
  ),
  async execute(interaction, app) {
    const name = interaction.options.getString('yeni-isim', true);
    await runRoomAction(interaction, app, (ctx) => app.rooms.rename(ctx, name));
  },
};

export default command;
