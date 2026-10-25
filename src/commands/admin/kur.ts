import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { COLORS, MAX_VOICE_USER_LIMIT } from '../../config/constants';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { channelMention, formatDuration } from '../../utils/format';
import { replyError } from '../../utils/interactions';

const command: SlashCommand = {
  category: 'admin',
  cooldownMs: 15_000,
  data: new SlashCommandBuilder()
    .setName('kur')
    .setDescription('Geçici ses odası sistemini kurar veya ayarlarını günceller')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option.setName('kategori').setDescription('Odaların oluşturulacağı mevcut kategori (boş bırakılırsa yeni oluşturulur)').addChannelTypes(ChannelType.GuildCategory),
    )
    .addIntegerOption((option) =>
      option.setName('silme-gecikmesi').setDescription('Boş oda kaç saniye sonra silinsin (varsayılan 10)').setMinValue(0).setMaxValue(300),
    )
    .addIntegerOption((option) =>
      option.setName('devir-suresi').setDescription('Sahip ayrılınca devir için bekleme süresi, saniye (varsayılan 30)').setMinValue(0).setMaxValue(600),
    )
    .addIntegerOption((option) =>
      option.setName('oda-sayisi').setDescription('Bir üyenin aynı anda sahip olabileceği oda sayısı (varsayılan 1)').setMinValue(1).setMaxValue(5),
    )
    .addIntegerOption((option) =>
      option.setName('varsayilan-limit').setDescription(`Yeni odaların kullanıcı limiti (0 = limitsiz)`).setMinValue(0).setMaxValue(MAX_VOICE_USER_LIMIT),
    )
    .addBooleanOption((option) => option.setName('log-kanali').setDescription('Ses log kanalını oluştur (varsayılan: evet)')),
  async execute(interaction, app) {
    const guild = interaction.guild;
    const missing = app.tempVoice.missingPermissions(guild);
    if (missing.length > 0) {
      return replyError(interaction, `Kurulum için botun şu yetkileri eksik: **${missing.join(', ')}**`);
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const existing = await app.tempVoice.getConfig(guild.id);
    const options = interaction.options;
    const result = await app.tempVoice.setup(guild, {
      categoryId: options.getChannel('kategori')?.id,
      emptyDeleteDelaySec: options.getInteger('silme-gecikmesi') ?? existing?.emptyDeleteDelaySec ?? 10,
      ownerGraceSec: options.getInteger('devir-suresi') ?? existing?.ownerGraceSec ?? 30,
      maxRoomsPerMember: options.getInteger('oda-sayisi') ?? existing?.maxRoomsPerMember ?? 1,
      defaultUserLimit: options.getInteger('varsayilan-limit') ?? existing?.defaultUserLimit ?? 0,
    });

    let logNote = 'Ses log kanalı oluşturulmadı.';
    if (options.getBoolean('log-kanali') ?? true) {
      const logs = await app.logChannels.ensureStructure(guild, ['VOICE', 'SYSTEM']);
      const voiceLog = await app.logChannels.getChannelId(guild.id, 'VOICE');
      logNote = voiceLog
        ? `Oda işlemleri ${channelMention(voiceLog)} kanalına kaydedilecek.`
        : `Log kanalı oluşturulamadı: ${logs.failed.map((f) => f.reason).join(', ') || 'bilinmeyen hata'}`;
    }

    const config = result.config;
    const embed = brandEmbed(COLORS.success)
      .setTitle('🔊 Biri • Geçici Ses Sistemi Hazır')
      .setDescription(
        `${channelMention(config.creatorChannelId)} kanalına katılan herkes için kişisel bir oda oluşturulacak.\n` +
          `Oda sahipleri odalarını \`/odam\` ile yönetebilir.`,
      )
      .addFields(
        { name: 'Kategori', value: `${channelMention(config.categoryId)}${result.createdCategory ? ' (yeni)' : ' (mevcut)'}`, inline: true },
        { name: 'Oluşturma Kanalı', value: `${channelMention(config.creatorChannelId)}${result.createdCreator ? ' (yeni)' : ' (mevcut)'}`, inline: true },
        { name: 'Boş Oda Silme', value: formatDuration(config.emptyDeleteDelaySec), inline: true },
        { name: 'Sahiplik Devri', value: formatDuration(config.ownerGraceSec), inline: true },
        { name: 'Üye Başına Oda', value: String(config.maxRoomsPerMember), inline: true },
        { name: 'Varsayılan Limit', value: config.defaultUserLimit === 0 ? 'Limitsiz' : String(config.defaultUserLimit), inline: true },
        {
          name: 'Kontrol Paneli',
          value: result.panel.channelId
            ? `${channelMention(result.panel.channelId)}${result.panel.created ? ' (yeni)' : ' (güncellendi)'}`
            : `❌ Oluşturulamadı${result.panel.error ? `: ${result.panel.error}` : ''}`,
          inline: true,
        },
        { name: 'Log', value: logNote },
      );
    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
