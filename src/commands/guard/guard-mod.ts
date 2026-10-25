import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { COLORS } from '../../config/constants';
import { brandEmbed } from '../../modules/logging/embeds';
import { customId, type SlashCommand } from '../../types/command';
import { isProtectionMode } from '../../types/guard';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, MODE_CHOICES, modeLabel, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-mod', 'Koruma modunu değiştirir').addStringOption((option) =>
    option
      .setName('mod')
      .setDescription('Koruma modu')
      .setRequired(true)
      .addChoices(...MODE_CHOICES),
  ),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const mode = interaction.options.getString('mod', true);
    if (!isProtectionMode(mode)) return replyError(interaction, 'Geçersiz mod.');
    const current = await app.guardConfig.get(interaction.guildId);
    if (current.mode === mode) return replyError(interaction, `Koruma modu zaten **${modeLabel(mode)}**.`);

    if (mode === 'ACTIVE') {
      // Active protection is deliberate: require an explicit confirmation click.
      const warnings = app.guard.diagnose(interaction.guild);
      const embed = brandEmbed(COLORS.warning)
        .setTitle('🛡️ Aktif Korumayı Onayla')
        .setDescription(
          'Aktif modda, güvenilir olmayan ve doğrulanmış bir kişi kritik eşiği aştığında Biri **yönetebildiği tüm rolleri otomatik olarak alır**.\n\n' +
            '• Sunucu sahibi ve güvenilir listedekiler asla cezalandırılmaz.\n' +
            '• Sorumlusu doğrulanamayan olaylarda yaptırım uygulanmaz.\n' +
            '• Alınan roller kaydedilir ve `/guard-iade` ile geri verilebilir.' +
            (warnings.length > 0 ? `\n\n⚠️ **Uyarılar:**\n${warnings.map((w) => `• ${w}`).join('\n')}` : ''),
        );
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(customId('gm', 'confirm', interaction.user.id)).setLabel('Aktif Modu Etkinleştir').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(customId('gm', 'cancel', interaction.user.id)).setLabel('Vazgeç').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      return;
    }

    await app.guardConfig.update(interaction.guildId, { mode });
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Koruma modu **${modeLabel(current.mode)}** → **${modeLabel(mode)}**`);
    await replySuccess(interaction, `Koruma modu **${modeLabel(mode)}** olarak ayarlandı.`, '🛡️ Mod Değişti');
  },
};

export default command;
