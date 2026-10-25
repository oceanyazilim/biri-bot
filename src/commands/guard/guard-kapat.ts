import type { SlashCommand } from '../../types/command';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-kapat', 'Biri Guard korumasını devre dışı bırakır'),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const current = await app.guardConfig.get(interaction.guildId);
    if (!current.enabled) return replyError(interaction, 'Biri Guard zaten kapalı.');
    await app.guardConfig.update(interaction.guildId, { enabled: false });
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, '⚠️ Guard devre dışı bırakıldı');
    await replySuccess(interaction, 'Biri Guard devre dışı bırakıldı. Güvenlik olayları artık izlenmiyor.', '⛔ Guard Kapatıldı');
  },
};

export default command;
