import type { SlashCommand } from '../../types/command';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, modeLabel, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-ac', 'Biri Guard korumasını etkinleştirir'),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    if (!(await app.logChannels.getChannelId(interaction.guildId, 'GUARD'))) {
      return replyError(interaction, 'Guard henüz kurulmamış. Önce `/guard-kur` komutunu kullanın.');
    }
    const current = await app.guardConfig.get(interaction.guildId);
    if (current.enabled) return replyError(interaction, 'Biri Guard zaten açık.');
    const settings = await app.guardConfig.update(interaction.guildId, { enabled: true, activatedById: interaction.user.id, activatedAt: new Date() });
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, 'Guard etkinleştirildi');
    await replySuccess(interaction, `Biri Guard etkinleştirildi. Koruma modu: **${modeLabel(settings.mode)}**`, '🛡️ Guard Açıldı');
  },
};

export default command;
