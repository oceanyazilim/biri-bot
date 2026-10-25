import { PermissionFlagsBits } from 'discord.js';
import type { SlashCommand } from '../../types/command';
import { moderationCommandBuilder, runModeration } from './shared';

const command: SlashCommand = {
  category: 'moderation',
  data: moderationCommandBuilder('kick', 'Bir üyeyi sunucudan atar', PermissionFlagsBits.KickMembers)
    .addUserOption((option) => option.setName('kullanici').setDescription('Atılacak üye').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('Atma sebebi').setMaxLength(400)),
  async execute(interaction, app) {
    await runModeration(
      interaction,
      app,
      { action: 'KICK', targetId: interaction.options.getUser('kullanici', true).id, reason: interaction.options.getString('sebep') },
      '👢 Atıldı',
    );
  },
};

export default command;
