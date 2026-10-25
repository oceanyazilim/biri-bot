import { MODULE_LABELS, SEVERITY_LABELS } from '../../config/constants';
import type { ModuleConfigUpdate } from '../../database/repositories/types';
import type { SlashCommand } from '../../types/command';
import { onOff, yesNo } from '../../utils/format';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, MODULE_CHOICES, moduleOption, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-modul', 'Bir koruma modülünü yapılandırır')
    .addStringOption((option) => option.setName('modul').setDescription('Koruma modülü').setRequired(true).addChoices(...MODULE_CHOICES))
    .addBooleanOption((option) => option.setName('aktif').setDescription('Modül açık mı?'))
    .addBooleanOption((option) => option.setName('otomatik-rol-alma').setDescription('Aktif modda eşik aşılınca roller alınsın mı?'))
    .addStringOption((option) =>
      option
        .setName('seviye')
        .setDescription('Eşik aşıldığında risk seviyesi')
        .addChoices({ name: 'Yüksek', value: 'HIGH' }, { name: 'Kritik', value: 'CRITICAL' }),
    ),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const module = moduleOption(interaction);
    if (!module) return replyError(interaction, 'Geçersiz modül.');
    const update: ModuleConfigUpdate = {};
    const enabled = interaction.options.getBoolean('aktif');
    const autoStrip = interaction.options.getBoolean('otomatik-rol-alma');
    const severity = interaction.options.getString('seviye');
    if (enabled !== null) update.enabled = enabled;
    if (autoStrip !== null) update.autoStrip = autoStrip;
    if (severity === 'HIGH' || severity === 'CRITICAL') update.severity = severity;
    if (Object.keys(update).length === 0) return replyError(interaction, 'Değiştirilecek en az bir ayar seçmelisin.');

    const updated = await app.guardConfig.updateModule(interaction.guildId, module, update);
    const summary =
      `**${MODULE_LABELS[module]}** — Durum: ${onOff(updated.enabled)} • Otomatik rol alma: ${yesNo(updated.autoStrip)} • ` +
      `Seviye: ${SEVERITY_LABELS[updated.severity]}`;
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Modül ayarı değişti — ${summary}`);
    await replySuccess(interaction, summary, '🧩 Modül Güncellendi');
  },
};

export default command;
