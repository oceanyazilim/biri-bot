import { MessageFlags } from 'discord.js';
import { COLORS, MODE_LABELS, MODULE_LABELS, MODULE_INCIDENT_TITLES } from '../../config/constants';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { GUARD_MODULES, isGuardModule } from '../../types/guard';
import { discordTimestamp, roleMention, userMention, yesNo } from '../../utils/format';
import { guardCommandBuilder, requireAdministrator } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-durum', 'Biri Guard koruma durumunu gösterir'),
  async execute(interaction, app) {
    if (!(await requireAdministrator(interaction))) return;
    const guild = interaction.guild;
    const settings = await app.guardConfig.get(guild.id);
    const [incidents, trusted, managers] = await Promise.all([
      app.repos.guard.listIncidents(guild.id, 1),
      app.trust.list(guild.id),
      app.trust.managers(guild.id),
    ]);
    const activeModules = GUARD_MODULES.filter((module) => settings.modules[module].enabled);
    const last = incidents[0];
    const lastText = last
      ? `${isGuardModule(last.module) ? MODULE_INCIDENT_TITLES[last.module] : last.module} — ${userMention(last.executorId)} ${discordTimestamp(last.createdAt, 'R')}`
      : 'Şüpheli işlem bulunamadı.';

    const moduleLines = GUARD_MODULES.map((module) => {
      const m = settings.modules[module];
      const warn = m.warnThreshold > 0 ? `${m.warnThreshold}/` : '';
      return `${m.enabled ? '✅' : '⛔'} **${MODULE_LABELS[module]}** — ${warn}${m.threshold} işlem / ${m.windowSec} sn${m.autoStrip ? ' • 🔨 rol alma' : ''}`;
    });

    const embed = brandEmbed(settings.enabled ? COLORS.primary : COLORS.muted)
      .setTitle(`🛡️ Biri Guard • ${settings.enabled ? 'Koruma Aktif' : 'Koruma Kapalı'}`)
      .setDescription(settings.enabled ? 'Sunucu güvenliği izleniyor.' : 'Guard kapalı. Açmak için `/guard-ac` veya `/guard-kur`.')
      .addFields(
        { name: 'Aktif Modüller', value: String(activeModules.length), inline: true },
        { name: 'Koruma Modu', value: MODE_LABELS[settings.mode], inline: true },
        { name: 'Olay Bekleme Süresi', value: `${settings.incidentCooldownSec} sn`, inline: true },
        { name: 'Son Olay', value: lastText },
        { name: 'Modüller (uyarı/kritik eşik)', value: moduleLines.join('\n') },
        {
          name: 'Bildirimler',
          value: `Sahibe bildir: ${yesNo(settings.notifyOwner)}\nRoller: ${settings.notifyRoleIds.map(roleMention).join(', ') || 'Yok'}`,
          inline: true,
        },
        { name: 'Güvenilir / Yetkili', value: `${trusted.length} güvenilir kayıt\n${managers.length} Guard yöneticisi`, inline: true },
        { name: 'Kayıt Saklama', value: `${settings.logRetentionDays} gün`, inline: true },
      );
    const warnings = app.guard.diagnose(guild);
    if (warnings.length > 0) embed.addFields({ name: '⚠️ Uyarılar', value: warnings.map((w) => `• ${w}`).join('\n') });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

export default command;
