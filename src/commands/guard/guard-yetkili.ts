import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { userMention } from '../../utils/format';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, requireAdministrator, requireOwner } from './shared';

/** Owner-only management of the administrators allowed to change Guard settings and trust lists. */
const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-yetkili', 'Guard ayarlarını yönetebilecek yöneticileri belirler (yalnızca sunucu sahibi)')
    .addSubcommand((sub) =>
      sub
        .setName('ekle')
        .setDescription('Bir yöneticiyi Guard yöneticisi yapar')
        .addUserOption((option) => option.setName('kullanici').setDescription('Yönetici').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cikar')
        .setDescription('Guard yöneticiliğini kaldırır')
        .addUserOption((option) => option.setName('kullanici').setDescription('Yönetici').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Guard yöneticilerini listeler')),
  async execute(interaction, app) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'liste') {
      if (!(await requireAdministrator(interaction))) return;
      const managers = await app.trust.managers(interaction.guildId);
      const embed = brandEmbed()
        .setTitle('🛡️ Guard Yöneticileri')
        .setDescription(
          `👑 ${userMention(interaction.guild.ownerId)} (sunucu sahibi)\n` + managers.map((m) => `• ${userMention(m.userId)}`).join('\n'),
        );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }

    if (!(await requireOwner(interaction))) return;
    const user = interaction.options.getUser('kullanici', true);
    if (sub === 'ekle') {
      if (user.bot) return replyError(interaction, 'Botlar Guard yöneticisi yapılamaz.');
      if (user.id === interaction.guild.ownerId) return replyError(interaction, 'Sunucu sahibi zaten tam yetkilidir.');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member?.permissions.has(PermissionFlagsBits.Administrator)) {
        return replyError(interaction, 'Guard yöneticisi olabilmek için kullanıcının **Yönetici** yetkisine sahip olması gerekir.');
      }
      const added = await app.trust.addManager(interaction.guildId, user.id, interaction.user.id);
      if (!added) return replyError(interaction, `${userMention(user.id)} zaten Guard yöneticisi.`);
      await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Guard yöneticisi eklendi: ${userMention(user.id)}`);
      return replySuccess(interaction, `${userMention(user.id)} artık Guard ayarlarını yönetebilir.`, '🛡️ Guard Yöneticisi Eklendi');
    }

    const removed = await app.trust.removeManager(interaction.guildId, user.id);
    if (!removed) return replyError(interaction, `${userMention(user.id)} Guard yöneticisi değil.`);
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Guard yöneticisi kaldırıldı: ${userMention(user.id)}`);
    await replySuccess(interaction, `${userMention(user.id)} artık Guard yöneticisi değil.`, '🛡️ Guard Yöneticisi Kaldırıldı');
  },
};

export default command;
