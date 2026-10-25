import type { GuardConfigUpdate } from '../../database/repositories/types';
import type { SlashCommand } from '../../types/command';
import { roleMention, yesNo } from '../../utils/format';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-ayar', 'Bildirim, olay bekleme ve kayıt saklama ayarları')
    .addRoleOption((option) => option.setName('bildirim-rolu').setDescription('Kritik olaylarda etiketlenecek rolü ekler/kaldırır'))
    .addBooleanOption((option) => option.setName('sahibe-bildir').setDescription('Kritik olaylarda sunucu sahibine bildirim gönderilsin mi?'))
    .addIntegerOption((option) =>
      option.setName('olay-bekleme').setDescription('Aynı kişi için yeni olay açılmadan önceki süre (saniye)').setMinValue(30).setMaxValue(3600),
    )
    .addIntegerOption((option) =>
      option.setName('kayit-saklama').setDescription('Güvenlik kayıtlarının saklanacağı gün sayısı').setMinValue(7).setMaxValue(365),
    ),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const current = await app.guardConfig.get(interaction.guildId);
    const update: GuardConfigUpdate = {};
    const changes: string[] = [];

    const role = interaction.options.getRole('bildirim-rolu');
    if (role) {
      const roles = new Set(current.notifyRoleIds);
      if (roles.has(role.id)) {
        roles.delete(role.id);
        changes.push(`Bildirim rolü kaldırıldı: ${roleMention(role.id)}`);
      } else {
        if (roles.size >= 5) return replyError(interaction, 'En fazla 5 bildirim rolü eklenebilir.');
        roles.add(role.id);
        changes.push(`Bildirim rolü eklendi: ${roleMention(role.id)}`);
      }
      update.notifyRoleIds = [...roles].join(',');
    }
    const notifyOwner = interaction.options.getBoolean('sahibe-bildir');
    if (notifyOwner !== null) {
      update.notifyOwner = notifyOwner;
      changes.push(`Sahibe bildirim: ${yesNo(notifyOwner)}`);
    }
    const cooldown = interaction.options.getInteger('olay-bekleme');
    if (cooldown !== null) {
      update.incidentCooldownSec = cooldown;
      changes.push(`Olay bekleme süresi: ${cooldown} sn`);
    }
    const retention = interaction.options.getInteger('kayit-saklama');
    if (retention !== null) {
      update.logRetentionDays = retention;
      changes.push(`Kayıt saklama: ${retention} gün`);
    }
    if (changes.length === 0) return replyError(interaction, 'Değiştirilecek en az bir ayar seçmelisin.');

    await app.guardConfig.update(interaction.guildId, update);
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, changes.join(' • '));
    await replySuccess(interaction, changes.join('\n'), '⚙️ Guard Ayarları Güncellendi');
  },
};

export default command;
