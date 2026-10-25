import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { COLORS } from '../config/constants';
import type { IncidentWithRoles } from '../database/repositories/types';
import { requireGuardManager } from '../commands/guard/shared';
import { previewRestore, restoreRoles, RESTORE_STATUS_TEXT, type RestorePreviewItem } from '../modules/guard/recovery/RoleRestorer';
import { brandEmbed } from '../modules/logging/embeds';
import { customId, type ComponentHandler } from '../types/command';
import { clip, discordTimestamp, roleMention, userMention } from '../utils/format';
import { replyError } from '../utils/interactions';

export function buildRestorePrompt(incident: IncidentWithRoles, items: RestorePreviewItem[], actorId: string, targetId: string) {
  const restorable = items.filter((item) => item.status === 'RESTORABLE').length;
  const privileged = items.filter((item) => item.status === 'PRIVILEGED').length;
  const lines = items.map((item) => `${roleMention(item.roleId)} \`${item.roleName}\` — ${RESTORE_STATUS_TEXT[item.status]}`);

  const embed = brandEmbed(COLORS.warning)
    .setTitle('↩️ Rol İadesi — Onay Gerekli')
    .setDescription(
      `${userMention(targetId)} kullanıcısından ${discordTimestamp(incident.createdAt, 'R')} alınan roller aşağıda.\n` +
        'Yalnızca hâlâ mevcut ve botun verebileceği roller iade edilir.',
    )
    .addFields(
      { name: 'Kayıtlı Roller', value: clip(lines.join('\n') || 'Kayıt yok') },
      { name: 'Olay', value: `\`${incident.id}\``, inline: true },
      { name: 'Güvenli İade', value: `${restorable} rol`, inline: true },
      { name: 'Yetkili Roller', value: `${privileged} rol`, inline: true },
    );
  if (privileged > 0) {
    embed.addFields({
      name: '⚠️ Dikkat',
      value: 'Yetkili roller (Yönetici, Rolleri Yönet vb.) yalnızca **“Yetkili Roller Dahil”** düğmesiyle ve bilinçli olarak iade edilir.',
    });
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId('gi', 'safe', incident.id, actorId))
      .setLabel('Güvenli Rolleri İade Et')
      .setStyle(ButtonStyle.Success)
      .setDisabled(restorable === 0),
    new ButtonBuilder()
      .setCustomId(customId('gi', 'all', incident.id, actorId))
      .setLabel('Yetkili Roller Dahil İade Et')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(restorable + privileged === 0 || privileged === 0),
    new ButtonBuilder().setCustomId(customId('gi', 'cancel', incident.id, actorId)).setLabel('Vazgeç').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

export const guardRestoreHandler: ComponentHandler = {
  prefix: 'gi',
  async handle(interaction, app, [action, incidentId, actorId]) {
    if (!interaction.isButton() || !action || !incidentId) return;
    if (interaction.user.id !== actorId) return replyError(interaction, 'Bu onay ekranı sana ait değil.');
    if (action === 'cancel') {
      await interaction.update({ embeds: [brandEmbed(COLORS.muted).setTitle('↩️ Rol İadesi İptal Edildi')], components: [] });
      return;
    }
    // Re-validate authorization: the button may be clicked long after it was shown.
    if (!(await requireGuardManager(interaction, app))) return;

    const incident = await app.repos.guard.getIncident(incidentId);
    if (!incident || incident.guildId !== interaction.guildId) return replyError(interaction, 'Olay kaydı bulunamadı.');
    const member = await interaction.guild.members.fetch(incident.executorId).catch(() => null);
    if (!member) return replyError(interaction, 'Kullanıcı artık sunucuda değil.');

    await interaction.deferUpdate();
    const items = previewRestore(interaction.guild, member, incident);
    const includePrivileged = action === 'all';
    const result = await restoreRoles(member, items, includePrivileged, `Biri Guard: ${interaction.user.tag} rol iadesini onayladı (olay ${incident.id})`);

    const now = new Date();
    for (const roleId of result.restored) {
      await app.repos.guard.updateSnapshot(incident.id, roleId, { restored: true, restoredAt: now }).catch(() => undefined);
    }
    const stillPending = items.filter(
      (item) => (item.status === 'RESTORABLE' || item.status === 'PRIVILEGED') && !result.restored.includes(item.roleId),
    );
    if (stillPending.length === 0) {
      await app.repos.guard.updateIncident(incident.id, { restoredAt: now, restoredById: interaction.user.id }).catch(() => undefined);
    }
    await app.reporter.recordConfigChange(
      interaction.guild,
      interaction.user.id,
      `${userMention(member.id)} kullanıcısına ${result.restored.length} rol iade edildi${includePrivileged ? ' (yetkili roller dahil)' : ''}`,
      { incidentId: incident.id, restored: result.restored, failed: result.failed },
    );

    const embed = brandEmbed(result.failed.length === 0 ? COLORS.success : COLORS.warning)
      .setTitle('↩️ Rol İadesi Tamamlandı')
      .addFields(
        { name: `İade Edilen (${result.restored.length})`, value: clip(result.restored.map(roleMention).join(', ') || 'Yok') },
        {
          name: `Başarısız (${result.failed.length})`,
          value: clip(result.failed.map((f) => `${roleMention(f.roleId)} — ${f.reason}`).join('\n') || 'Yok'),
        },
      );
    if (stillPending.length > 0 && !includePrivileged) {
      embed.addFields({ name: 'Bekleyen', value: `${stillPending.length} rol iade edilmedi (yetkili roller ayrıca onay gerektirir).` });
    }
    await interaction.editReply({ embeds: [embed], components: [] });
  },
};
