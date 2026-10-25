import type { SlashCommand } from '../../types/command';
import { roleMention, userMention } from '../../utils/format';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-guvenilir-cikar', 'Güvenilir listeden kullanıcı, bot veya rol çıkarır')
    .addUserOption((option) => option.setName('kullanici').setDescription('Çıkarılacak kullanıcı veya bot'))
    .addRoleOption((option) => option.setName('rol').setDescription('Çıkarılacak rol')),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const user = interaction.options.getUser('kullanici');
    const role = interaction.options.getRole('rol');
    if ((user ? 1 : 0) + (role ? 1 : 0) !== 1) return replyError(interaction, 'Bir kullanıcı **veya** bir rol seçmelisin.');
    const targetId = (user?.id ?? role?.id)!;
    const label = user ? userMention(user.id) : roleMention(targetId);

    const removed = await app.trust.remove(interaction.guildId, targetId);
    if (!removed) return replyError(interaction, `${label} güvenilir listede değil.`);
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Güvenilir listeden çıkarıldı: ${label}`, { targetId });
    await replySuccess(interaction, `${label} güvenilir listeden çıkarıldı.`, '🗑️ Güvenilir Çıkarıldı');
  },
};

export default command;
