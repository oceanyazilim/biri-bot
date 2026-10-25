import { MessageFlags } from 'discord.js';
import { COLORS, LOG_CHANNEL_NAMES, MODE_LABELS, type LogStructureKind } from '../../config/constants';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { GUARD_MODULES } from '../../types/guard';
import { describeError } from '../../utils/discordErrors';
import { channelMention } from '../../utils/format';
import { guardCommandBuilder, requireGuardManager } from '../guard/shared';

const kindName = (kind: LogStructureKind) => (kind === 'CATEGORY' ? 'Kategori' : LOG_CHANNEL_NAMES[kind]);

/**
 * One-shot server setup: temp voice (category + creator channel), the
 * protected log structure and Guard. Idempotent — existing channels are reused.
 */
const command: SlashCommand = {
  category: 'admin',
  cooldownMs: 30_000,
  data: guardCommandBuilder('auto-setup', 'Ses odası sistemini, log kanallarını ve Guard korumasını tek seferde kurar'),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    const embed = brandEmbed(COLORS.success).setTitle('⚙️ Biri • Otomatik Kurulum');
    let failed = false;

    // 1. Temp voice
    const missingVoice = app.tempVoice.missingPermissions(guild);
    if (missingVoice.length > 0) {
      failed = true;
      embed.addFields({ name: '🔊 Ses Odaları', value: `❌ Kurulamadı. Botun eksik yetkileri: **${missingVoice.join(', ')}**` });
    } else {
      try {
        const existing = await app.tempVoice.getConfig(guild.id);
        const voice = await app.tempVoice.setup(guild, {
          emptyDeleteDelaySec: existing?.emptyDeleteDelaySec ?? 10,
          ownerGraceSec: existing?.ownerGraceSec ?? 30,
          maxRoomsPerMember: existing?.maxRoomsPerMember ?? 1,
          defaultUserLimit: existing?.defaultUserLimit ?? 0,
        });
        embed.addFields({
          name: '🔊 Ses Odaları',
          value:
            `✅ Kategori: ${channelMention(voice.config.categoryId)}${voice.createdCategory ? ' (yeni)' : ' (mevcut)'}\n` +
            `✅ Oluşturma kanalı: ${channelMention(voice.config.creatorChannelId)}${voice.createdCreator ? ' (yeni)' : ' (mevcut)'}`,
        });
      } catch (error) {
        failed = true;
        app.logger.warn({ err: error, guildId: guild.id }, 'Otomatik kurulum: ses sistemi kurulamadı');
        embed.addFields({ name: '🔊 Ses Odaları', value: `❌ Kurulamadı: ${describeError(error)}` });
      }
    }

    // 2. Log channels + Guard
    try {
      const { logs, warnings } = await app.guard.setup(guild, interaction.user.id);
      const settings = await app.guardConfig.get(guild.id);
      const guardLog = await app.logChannels.getChannelId(guild.id, 'GUARD');
      const lines = [
        logs.created.length > 0 ? `✅ Oluşturulan: ${logs.created.map(kindName).join(', ')}` : null,
        logs.reused.length > 0 ? `♻️ Mevcut: ${logs.reused.map(kindName).join(', ')}` : null,
        ...logs.failed.map((f) => `❌ ${kindName(f.kind)}: ${f.reason}`),
      ].filter(Boolean);
      if (logs.failed.length > 0) failed = true;
      embed.addFields(
        { name: '📋 Log Kanalları', value: lines.join('\n') || '—' },
        {
          name: '🛡️ Guard',
          value:
            `Durum: ✅ Açık • Mod: ${MODE_LABELS[settings.mode]} • Aktif modül: ${GUARD_MODULES.filter((m) => settings.modules[m].enabled).length}` +
            (guardLog ? `\nRaporlar: ${channelMention(guardLog)}` : ''),
        },
      );
      if (warnings.length > 0) embed.addFields({ name: '⚠️ Uyarılar', value: warnings.map((w) => `• ${w}`).join('\n') });
      await app.reporter.recordConfigChange(guild, interaction.user.id, 'Otomatik kurulum çalıştırıldı (ses + log + Guard)');
    } catch (error) {
      failed = true;
      app.logger.warn({ err: error, guildId: guild.id }, 'Otomatik kurulum: Guard kurulamadı');
      embed.addFields({ name: '🛡️ Guard', value: `❌ Kurulamadı: ${describeError(error)}` });
    }

    embed.addFields({
      name: '➡️ Sonraki Adımlar',
      value: [
        '• Biri rolünü **Sunucu Ayarları → Roller** listesinde yönetici rollerinin üstüne taşıyın.',
        '• Güvendiğiniz botları `/guard-guvenilir-ekle` ile ekleyin.',
        '• Hazır olduğunuzda otomatik rol alma için `/guard-mod mod:Aktif` kullanın.',
      ].join('\n'),
    });
    if (failed) embed.setColor(COLORS.warning).setDescription('Kurulum kısmen tamamlandı. Ayrıntılar aşağıda; sorunu giderip komutu tekrar çalıştırabilirsiniz.');
    else embed.setDescription('Her şey hazır! Komutu tekrar çalıştırmak güvenlidir; mevcut kanallar yeniden kullanılır.');
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
