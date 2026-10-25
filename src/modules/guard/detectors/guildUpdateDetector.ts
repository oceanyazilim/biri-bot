import { maxSeverity, type Severity } from '../../../types/guard';
import { baseEvent, type Detector } from './types';

interface SettingRule {
  label: string;
  severity: (oldValue: unknown, newValue: unknown) => Severity;
}

const lowered = (high: Severity, other: Severity) => (oldValue: unknown, newValue: unknown) =>
  Number(newValue) < Number(oldValue) ? high : other;

export const GUILD_SETTING_RULES: Record<string, SettingRule> = {
  name: { label: 'Sunucu adı', severity: () => 'MEDIUM' },
  icon_hash: { label: 'Sunucu simgesi', severity: () => 'MEDIUM' },
  banner_hash: { label: 'Sunucu afişi', severity: () => 'LOW' },
  splash_hash: { label: 'Davet arka planı', severity: () => 'LOW' },
  vanity_url_code: { label: 'Özel davet bağlantısı', severity: () => 'HIGH' },
  owner_id: { label: 'Sunucu sahibi', severity: () => 'HIGH' },
  verification_level: { label: 'Doğrulama seviyesi', severity: lowered('HIGH', 'LOW') },
  mfa_level: { label: 'Moderasyon için 2FA zorunluluğu', severity: lowered('HIGH', 'LOW') },
  explicit_content_filter: { label: 'Hassas içerik filtresi', severity: lowered('MEDIUM', 'LOW') },
  default_message_notifications: { label: 'Varsayılan bildirim ayarı', severity: () => 'LOW' },
  rules_channel_id: { label: 'Kurallar kanalı', severity: () => 'LOW' },
  public_updates_channel_id: { label: 'Topluluk güncellemeleri kanalı', severity: () => 'LOW' },
  system_channel_id: { label: 'Sistem mesajları kanalı', severity: () => 'LOW' },
  widget_enabled: { label: 'Sunucu widget’ı', severity: () => 'LOW' },
  afk_channel_id: { label: 'AFK kanalı', severity: () => 'INFO' },
  preferred_locale: { label: 'Topluluk dili', severity: () => 'INFO' },
};

/**
 * 9.10 Server settings protection. Every change is logged with its own risk;
 * legitimate edits stay low risk and only repeated changes reach thresholds.
 */
export const detectGuildUpdate: Detector = (entry, ctx) => {
  let severity: Severity = 'INFO';
  const changes: Array<{ key: string; label: string; old: unknown; new: unknown }> = [];
  for (const change of entry.changes) {
    const rule = GUILD_SETTING_RULES[change.key];
    const changeSeverity = rule ? rule.severity(change.old, change.new) : 'LOW';
    severity = maxSeverity(severity, changeSeverity);
    changes.push({ key: change.key, label: rule?.label ?? change.key, old: change.old ?? null, new: change.new ?? null });
  }
  if (changes.length === 0) return [];
  return [
    baseEvent(entry, ctx, {
      module: 'GUILD_UPDATE',
      eventType: 'GUILD_UPDATE',
      targetType: 'GUILD',
      targetId: ctx.guildId,
      baseSeverity: severity,
      details: { changes },
    }),
  ];
};
