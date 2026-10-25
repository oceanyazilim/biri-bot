import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';

const command: SlashCommand = {
  category: 'admin',
  data: new SlashCommandBuilder().setName('yardim').setDescription('Biri komutlarını listeler').setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const embed = brandEmbed()
      .setTitle('📖 Biri • Komutlar')
      .setDescription('**➕・Oda Oluştur** kanalına katılarak kendi ses odanı oluşturabilirsin.')
      .addFields(
        {
          name: '🔊 Oda Yönetimi',
          value: [
            '`/odam` — Oda yönetim paneli',
            '`/oda` — Oda bilgileri',
            '`/kilit` • `/ac` — Odayı kilitle / aç',
            '`/gizle` • `/goster` — Odayı gizle / göster',
            '`/limit` • `/limitsiz` — Kullanıcı limiti',
            '`/isim` — Odayı yeniden adlandır',
            '`/at` — Kullanıcıyı odadan çıkar (sunucudan atmaz)',
            '`/engelle` • `/engel-kaldir` — Odaya özel engel',
            '`/izin-ver` • `/izin-kaldir` — Özel erişim',
            '`/devret` — Sahipliği devret',
            '`/oda-sil` — Odayı kapat',
          ].join('\n'),
        },
        {
          name: '🛡️ Biri Guard (Yöneticiler)',
          value: [
            '`/guard-kur` — Güvenlik sistemini ve log kanallarını kur',
            '`/guard-durum` — Koruma durumu',
            '`/guard-ac` • `/guard-kapat` — Guard’ı aç / kapat',
            '`/guard-mod` — İzleme / Uyarı / Aktif mod',
            '`/guard-esik` • `/guard-modul` • `/guard-ayar` — Kurallar',
            '`/guard-guvenilir-ekle` • `-cikar` • `-liste` — Güvenilir liste',
            '`/guard-yetkili` — Guard yöneticileri (yalnızca sunucu sahibi)',
            '`/guard-olaylar` — Son güvenlik olayları',
            '`/guard-iade` — Alınan rolleri geri ver',
          ].join('\n'),
        },
        {
          name: '🔨 Moderasyon',
          value: ['`.ban <@kullanıcı | ID> [sebep]` — Sunucudan yasakla', '`.kick <@kullanıcı | ID> [sebep]` — Sunucudan at', '`.unban <ID> [sebep]` — Yasağı kaldır'].join('\n'),
        },
        {
          name: '⚙️ Kurulum',
          value: [
            '`/auto-setup` — Ses odaları + log kanalları + Guard, tek seferde',
            '`/kur` — Yalnızca geçici ses sistemi (Sunucuyu Yönet yetkisi gerekir)',
          ].join('\n'),
        },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;
