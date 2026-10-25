import type { AuditLogEvent } from 'discord.js';
import type { NormalizedSecurityEvent } from '../../../types/guard';

/** The subset of discord.js' GuildAuditLogsEntry the detectors rely on. */
export interface AuditEntryLike {
  id: string;
  action: AuditLogEvent;
  executorId: string | null;
  targetId: string | null;
  createdTimestamp: number;
  changes: ReadonlyArray<{ key: string; old?: unknown; new?: unknown }>;
  extra?: unknown;
  reason?: string | null;
}

export interface DetectorContext {
  guildId: string;
  /** Current permissions of a role, when it is still cached. */
  rolePermissions(roleId: string): bigint | null;
  roleName(roleId: string): string | null;
  isTrustedRole(roleId: string): boolean;
}

export type Detector = (entry: AuditEntryLike, ctx: DetectorContext) => NormalizedSecurityEvent[];

export function changeOf(entry: AuditEntryLike, key: string): { old?: unknown; new?: unknown } | undefined {
  return entry.changes.find((change) => change.key === key);
}

export function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  return 0n;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Base event built from a verified audit entry. */
export function baseEvent(
  entry: AuditEntryLike,
  ctx: DetectorContext,
  partial: Pick<NormalizedSecurityEvent, 'module' | 'eventType' | 'targetType' | 'baseSeverity'> &
    Partial<Pick<NormalizedSecurityEvent, 'targetId' | 'targetName' | 'weight' | 'details' | 'dedupeId'>>,
): NormalizedSecurityEvent {
  return {
    guildId: ctx.guildId,
    module: partial.module,
    eventType: partial.eventType,
    dedupeId: partial.dedupeId ?? entry.id,
    auditEntryId: entry.id,
    executorId: entry.executorId,
    executorVerified: entry.executorId !== null,
    attribution: 'GATEWAY_AUDIT',
    targetId: partial.targetId !== undefined ? partial.targetId : entry.targetId,
    targetType: partial.targetType,
    targetName: partial.targetName ?? null,
    baseSeverity: partial.baseSeverity,
    weight: partial.weight ?? 1,
    occurredAt: new Date(entry.createdTimestamp),
    details: { ...(partial.details ?? {}), ...(entry.reason ? { reason: entry.reason } : {}) },
  };
}
