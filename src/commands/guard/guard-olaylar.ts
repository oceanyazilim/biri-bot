import { MessageFlags } from 'discord.js';
import { MODULE_INCIDENT_TITLES, SEVERITY_LABELS } from '../../config/constants';
import { actionLabel, eventTypeLabel } from '../../modules/guard/GuardReporter';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { isGuardModule, SEVERITIES, type Severity } from '../../types/guard';
import { clip, discordTimestamp, userMention } from '../../utils/format';
import { guardCommandBuilder, requireAdministrator } from './shared';

const severityLabel = (value: string) => ((SEVERITIES as readonly string[]).includes(value) ? SEVERITY_LABELS[value as Severity] : value);

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-olaylar', 'Son güvenlik olaylarını gösterir')
    .addIntegerOption((option) => option.setName('sayi').setDescription('Gösterilecek kayıt sayısı (varsayılan 10)').setMinValue(1).setMaxValue(20))
    .addUserOption((option) => option.setName('kullanici').setDescription('Yalnızca bu kişinin olayları')),
  async execute(interaction, app) {
    if (!(await requireAdministrator(interaction))) return;
    const limit = interaction.options.getInteger('sayi') ?? 10;
    const user = interaction.options.getUser('kullanici');
    const [incidents, events] = await Promise.all([
      app.repos.guard.listIncidents(interaction.guildId, limit, user?.id),
      user ? Promise.resolve([]) : app.repos.guard.listEvents(interaction.guildId, limit),
    ]);

    const incidentLines = incidents.map(
      (incident) =>
        `**${isGuardModule(incident.module) ? MODULE_INCIDENT_TITLES[incident.module] : incident.module}** — ${userMention(incident.executorId)}\n` +
        `  ${severityLabel(incident.severity)} • ${actionLabel(incident.actionTaken)} • ${incident.eventCount} işlem • ${discordTimestamp(incident.createdAt, 'R')}` +
        `${incident.restoredAt ? ' • ↩️ iade edildi' : ''}\n  \`${incident.id}\``,
    );
    const eventLines = events.map(
      (event) =>
        `${severityLabel(event.severity)} ${eventTypeLabel(event.eventType)} — ${event.executorId ? userMention(event.executorId) : '❔ doğrulanmadı'} ${discordTimestamp(event.occurredAt, 'R')}`,
    );

    const embed = brandEmbed()
      .setTitle('📋 Biri Guard • Son Olaylar')
      .addFields({ name: `🚨 Güvenlik Olayları (${incidents.length})`, value: clip(incidentLines.join('\n') || 'Kayıtlı olay yok.') });
    if (!user) embed.addFields({ name: `📝 Son Kayıtlar (${events.length})`, value: clip(eventLines.join('\n') || 'Kayıt yok.') });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

export default command;
