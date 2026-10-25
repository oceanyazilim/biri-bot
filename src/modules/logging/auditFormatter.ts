import { AuditLogEvent, ChannelType, OverwriteType, type EmbedBuilder } from 'discord.js';
import { COLORS, type LogChannelKind } from '../../config/constants';
import { clip, discordTimestamp, formatDuration } from '../../utils/format';
import { GUILD_SETTING_RULES } from '../guard/detectors/guildUpdateDetector';
import type { AuditEntryLike } from '../guard/detectors/types';
import { brandEmbed } from './embeds';
import { permissionDiff, permissionNames, toBits } from './permissionNames';

export interface FeedContext {
  guildId: string;
  channelName(id: string): string | null;
  roleName(id: string): string | null;
}

export interface FeedItem {
  kind: LogChannelKind;
  embed: EmbedBuilder;
}

/** discord.js resolves `target` to a Channel/Role/User/Invite/Webhook object when it can. */
type EntryWithTarget = AuditEntryLike & { target?: unknown };

const CHANNEL_TYPES: Partial<Record<number, string>> = {
  [ChannelType.GuildText]: 'Metin',
  [ChannelType.GuildVoice]: 'Ses',
  [ChannelType.GuildCategory]: 'Kategori',
  [ChannelType.GuildAnnouncement]: 'Duyuru',
  [ChannelType.GuildStageVoice]: 'Sahne',
  [ChannelType.GuildForum]: 'Forum',
  [ChannelType.GuildMedia]: 'Medya',
  [ChannelType.PublicThread]: 'Herkese açık alt başlık',
  [ChannelType.PrivateThread]: 'Özel alt başlık',
  [ChannelType.AnnouncementThread]: 'Duyuru alt başlığı',
};

const KEY_LABELS: Record<string, string> = {
  name: 'Ad',
  topic: 'Konu',
  nsfw: 'Yaş sınırlı',
  rate_limit_per_user: 'Yavaş mod',
  bitrate: 'Bit hızı',
  user_limit: 'Kullanıcı limiti',
  parent_id: 'Kategori',
  type: 'Tür',
  rtc_region: 'Ses bölgesi',
  video_quality_mode: 'Görüntü kalitesi',
  default_auto_archive_duration: 'Varsayılan arşiv süresi',
  auto_archive_duration: 'Arşiv süresi',
  archived: 'Arşivlendi',
  locked: 'Kilitli',
  invitable: 'Davet edilebilir',
  color: 'Renk',
  colors: 'Renkler',
  hoist: 'Ayrı göster',
  mentionable: 'Bahsedilebilir',
  icon_hash: 'Simge',
  unicode_emoji: 'Emoji',
  nick: 'Takma ad',
  communication_disabled_until: 'Zaman aşımı',
  mute: 'Sunucuda susturuldu',
  deaf: 'Sunucuda sağırlaştırıldı',
  code: 'Kod',
  channel_id: 'Kanal',
  max_uses: 'Maks. kullanım',
  max_age: 'Geçerlilik',
  temporary: 'Geçici üyelik',
  avatar_hash: 'Avatar',
  description: 'Açıklama',
  tags: 'Etiketler',
  available: 'Kullanılabilir',
  flags: 'Bayraklar',
  privacy_level: 'Gizlilik',
  status: 'Durum',
  location: 'Konum',
  scheduled_start_time: 'Başlangıç',
  scheduled_end_time: 'Bitiş',
  entity_type: 'Etkinlik türü',
  enabled: 'Etkin',
  event_type: 'Olay türü',
  trigger_type: 'Tetikleyici',
  ...Object.fromEntries(Object.entries(GUILD_SETTING_RULES).map(([key, rule]) => [key, rule.label])),
};

/** Keys whose values are channel ids. */
const CHANNEL_KEYS = new Set(['parent_id', 'channel_id', 'afk_channel_id', 'system_channel_id', 'rules_channel_id', 'public_updates_channel_id', 'widget_channel_id', 'safety_alerts_channel_id']);
/** Keys handled separately or too noisy to list. */
const SKIPPED_KEYS = new Set(['permissions', 'allow', 'deny', 'id', 'position', 'permission_overwrites', '$add', '$remove', 'available_tags', 'applied_tags']);

function formatValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Evet' : 'Hayır';
  if (CHANNEL_KEYS.has(key) && typeof value === 'string') return `<#${value}>`;
  if (key === 'type' && typeof value === 'number' && CHANNEL_TYPES[value]) return CHANNEL_TYPES[value]!;
  if (key === 'rate_limit_per_user' && typeof value === 'number') return value === 0 ? 'Kapalı' : formatDuration(value);
  if (key === 'bitrate' && typeof value === 'number') return `${Math.round(value / 1000)} kbps`;
  if (key === 'user_limit' && typeof value === 'number') return value === 0 ? 'Limitsiz' : String(value);
  if (key === 'max_age' && typeof value === 'number') return value === 0 ? 'Süresiz' : formatDuration(value);
  if (key === 'max_uses' && typeof value === 'number') return value === 0 ? 'Sınırsız' : String(value);
  if (key === 'color' && typeof value === 'number') return value === 0 ? 'Varsayılan' : `#${value.toString(16).padStart(6, '0')}`;
  if (key === 'communication_disabled_until' && typeof value === 'string') return discordTimestamp(new Date(value), 'f');
  if (typeof value === 'object') return clip(JSON.stringify(value), 100);
  return `\`${clip(String(value), 100)}\``;
}

function changeLines(entry: AuditEntryLike): string[] {
  return entry.changes
    .filter((change) => !SKIPPED_KEYS.has(change.key))
    .map((change) => {
      const label = KEY_LABELS[change.key] ?? change.key;
      return `• **${label}:** ${formatValue(change.key, change.old)} → ${formatValue(change.key, change.new)}`;
    });
}

function change(entry: AuditEntryLike, key: string) {
  return entry.changes.find((c) => c.key === key);
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function targetName(entry: EntryWithTarget): string | null {
  const target = entry.target as { name?: unknown; tag?: unknown; username?: unknown; code?: unknown } | null | undefined;
  return (
    stringOf(target?.tag) ??
    stringOf(target?.username) ??
    stringOf(target?.name) ??
    stringOf(target?.code) ??
    stringOf(change(entry, 'name')?.new) ??
    stringOf(change(entry, 'name')?.old)
  );
}

const user = (id: string | null) => (id ? `<@${id}> (\`${id}\`)` : '*Bilinmiyor*');

interface Spec {
  kind: LogChannelKind;
  title: string;
  color: number;
}

const SPECS: Partial<Record<AuditLogEvent, Spec>> = {
  [AuditLogEvent.GuildUpdate]: { kind: 'GENERAL', title: '⚙️ Sunucu Ayarları Değişti', color: COLORS.warning },
  [AuditLogEvent.ChannelCreate]: { kind: 'CHANNEL', title: '📁 Kanal Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.ChannelUpdate]: { kind: 'CHANNEL', title: '✏️ Kanal Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.ChannelDelete]: { kind: 'CHANNEL', title: '🗑️ Kanal Silindi', color: COLORS.critical },
  [AuditLogEvent.ChannelOverwriteCreate]: { kind: 'CHANNEL', title: '🔐 Kanal İzni Eklendi', color: COLORS.info },
  [AuditLogEvent.ChannelOverwriteUpdate]: { kind: 'CHANNEL', title: '🔐 Kanal İzni Değişti', color: COLORS.warning },
  [AuditLogEvent.ChannelOverwriteDelete]: { kind: 'CHANNEL', title: '🔐 Kanal İzni Kaldırıldı', color: COLORS.muted },
  [AuditLogEvent.ThreadCreate]: { kind: 'CHANNEL', title: '🧵 Alt Başlık Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.ThreadUpdate]: { kind: 'CHANNEL', title: '🧵 Alt Başlık Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.ThreadDelete]: { kind: 'CHANNEL', title: '🧵 Alt Başlık Silindi', color: COLORS.critical },
  [AuditLogEvent.RoleCreate]: { kind: 'ROLE', title: '🎭 Rol Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.RoleUpdate]: { kind: 'ROLE', title: '🎭 Rol Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.RoleDelete]: { kind: 'ROLE', title: '🎭 Rol Silindi', color: COLORS.critical },
  [AuditLogEvent.MemberRoleUpdate]: { kind: 'ROLE', title: '👤 Üyenin Rolleri Değişti', color: COLORS.primary },
  [AuditLogEvent.MemberUpdate]: { kind: 'MEMBER', title: '👤 Üye Güncellendi', color: COLORS.warning },
  [AuditLogEvent.MemberKick]: { kind: 'MEMBER', title: '👢 Üye Atıldı', color: COLORS.warning },
  [AuditLogEvent.MemberBanAdd]: { kind: 'MEMBER', title: '🔨 Üye Yasaklandı', color: COLORS.critical },
  [AuditLogEvent.MemberBanRemove]: { kind: 'MEMBER', title: '✅ Yasak Kaldırıldı', color: COLORS.success },
  [AuditLogEvent.MemberPrune]: { kind: 'MEMBER', title: '🧹 Üye Temizliği (Prune)', color: COLORS.critical },
  [AuditLogEvent.BotAdd]: { kind: 'MEMBER', title: '🤖 Bot Eklendi', color: COLORS.warning },
  [AuditLogEvent.MemberMove]: { kind: 'VOICE', title: '🔀 Üyeler Taşındı', color: COLORS.info },
  [AuditLogEvent.MemberDisconnect]: { kind: 'VOICE', title: '🔇 Üyelerin Ses Bağlantısı Kesildi', color: COLORS.warning },
  [AuditLogEvent.WebhookCreate]: { kind: 'WEBHOOK', title: '🔗 Webhook Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.WebhookUpdate]: { kind: 'WEBHOOK', title: '🔗 Webhook Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.WebhookDelete]: { kind: 'WEBHOOK', title: '🔗 Webhook Silindi', color: COLORS.critical },
  [AuditLogEvent.InviteCreate]: { kind: 'GENERAL', title: '✉️ Davet Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.InviteUpdate]: { kind: 'GENERAL', title: '✉️ Davet Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.InviteDelete]: { kind: 'GENERAL', title: '✉️ Davet Silindi', color: COLORS.muted },
  [AuditLogEvent.EmojiCreate]: { kind: 'GENERAL', title: '😀 Emoji Eklendi', color: COLORS.success },
  [AuditLogEvent.EmojiUpdate]: { kind: 'GENERAL', title: '😀 Emoji Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.EmojiDelete]: { kind: 'GENERAL', title: '😀 Emoji Silindi', color: COLORS.critical },
  [AuditLogEvent.StickerCreate]: { kind: 'GENERAL', title: '🏷️ Çıkartma Eklendi', color: COLORS.success },
  [AuditLogEvent.StickerUpdate]: { kind: 'GENERAL', title: '🏷️ Çıkartma Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.StickerDelete]: { kind: 'GENERAL', title: '🏷️ Çıkartma Silindi', color: COLORS.critical },
  [AuditLogEvent.IntegrationCreate]: { kind: 'GENERAL', title: '🧩 Entegrasyon Eklendi', color: COLORS.success },
  [AuditLogEvent.IntegrationUpdate]: { kind: 'GENERAL', title: '🧩 Entegrasyon Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.IntegrationDelete]: { kind: 'GENERAL', title: '🧩 Entegrasyon Kaldırıldı', color: COLORS.critical },
  [AuditLogEvent.GuildScheduledEventCreate]: { kind: 'GENERAL', title: '📅 Etkinlik Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.GuildScheduledEventUpdate]: { kind: 'GENERAL', title: '📅 Etkinlik Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.GuildScheduledEventDelete]: { kind: 'GENERAL', title: '📅 Etkinlik Silindi', color: COLORS.critical },
  [AuditLogEvent.StageInstanceCreate]: { kind: 'VOICE', title: '🎙️ Sahne Başlatıldı', color: COLORS.success },
  [AuditLogEvent.StageInstanceUpdate]: { kind: 'VOICE', title: '🎙️ Sahne Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.StageInstanceDelete]: { kind: 'VOICE', title: '🎙️ Sahne Sonlandırıldı', color: COLORS.muted },
  [AuditLogEvent.SoundboardSoundCreate]: { kind: 'GENERAL', title: '🔊 Ses Paneli Sesi Eklendi', color: COLORS.success },
  [AuditLogEvent.SoundboardSoundUpdate]: { kind: 'GENERAL', title: '🔊 Ses Paneli Sesi Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.SoundboardSoundDelete]: { kind: 'GENERAL', title: '🔊 Ses Paneli Sesi Silindi', color: COLORS.critical },
  [AuditLogEvent.AutoModerationRuleCreate]: { kind: 'GENERAL', title: '🛡️ AutoMod Kuralı Oluşturuldu', color: COLORS.success },
  [AuditLogEvent.AutoModerationRuleUpdate]: { kind: 'GENERAL', title: '🛡️ AutoMod Kuralı Düzenlendi', color: COLORS.warning },
  [AuditLogEvent.AutoModerationRuleDelete]: { kind: 'GENERAL', title: '🛡️ AutoMod Kuralı Silindi', color: COLORS.critical },
  [AuditLogEvent.MessageDelete]: { kind: 'MESSAGE', title: '🗑️ Mesaj Bir Yetkili Tarafından Silindi', color: COLORS.critical },
  [AuditLogEvent.MessageBulkDelete]: { kind: 'MESSAGE', title: '🧹 Toplu Mesaj Silme', color: COLORS.critical },
  [AuditLogEvent.MessagePin]: { kind: 'MESSAGE', title: '📌 Mesaj Sabitlendi', color: COLORS.info },
  [AuditLogEvent.MessageUnpin]: { kind: 'MESSAGE', title: '📌 Mesaj Sabitlemesi Kaldırıldı', color: COLORS.muted },
};

/**
 * Turns one audit log entry into a readable Turkish log embed and picks the
 * log channel it belongs to. Returns null for actions Biri does not log.
 */
export function formatAuditEntry(entry: EntryWithTarget, ctx: FeedContext): FeedItem | null {
  const spec = SPECS[entry.action];
  if (!spec) return null;
  const extra = (entry.extra ?? null) as Record<string, unknown> | null;
  const lines: string[] = [`**Yapan:** ${user(entry.executorId)}`];
  const embed = brandEmbed(spec.color).setTitle(spec.title);
  const name = targetName(entry);
  const id = entry.targetId;

  switch (entry.action) {
    case AuditLogEvent.ChannelCreate:
    case AuditLogEvent.ChannelUpdate:
    case AuditLogEvent.ChannelDelete:
    case AuditLogEvent.ThreadCreate:
    case AuditLogEvent.ThreadUpdate:
    case AuditLogEvent.ThreadDelete: {
      const deleted = entry.action === AuditLogEvent.ChannelDelete || entry.action === AuditLogEvent.ThreadDelete;
      const label = name ?? (id ? ctx.channelName(id) : null);
      lines.push(`**Kanal:** ${deleted ? '' : id ? `<#${id}> ` : ''}${label ? `\`${label}\`` : ''}${id ? ` (\`${id}\`)` : ''}`);
      const type = change(entry, 'type');
      const typeValue = (type?.new ?? type?.old) as number | undefined;
      if (typeValue !== undefined && CHANNEL_TYPES[typeValue] && entry.action !== AuditLogEvent.ChannelUpdate) lines.push(`**Tür:** ${CHANNEL_TYPES[typeValue]}`);
      if (entry.action === AuditLogEvent.ChannelUpdate || entry.action === AuditLogEvent.ThreadUpdate) {
        const changes = changeLines(entry);
        if (changes.length > 0) embed.addFields({ name: 'Değişiklikler', value: clip(changes.join('\n')) });
      }
      break;
    }

    case AuditLogEvent.ChannelOverwriteCreate:
    case AuditLogEvent.ChannelOverwriteUpdate:
    case AuditLogEvent.ChannelOverwriteDelete: {
      lines.push(`**Kanal:** ${id ? `<#${id}>` : '*Bilinmiyor*'}`);
      const subject = extra as { id?: string; type?: unknown; name?: string } | null;
      const typeValue = Number(change(entry, 'type')?.new ?? change(entry, 'type')?.old ?? subject?.type);
      const subjectId = subject?.id ?? stringOf(change(entry, 'id')?.new) ?? stringOf(change(entry, 'id')?.old);
      if (subjectId) {
        const isMember = typeValue === OverwriteType.Member || (subject?.type === 'member');
        lines.push(
          `**Kime:** ${subjectId === ctx.guildId ? '@everyone' : isMember ? user(subjectId) : `<@&${subjectId}> \`${ctx.roleName(subjectId) ?? subject?.name ?? subjectId}\``}`,
        );
      }
      const allow = permissionDiff(change(entry, 'allow')?.old, change(entry, 'allow')?.new);
      const deny = permissionDiff(change(entry, 'deny')?.old, change(entry, 'deny')?.new);
      const reset = [...new Set([...allow.removed, ...deny.removed])].filter((p) => !allow.added.includes(p) && !deny.added.includes(p));
      if (allow.added.length) embed.addFields({ name: '✅ İzin Verildi', value: clip(allow.added.join(', ')) });
      if (deny.added.length) embed.addFields({ name: '❌ Engellendi', value: clip(deny.added.join(', ')) });
      if (reset.length && entry.action !== AuditLogEvent.ChannelOverwriteDelete) embed.addFields({ name: '↩️ Varsayılana Döndü', value: clip(reset.join(', ')) });
      break;
    }

    case AuditLogEvent.RoleCreate:
    case AuditLogEvent.RoleUpdate:
    case AuditLogEvent.RoleDelete: {
      const label = name ?? (id ? ctx.roleName(id) : null);
      const mention = entry.action !== AuditLogEvent.RoleDelete && id ? `<@&${id}> ` : '';
      lines.push(`**Rol:** ${mention}${label ? `\`${label}\`` : ''}${id ? ` (\`${id}\`)` : ''}`);
      const permissions = change(entry, 'permissions');
      if (entry.action === AuditLogEvent.RoleUpdate) {
        const changes = changeLines(entry);
        if (changes.length) embed.addFields({ name: 'Değişiklikler', value: clip(changes.join('\n')) });
        if (permissions) {
          const diff = permissionDiff(permissions.old, permissions.new);
          if (diff.added.length) embed.addFields({ name: '➕ Eklenen İzinler', value: clip(diff.added.join(', ')) });
          if (diff.removed.length) embed.addFields({ name: '➖ Kaldırılan İzinler', value: clip(diff.removed.join(', ')) });
        }
      } else if (permissions) {
        const list = permissionNames(toBits(entry.action === AuditLogEvent.RoleCreate ? permissions.new : permissions.old));
        embed.addFields({ name: entry.action === AuditLogEvent.RoleCreate ? 'İzinler' : 'Sahip Olduğu İzinler', value: clip(list.join(', ') || 'Yok') });
      }
      break;
    }

    case AuditLogEvent.MemberRoleUpdate: {
      lines.push(`**Üye:** ${user(id)}`);
      const roleList = (value: unknown) =>
        Array.isArray(value) ? (value as Array<{ id?: string; name?: string }>).map((r) => (r.id ? `<@&${r.id}> \`${r.name ?? ''}\`` : `\`${r.name}\``)) : [];
      const added = roleList(change(entry, '$add')?.new);
      const removed = roleList(change(entry, '$remove')?.new);
      if (added.length) embed.addFields({ name: '➕ Verilen Roller', value: clip(added.join('\n')) });
      if (removed.length) embed.addFields({ name: '➖ Alınan Roller', value: clip(removed.join('\n')) });
      break;
    }

    case AuditLogEvent.MemberUpdate: {
      lines.push(`**Üye:** ${user(id)}`);
      const timeout = change(entry, 'communication_disabled_until');
      if (timeout) {
        if (timeout.new) {
          embed.setTitle('⏳ Üyeye Zaman Aşımı Uygulandı');
          lines.push(`**Bitiş:** ${discordTimestamp(new Date(String(timeout.new)), 'f')} (${discordTimestamp(new Date(String(timeout.new)), 'R')})`);
        } else {
          embed.setTitle('⏳ Zaman Aşımı Kaldırıldı').setColor(COLORS.success);
        }
      }
      const others = changeLines({ ...entry, changes: entry.changes.filter((c) => c.key !== 'communication_disabled_until') });
      if (others.length) embed.addFields({ name: 'Değişiklikler', value: clip(others.join('\n')) });
      break;
    }

    case AuditLogEvent.MemberKick:
    case AuditLogEvent.MemberBanAdd:
    case AuditLogEvent.MemberBanRemove:
    case AuditLogEvent.BotAdd:
      lines.push(`**${entry.action === AuditLogEvent.BotAdd ? 'Bot' : 'Kullanıcı'}:** ${user(id)}${name ? ` \`${name}\`` : ''}`);
      break;

    case AuditLogEvent.MemberPrune:
      lines.push(`**Atılan üye sayısı:** ${Number(extra?.removed ?? 0)}`, `**Etkinlik süresi:** ${Number(extra?.days ?? 0)} gün`);
      break;

    case AuditLogEvent.MemberMove:
    case AuditLogEvent.MemberDisconnect: {
      const channel = extra?.channel as { id?: string } | undefined;
      lines.push(`**Üye sayısı:** ${Number(extra?.count ?? 1)}`);
      if (channel?.id) lines.push(`**Hedef kanal:** <#${channel.id}>`);
      break;
    }

    case AuditLogEvent.MessageDelete:
    case AuditLogEvent.MessageBulkDelete:
    case AuditLogEvent.MessagePin:
    case AuditLogEvent.MessageUnpin: {
      const channel = (extra?.channel as { id?: string } | undefined)?.id ?? (entry.action === AuditLogEvent.MessageBulkDelete ? id : null);
      if (entry.action !== AuditLogEvent.MessageBulkDelete) lines.push(`**Mesaj sahibi:** ${user(id)}`);
      if (channel) lines.push(`**Kanal:** <#${channel}>`);
      if (extra?.count !== undefined) lines.push(`**Mesaj sayısı:** ${Number(extra.count)}`);
      const messageId = stringOf(extra?.messageId);
      if (messageId && channel) lines.push(`[Mesaja git](https://discord.com/channels/${ctx.guildId}/${channel}/${messageId})`);
      break;
    }

    case AuditLogEvent.InviteCreate:
    case AuditLogEvent.InviteUpdate:
    case AuditLogEvent.InviteDelete: {
      const code = stringOf(change(entry, 'code')?.new) ?? stringOf(change(entry, 'code')?.old) ?? name;
      if (code) lines.push(`**Davet:** \`discord.gg/${code}\``);
      const details = changeLines({ ...entry, changes: entry.changes.filter((c) => ['channel_id', 'max_uses', 'max_age', 'temporary'].includes(c.key)) });
      if (details.length) embed.addFields({ name: 'Ayrıntılar', value: clip(details.map((line) => line.replace(/— → /, '')).join('\n')) });
      break;
    }

    default: {
      if (name || id) lines.push(`**Hedef:** ${name ? `\`${name}\`` : ''}${id ? ` (\`${id}\`)` : ''}`);
      const changes = changeLines(entry);
      if (changes.length) embed.addFields({ name: 'Değişiklikler', value: clip(changes.join('\n')) });
      const permissions = change(entry, 'permissions');
      if (permissions) {
        const diff = permissionDiff(permissions.old, permissions.new);
        if (diff.added.length) embed.addFields({ name: '➕ Eklenen İzinler', value: clip(diff.added.join(', ')) });
        if (diff.removed.length) embed.addFields({ name: '➖ Kaldırılan İzinler', value: clip(diff.removed.join(', ')) });
      }
    }
  }

  if (entry.reason) embed.addFields({ name: 'Sebep', value: clip(entry.reason, 512) });
  embed.setDescription(lines.join('\n')).setFooter({ text: `Biri • Denetim kaydı ${entry.id}` }).setTimestamp(new Date(entry.createdTimestamp));
  return { kind: spec.kind, embed };
}
