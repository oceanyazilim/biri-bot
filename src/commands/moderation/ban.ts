import { PermissionFlagsBits } from 'discord.js';
import type { SlashCommand } from '../../types/command';
import { moderationCommandBuilder, runModeration } from './shared';
import { forgetBans } from './unban';

const DELETE_CHOICES = [
  { name: 'Mesajları silme', value: 0 },
  { name: 'Son 1 saat', value: 60 * 60 },
  { name: 'Son 6 saat', value: 6 * 60 * 60 },
  { name: 'Son 24 saat', value: 24 * 60 * 60 },
  { name: 'Son 3 gün', value: 3 * 24 * 60 * 60 },
  { name: 'Son 7 gün', value: 7 * 24 * 60 * 60 },
];

const command: SlashCommand = {
  category: 'moderation',
  data: moderationCommandBuilder('ban', 'Bir kullanıcıyı sunucudan yasaklar', PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName('kullanici').setDescription('Yasaklanacak kullanıcı (sunucuda olmasa da ID ile seçilebilir)').setRequired(true))
    .addStringOption((option) => option.setName('sebep').setDescription('Yasaklama sebebi').setMaxLength(400))
    .addIntegerOption((option) =>
      option
        .setName('mesaj-sil')
        .setDescription('Kullanıcının son mesajları da silinsin mi?')
        .addChoices(...DELETE_CHOICES),
    ),
  async execute(interaction, app) {
    forgetBans(interaction.guildId);
    await runModeration(
      interaction,
      app,
      {
        action: 'BAN',
        targetId: interaction.options.getUser('kullanici', true).id,
        reason: interaction.options.getString('sebep'),
        deleteMessageSeconds: interaction.options.getInteger('mesaj-sil') ?? 0,
      },
      '🔨 Yasaklandı',
    );
  },
};

export default command;
