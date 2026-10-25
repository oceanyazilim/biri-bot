import { PermissionFlagsBits } from 'discord.js';
import type { GuardModule, GuardModuleSettings, ProtectionMode, Severity } from '../types/guard';

export const BOT_NAME = 'Biri';

export const COLORS = {
  primary: 0x8b5cf6,
  success: 0x22c55e,
  warning: 0xeab308,
  critical: 0xef4444,
  info: 0x3b82f6,
  muted: 0x6b7280,
} as const;

export const SEVERITY_COLORS: Record<Severity, number> = {
  INFO: COLORS.info,
  LOW: COLORS.muted,
  MEDIUM: COLORS.warning,
  HIGH: 0xf97316,
  CRITICAL: COLORS.critical,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  INFO: 'ℹ️ BİLGİ',
  LOW: '🟢 DÜŞÜK',
  MEDIUM: '🟡 ORTA',
  HIGH: '🟠 YÜKSEK',
  CRITICAL: '🔴 KRİTİK',
};

export const MODE_LABELS: Record<ProtectionMode, string> = {
  MONITOR: '👁️ İzleme',
  ALERT: '📣 Uyarı',
  ACTIVE: '🛡️ Aktif',
};

export const MODULE_LABELS: Record<GuardModule, string> = {
  CHANNEL_DELETE: 'Kanal Silme',
  CHANNEL_CREATE: 'Kanal Oluşturma',
  ROLE_DELETE: 'Rol Silme',
  ROLE_CREATE: 'Rol Oluşturma',
  PERMISSION_ESCALATION: 'Yetki Yükseltme',
  MEMBER_BAN: 'Toplu Yasaklama',
  MEMBER_KICK: 'Toplu Atma',
  WEBHOOK: 'Webhook Kötüye Kullanımı',
  BOT_ADD: 'Bot Ekleme',
  GUILD_UPDATE: 'Sunucu Ayarları',
};

/** Burst titles used in incident reports. */
export const MODULE_INCIDENT_TITLES: Record<GuardModule, string> = {
  CHANNEL_DELETE: 'Toplu Kanal Silme',
  CHANNEL_CREATE: 'Toplu Kanal Oluşturma',
  ROLE_DELETE: 'Toplu Rol Silme',
  ROLE_CREATE: 'Toplu Rol Oluşturma',
  PERMISSION_ESCALATION: 'Tehlikeli Yetki Değişikliği',
  MEMBER_BAN: 'Toplu Yasaklama',
  MEMBER_KICK: 'Toplu Üye Atma',
  WEBHOOK: 'Şüpheli Webhook Aktivitesi',
  BOT_ADD: 'Toplu Bot Ekleme',
  GUILD_UPDATE: 'Kritik Sunucu Ayarı Değişikliği',
};

type ModuleDefaults = Omit<GuardModuleSettings, 'module'>;

export const GUARD_MODULE_DEFAULTS: Record<GuardModule, ModuleDefaults> = {
  CHANNEL_DELETE: { enabled: true, warnThreshold: 3, threshold: 5, windowSec: 10, severity: 'CRITICAL', autoStrip: true },
  CHANNEL_CREATE: { enabled: true, warnThreshold: 5, threshold: 8, windowSec: 15, severity: 'CRITICAL', autoStrip: true },
  ROLE_DELETE: { enabled: true, warnThreshold: 2, threshold: 3, windowSec: 10, severity: 'CRITICAL', autoStrip: true },
  ROLE_CREATE: { enabled: true, warnThreshold: 5, threshold: 8, windowSec: 15, severity: 'CRITICAL', autoStrip: true },
  // Every dangerous permission change counts; sanctions require an explicit opt-in (autoStrip).
  PERMISSION_ESCALATION: { enabled: true, warnThreshold: 0, threshold: 1, windowSec: 60, severity: 'CRITICAL', autoStrip: false },
  MEMBER_BAN: { enabled: true, warnThreshold: 2, threshold: 3, windowSec: 15, severity: 'CRITICAL', autoStrip: true },
  MEMBER_KICK: { enabled: true, warnThreshold: 3, threshold: 4, windowSec: 15, severity: 'CRITICAL', autoStrip: true },
  WEBHOOK: { enabled: true, warnThreshold: 3, threshold: 5, windowSec: 15, severity: 'CRITICAL', autoStrip: true },
  BOT_ADD: { enabled: true, warnThreshold: 0, threshold: 3, windowSec: 60, severity: 'HIGH', autoStrip: false },
  GUILD_UPDATE: { enabled: true, warnThreshold: 3, threshold: 5, windowSec: 30, severity: 'HIGH', autoStrip: false },
};

/** Permissions treated as dangerous when granted to roles or @everyone. */
export const DANGEROUS_PERMISSIONS: ReadonlyArray<{ flag: bigint; label: string }> = [
  { flag: PermissionFlagsBits.Administrator, label: 'Yönetici' },
  { flag: PermissionFlagsBits.ManageGuild, label: 'Sunucuyu Yönet' },
  { flag: PermissionFlagsBits.ManageRoles, label: 'Rolleri Yönet' },
  { flag: PermissionFlagsBits.ManageChannels, label: 'Kanalları Yönet' },
  { flag: PermissionFlagsBits.ManageWebhooks, label: 'Webhookları Yönet' },
  { flag: PermissionFlagsBits.BanMembers, label: 'Üyeleri Yasakla' },
  { flag: PermissionFlagsBits.KickMembers, label: 'Üyeleri At' },
  { flag: PermissionFlagsBits.ModerateMembers, label: 'Üyelere Zaman Aşımı Uygula' },
  { flag: PermissionFlagsBits.ManageGuildExpressions, label: 'İfadeleri Yönet' },
  { flag: PermissionFlagsBits.MentionEveryone, label: '@everyone Bahset' },
];

export const DANGEROUS_PERMISSION_MASK = DANGEROUS_PERMISSIONS.reduce((mask, p) => mask | p.flag, 0n);

/** Permissions on a channel overwrite that are dangerous when granted to @everyone. */
export const DANGEROUS_OVERWRITE_MASK =
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.MentionEveryone;

/** Permissions that make a role "privileged" for snapshot/restore purposes. */
export const PRIVILEGED_ROLE_MASK =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.KickMembers;

export const LOG_CHANNEL_KINDS = ['GENERAL', 'GUARD', 'CHANNEL', 'ROLE', 'MEMBER', 'VOICE', 'MESSAGE', 'WEBHOOK', 'SYSTEM'] as const;
export type LogChannelKind = (typeof LOG_CHANNEL_KINDS)[number];
export type LogStructureKind = LogChannelKind | 'CATEGORY';

export const LOG_CATEGORY_NAME = '🛡️ BİRİ・GÜVENLİK';

export const LOG_CHANNEL_NAMES: Record<LogChannelKind, string> = {
  GENERAL: '📋・biri-genel-log',
  GUARD: '🚨・biri-guard-log',
  CHANNEL: '🗑️・biri-kanal-log',
  ROLE: '🎭・biri-rol-log',
  MEMBER: '👤・biri-uye-log',
  VOICE: '🔊・biri-ses-log',
  MESSAGE: '💬・biri-mesaj-log',
  WEBHOOK: '🔗・biri-webhook-log',
  SYSTEM: '⚙️・biri-sistem-log',
};

export const LOG_CHANNEL_TOPICS: Record<LogChannelKind, string> = {
  GENERAL: 'Sunucu ayarları, davetler, emoji/çıkartma, entegrasyon ve etkinlik kayıtları',
  GUARD: 'Biri Guard kritik güvenlik olayları ve müdahaleler',
  CHANNEL: 'Kanal ve alt başlık oluşturma, düzenleme, silme ve izin değişiklikleri',
  ROLE: 'Rol oluşturma, düzenleme, silme ve üyelere verilen/alınan roller',
  MEMBER: 'Katılma/ayrılma, yasaklama, atma, zaman aşımı, takma ad ve bot ekleme kayıtları',
  VOICE: 'Ses kanalı giriş/çıkışları, taşımalar ve geçici oda işlemleri',
  MESSAGE: 'Silinen ve düzenlenen mesajlar, toplu silmeler, sabitlemeler',
  WEBHOOK: 'Webhook oluşturma, düzenleme ve silme kayıtları',
  SYSTEM: 'Biri sistem, yapılandırma ve kurtarma kayıtları',
};

/** Which log channel receives events of a given module. */
export const MODULE_LOG_CHANNEL: Record<GuardModule, LogChannelKind> = {
  CHANNEL_DELETE: 'CHANNEL',
  CHANNEL_CREATE: 'CHANNEL',
  ROLE_DELETE: 'ROLE',
  ROLE_CREATE: 'ROLE',
  PERMISSION_ESCALATION: 'ROLE',
  MEMBER_BAN: 'MEMBER',
  MEMBER_KICK: 'MEMBER',
  WEBHOOK: 'WEBHOOK',
  BOT_ADD: 'MEMBER',
  GUILD_UPDATE: 'GENERAL',
};

export const TEMP_VOICE_CATEGORY_NAME = '🔊 BİRİ SES ODALARI';
export const TEMP_VOICE_CREATOR_NAME = '➕・Oda Oluştur';
export const TEMP_VOICE_ROOM_PREFIX = '🔊・';

/** Discord allows at most 100 channel names chars; overwrites are limited per channel. */
export const DISCORD_CHANNEL_NAME_MAX = 100;
/** Discord rejects more than 100 permission overwrites on a channel; keep a safety margin. */
export const MAX_ROOM_OVERWRITES = 90;
export const MAX_VOICE_USER_LIMIT = 99;

/** Log channel recovery loop protection: max recreations per kind within the window. */
export const LOG_RECOVERY_MAX = 3;
export const LOG_RECOVERY_WINDOW_MS = 60 * 60 * 1000;

export const STALE_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
export const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
