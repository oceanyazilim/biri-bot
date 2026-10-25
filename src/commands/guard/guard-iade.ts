import { MessageFlags } from 'discord.js';
import { buildRestorePrompt } from '../../components/guardRestore';
import type { SlashCommand } from '../../types/command';
import { userMention } from '../../utils/format';
import { replyError } from '../../utils/interactions';
import { previewRestore } from '../../modules/guard/recovery/RoleRestorer';
import { guardCommandBuilder, requireGuardManager } from './shared';

/** Shows the saved role snapshot and asks for explicit confirmation before restoring. */
const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-iade', 'Guard tarafından alınan rolleri kayıtlı anlık görüntüden geri verir').addUserOption((option) =>
    option.setName('kullanici').setDescription('Rolleri geri verilecek kullanıcı').setRequired(true),
  ),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const user = interaction.options.getUser('kullanici', true);
    const incident = await app.repos.guard.findRestorableIncident(interaction.guildId, user.id);
    if (!incident) return replyError(interaction, `${userMention(user.id)} için iade edilebilecek kayıtlı rol bulunamadı.`);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return replyError(interaction, `${userMention(user.id)} şu anda sunucuda değil; roller iade edilemez.`);

    const items = previewRestore(interaction.guild, member, incident);
    await interaction.reply({
      ...buildRestorePrompt(incident, items, interaction.user.id, user.id),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  },
};

export default command;
