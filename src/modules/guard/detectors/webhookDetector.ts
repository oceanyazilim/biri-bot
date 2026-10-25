import { AuditLogEvent } from 'discord.js';
import { baseEvent, changeOf, stringOrNull, type Detector } from './types';

const EVENT_TYPES: Partial<Record<AuditLogEvent, string>> = {
  [AuditLogEvent.WebhookCreate]: 'WEBHOOK_CREATE',
  [AuditLogEvent.WebhookUpdate]: 'WEBHOOK_UPDATE',
  [AuditLogEvent.WebhookDelete]: 'WEBHOOK_DELETE',
};

/**
 * 9.8 Anti Webhook Abuse. Only webhook *management* is attributed (via the
 * audit log); messages sent through a webhook have no reliable human executor
 * and are never counted.
 */
export const detectWebhook: Detector = (entry, ctx) => {
  const name = stringOrNull(changeOf(entry, 'name')?.new) ?? stringOrNull(changeOf(entry, 'name')?.old);
  const channelId = stringOrNull(changeOf(entry, 'channel_id')?.new) ?? stringOrNull(changeOf(entry, 'channel_id')?.old);
  return [
    baseEvent(entry, ctx, {
      module: 'WEBHOOK',
      eventType: EVENT_TYPES[entry.action] ?? 'WEBHOOK_UPDATE',
      targetType: 'WEBHOOK',
      targetName: name,
      baseSeverity: entry.action === AuditLogEvent.WebhookCreate ? 'LOW' : 'INFO',
      details: channelId ? { channelId } : {},
    }),
  ];
};
