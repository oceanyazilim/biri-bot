import { COLORS, MODE_LABELS } from '../config/constants';
import { requireGuardManager } from '../commands/guard/shared';
import { brandEmbed } from '../modules/logging/embeds';
import type { ComponentHandler } from '../types/command';
import { replyError } from '../utils/interactions';

/** Confirmation for switching Guard to ACTIVE mode. */
export const guardModeHandler: ComponentHandler = {
  prefix: 'gm',
  async handle(interaction, app, [action, actorId]) {
    if (!interaction.isButton()) return;
    if (interaction.user.id !== actorId) return replyError(interaction, 'Bu onay ekranı sana ait değil.');
    if (action !== 'confirm') {
      await interaction.update({ embeds: [brandEmbed(COLORS.muted).setTitle('Aktif mod etkinleştirilmedi.')], components: [] });
      return;
    }
    if (!(await requireGuardManager(interaction, app))) return;
    const previous = await app.guardConfig.get(interaction.guildId);
    await app.guardConfig.update(interaction.guildId, { mode: 'ACTIVE', activatedById: interaction.user.id, activatedAt: new Date() });
    await app.reporter.recordConfigChange(
      interaction.guild,
      interaction.user.id,
      `Koruma modu **${MODE_LABELS[previous.mode]}** → **${MODE_LABELS.ACTIVE}** (onaylı)`,
    );
    await interaction.update({
      embeds: [
        brandEmbed(COLORS.success)
          .setTitle('🛡️ Aktif Koruma Etkinleştirildi')
          .setDescription('Doğrulanmış kritik saldırılarda yönetilebilir roller otomatik olarak alınacak.'),
      ],
      components: [],
    });
  },
};
