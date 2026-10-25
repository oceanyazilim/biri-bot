import { MessageFlags } from 'discord.js';
import { COLORS, LOG_CHANNEL_NAMES, MODE_LABELS, type LogStructureKind } from '../../config/constants';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { GUARD_MODULES } from '../../types/guard';
import { channelMention } from '../../utils/format';
import { guardCommandBuilder, requireGuardManager } from './shared';

const kindName = (kind: LogStructureKind) => (kind === 'CATEGORY' ? 'Kategori' : LOG_CHANNEL_NAMES[kind]);

const command: SlashCommand = {
  category: 'guard',
  cooldownMs: 30_000,
  data: guardCommandBuilder('guard-kur', 'Biri Guard güvenlik sistemini ve korumalı log kanallarını kurar'),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const { logs, warnings } = await app.guard.setup(guild, interaction.user.id);
    const settings = await app.guardConfig.get(guild.id);
    const guardLog = await app.logChannels.getChannelId(guild.id, 'GUARD');

    const embed = brandEmbed(logs.failed.length === 0 ? COLORS.success : COLORS.warning)
      .setTitle('🛡️ Biri Guard • Kurulum Tamamlandı')
      .setDescription(
        'Sunucu güvenliği izleniyor. Log kanalları yalnızca yöneticiler ve Biri tarafından görülebilir.\n' +
          (settings.mode === 'ACTIVE'
            ? ''
            : 'Otomatik rol alma için `/guard-mod mod:Aktif` komutuyla **Aktif** modu bilinçli olarak etkinleştirin.'),
      )
      .addFields(
        { name: 'Koruma Modu', value: MODE_LABELS[settings.mode], inline: true },
        { name: 'Aktif Modüller', value: String(GUARD_MODULES.filter((m) => settings.modules[m].enabled).length), inline: true },
        { name: 'Guard Log', value: guardLog ? channelMention(guardLog) : '—', inline: true },
        { name: 'Oluşturulan', value: logs.created.map(kindName).join('\n') || 'Yok (mevcut kanallar kullanıldı)', inline: true },
        { name: 'Yeniden Kullanılan', value: logs.reused.map(kindName).join('\n') || 'Yok', inline: true },
      );
    if (logs.failed.length > 0) {
      embed.addFields({ name: '❌ Oluşturulamayan', value: logs.failed.map((f) => `${kindName(f.kind)}: ${f.reason}`).join('\n') });
    }
    if (warnings.length > 0) embed.addFields({ name: '⚠️ Kurulum Uyarıları', value: warnings.map((w) => `• ${w}`).join('\n') });

    await app.reporter.recordConfigChange(guild, interaction.user.id, 'Guard kuruldu ve etkinleştirildi');
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
