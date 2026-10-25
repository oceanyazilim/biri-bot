import { PermissionFlagsBits } from 'discord.js';

/** Turkish names as shown in the Discord client. */
const NAMES: Partial<Record<keyof typeof PermissionFlagsBits, string>> = {
  Administrator: 'Yönetici',
  ViewAuditLog: 'Denetim Kaydını Görüntüle',
  ManageGuild: 'Sunucuyu Yönet',
  ManageRoles: 'Rolleri Yönet',
  ManageChannels: 'Kanalları Yönet',
  KickMembers: 'Üyeleri At',
  BanMembers: 'Üyeleri Yasakla',
  ModerateMembers: 'Üyelere Zaman Aşımı Uygula',
  ManageNicknames: 'Kullanıcı Adlarını Yönet',
  ChangeNickname: 'Kullanıcı Adını Değiştir',
  ManageWebhooks: 'Webhookları Yönet',
  ManageGuildExpressions: 'İfadeleri Yönet',
  CreateGuildExpressions: 'İfade Oluştur',
  ManageEmojisAndStickers: 'Emoji ve Çıkartmaları Yönet',
  ManageEvents: 'Etkinlikleri Yönet',
  CreateEvents: 'Etkinlik Oluştur',
  ViewGuildInsights: 'Sunucu İstatistiklerini Görüntüle',
  ViewCreatorMonetizationAnalytics: 'Para Kazanma Analizlerini Görüntüle',
  CreateInstantInvite: 'Davet Oluştur',
  ViewChannel: 'Kanalları Görüntüle',
  SendMessages: 'Mesaj Gönder',
  SendMessagesInThreads: 'Alt Başlıklarda Mesaj Gönder',
  CreatePublicThreads: 'Herkese Açık Alt Başlık Oluştur',
  CreatePrivateThreads: 'Özel Alt Başlık Oluştur',
  ManageThreads: 'Alt Başlıkları Yönet',
  SendTTSMessages: 'Sesli Mesaj (TTS) Gönder',
  ManageMessages: 'Mesajları Yönet',
  PinMessages: 'Mesajları Sabitle',
  EmbedLinks: 'Bağlantı Yerleştir',
  AttachFiles: 'Dosya Ekle',
  ReadMessageHistory: 'Mesaj Geçmişini Oku',
  MentionEveryone: '@everyone, @here ve Tüm Rollerden Bahset',
  UseExternalEmojis: 'Harici Emoji Kullan',
  UseExternalStickers: 'Harici Çıkartma Kullan',
  AddReactions: 'Tepki Ekle',
  UseApplicationCommands: 'Uygulama Komutlarını Kullan',
  UseExternalApps: 'Harici Uygulama Kullan',
  SendVoiceMessages: 'Sesli Mesaj Gönder',
  SendPolls: 'Anket Oluştur',
  BypassSlowmode: 'Yavaş Modu Atla',
  Connect: 'Bağlan',
  Speak: 'Konuş',
  Stream: 'Görüntü',
  UseVAD: 'Ses Etkinliğini Kullan',
  PrioritySpeaker: 'Öncelikli Konuşmacı',
  MuteMembers: 'Üyeleri Sustur',
  DeafenMembers: 'Üyeleri Sağırlaştır',
  MoveMembers: 'Üyeleri Taşı',
  UseEmbeddedActivities: 'Etkinlikleri Kullan',
  UseSoundboard: 'Ses Panelini Kullan',
  UseExternalSounds: 'Harici Ses Kullan',
  RequestToSpeak: 'Konuşma İsteği',
  SetVoiceChannelStatus: 'Ses Kanalı Durumunu Ayarla',
};

const ENTRIES = Object.entries(PermissionFlagsBits) as Array<[keyof typeof PermissionFlagsBits, bigint]>;

/** Human readable Turkish names of every permission set in `bits` (deduplicated aliases). */
export function permissionNames(bits: bigint): string[] {
  const names = new Set<string>();
  for (const [key, flag] of ENTRIES) {
    if ((bits & flag) === flag && flag !== 0n) names.add(NAMES[key] ?? key);
  }
  return [...names];
}

export function toBits(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  return 0n;
}

/** "+ Yönetici, Rolleri Yönet" / "− Mesaj Gönder" lines for a permission change. */
export function permissionDiff(oldValue: unknown, newValue: unknown): { added: string[]; removed: string[] } {
  const before = toBits(oldValue);
  const after = toBits(newValue);
  return { added: permissionNames(after & ~before), removed: permissionNames(before & ~after) };
}
