import { MODULE_LABELS } from '../../config/constants';
import type { SlashCommand } from '../../types/command';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, MODULE_CHOICES, moduleOption, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-esik', 'Bir modülün algılama eşiklerini değiştirir')
    .addStringOption((option) => option.setName('modul').setDescription('Koruma modülü').setRequired(true).addChoices(...MODULE_CHOICES))
    .addIntegerOption((option) =>
      option.setName('kritik').setDescription('Kritik eşik: bu kadar işlemde yaptırım/olay tetiklenir').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addIntegerOption((option) =>
      option.setName('sure').setDescription('Algılama penceresi (saniye)').setMinValue(1).setMaxValue(3600),
    )
    .addIntegerOption((option) =>
      option.setName('uyari').setDescription('Uyarı eşiği (0 = kapalı, kritik eşikten küçük olmalı)').setMinValue(0).setMaxValue(99),
    ),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const module = moduleOption(interaction);
    if (!module) return replyError(interaction, 'Geçersiz modül.');
    const current = (await app.guardConfig.get(interaction.guildId)).modules[module];
    const threshold = interaction.options.getInteger('kritik', true);
    const windowSec = interaction.options.getInteger('sure') ?? current.windowSec;
    let warnThreshold = interaction.options.getInteger('uyari') ?? current.warnThreshold;
    if (warnThreshold >= threshold) {
      if (interaction.options.getInteger('uyari') !== null) {
        return replyError(interaction, 'Uyarı eşiği kritik eşikten küçük olmalı.');
      }
      warnThreshold = 0;
    }
    const updated = await app.guardConfig.updateModule(interaction.guildId, module, { threshold, windowSec, warnThreshold });
    const summary = `**${MODULE_LABELS[module]}**: uyarı ${updated.warnThreshold || 'kapalı'}, kritik ${updated.threshold} işlem / ${updated.windowSec} sn`;
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Eşik değişti — ${summary}`);
    await replySuccess(interaction, summary, '📏 Eşik Güncellendi');
  },
};

export default command;
