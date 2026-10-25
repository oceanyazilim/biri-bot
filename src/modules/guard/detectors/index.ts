import { AuditLogEvent } from 'discord.js';
import type { NormalizedSecurityEvent } from '../../../types/guard';
import { detectChannelCreate, detectChannelDelete, detectChannelOverwrite } from './channelDetectors';
import { detectGuildUpdate } from './guildUpdateDetector';
import { detectBan, detectBotAdd, detectKick, detectPrune } from './memberDetectors';
import { detectMemberRoleUpdate, detectRoleCreate, detectRoleDelete, detectRoleUpdate } from './roleDetectors';
import type { AuditEntryLike, Detector, DetectorContext } from './types';
import { detectWebhook } from './webhookDetector';

export type { AuditEntryLike, DetectorContext } from './types';

/** Maps every audit action Biri Guard watches to its detector. */
export const DETECTORS: Partial<Record<AuditLogEvent, Detector>> = {
  [AuditLogEvent.ChannelDelete]: detectChannelDelete,
  [AuditLogEvent.ChannelCreate]: detectChannelCreate,
  [AuditLogEvent.ChannelOverwriteCreate]: detectChannelOverwrite,
  [AuditLogEvent.ChannelOverwriteUpdate]: detectChannelOverwrite,
  [AuditLogEvent.RoleDelete]: detectRoleDelete,
  [AuditLogEvent.RoleCreate]: detectRoleCreate,
  [AuditLogEvent.RoleUpdate]: detectRoleUpdate,
  [AuditLogEvent.MemberRoleUpdate]: detectMemberRoleUpdate,
  [AuditLogEvent.MemberBanAdd]: detectBan,
  [AuditLogEvent.MemberKick]: detectKick,
  [AuditLogEvent.MemberPrune]: detectPrune,
  [AuditLogEvent.BotAdd]: detectBotAdd,
  [AuditLogEvent.WebhookCreate]: detectWebhook,
  [AuditLogEvent.WebhookUpdate]: detectWebhook,
  [AuditLogEvent.WebhookDelete]: detectWebhook,
  [AuditLogEvent.GuildUpdate]: detectGuildUpdate,
};

export function normalizeAuditEntry(entry: AuditEntryLike, ctx: DetectorContext): NormalizedSecurityEvent[] {
  const detector = DETECTORS[entry.action];
  return detector ? detector(entry, ctx) : [];
}

export function isWatchedAction(action: AuditLogEvent): boolean {
  return DETECTORS[action] !== undefined;
}
