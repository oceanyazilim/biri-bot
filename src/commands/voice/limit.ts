import { MAX_VOICE_USER_LIMIT } from '../../config/constants';
import type { SlashCommand } from '../../types/command';
import { runRoomAction, voiceCommandBuilder } from './shared';

const command: SlashCommand = {
  category: 'voice',
  data: voiceCommandBuilder('limit', 'Odanın kullanıcı limitini ayarlar').addIntegerOption((option) =>
    option
      .setName('sayi')
      .setDescription(`Kullanıcı limiti (1-${MAX_VOICE_USER_LIMIT})`)
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(MAX_VOICE_USER_LIMIT),
  ),
  async execute(interaction, app) {
    const limit = interaction.options.getInteger('sayi', true);
    await runRoomAction(interaction, app, (ctx) => app.rooms.setLimit(ctx, limit));
  },
};

export default command;
