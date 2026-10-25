export const GUARD_MODULES = [
  'CHANNEL_DELETE',
  'CHANNEL_CREATE',
  'ROLE_DELETE',
  'ROLE_CREATE',
  'PERMISSION_ESCALATION',
  'MEMBER_BAN',
  'MEMBER_KICK',
  'WEBHOOK',
  'BOT_ADD',
  'GUILD_UPDATE',
] as const;

export type GuardModule = (typeof GUARD_MODULES)[number];

export function isGuardModule(value: string): value is GuardModule {
  return (GUARD_MODULES as readonly string[]).includes(value);
}

export const SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type Severity = (typeof SEVERITIES)[number];

export function severityRank(severity: Severity): number {
  return SEVERITIES.indexOf(severity);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

export const PROTECTION_MODES = ['MONITOR', 'ALERT', 'ACTIVE'] as const;
export type ProtectionMode = (typeof PROTECTION_MODES)[number];

export function isProtectionMode(value: string): value is ProtectionMode {
  return (PROTECTION_MODES as readonly string[]).includes(value);
}

export type TrustedType = 'USER' | 'ROLE' | 'BOT';

export type ExemptionReason = 'OWNER' | 'TRUSTED_USER' | 'TRUSTED_ROLE' | 'TRUSTED_BOT' | 'TRUST_CHECK_FAILED';

export type TargetType = 'CHANNEL' | 'ROLE' | 'USER' | 'WEBHOOK' | 'GUILD' | 'UNKNOWN';

/** Where the attribution for an event came from. */
/** BOT_COMMAND: a moderation action Biri performed on behalf of the moderator who issued the command. */
export type AttributionSource = 'GATEWAY_AUDIT' | 'FETCHED_AUDIT' | 'BOT_COMMAND' | 'NONE';

/**
 * A security-relevant administrative action, normalized from an audit log entry
 * (or from a gateway event that could not be attributed).
 */
export interface NormalizedSecurityEvent {
  guildId: string;
  module: GuardModule;
  /** Fine grained type, e.g. CHANNEL_DELETE, ROLE_PERMISSIONS_ESCALATED. */
  eventType: string;
  /** Unique id used for deduplication. Audit entry id, optionally suffixed for derived events. */
  dedupeId: string | null;
  auditEntryId: string | null;
  executorId: string | null;
  /** True only when the executor comes from a matched audit log entry. */
  executorVerified: boolean;
  attribution: AttributionSource;
  targetId: string | null;
  targetType: TargetType;
  targetName: string | null;
  /** Severity inherent to the action itself, before threshold evaluation. */
  baseSeverity: Severity;
  /** How many actions this event represents (e.g. member prune removes many members at once). */
  weight: number;
  occurredAt: Date;
  details: Record<string, unknown>;
}

export interface GuardModuleSettings {
  module: GuardModule;
  enabled: boolean;
  warnThreshold: number;
  threshold: number;
  windowSec: number;
  severity: Extract<Severity, 'HIGH' | 'CRITICAL'>;
  autoStrip: boolean;
}

export interface GuardSettings {
  guildId: string;
  enabled: boolean;
  mode: ProtectionMode;
  incidentCooldownSec: number;
  logRetentionDays: number;
  notifyOwner: boolean;
  notifyRoleIds: string[];
  modules: Record<GuardModule, GuardModuleSettings>;
}

export type EnforcementAction = 'NONE' | 'LOGGED' | 'ALERTED' | 'ROLES_STRIPPED' | 'PARTIAL' | 'FAILED' | 'ESCALATED';
