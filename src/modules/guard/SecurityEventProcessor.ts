import type { Guild } from 'discord.js';
import type { GuardRepository } from '../../database/repositories/types';
import type { HealthService } from '../../services/HealthService';
import {
  maxSeverity,
  type ExemptionReason,
  type GuardModule,
  type GuardSettings,
  type NormalizedSecurityEvent,
  type Severity,
  type TargetType,
} from '../../types/guard';
import { DedupeSet } from '../../utils/collections';
import type { Logger } from '../../utils/logger';
import { normalizeAuditEntry, type AuditEntryLike, type DetectorContext } from './detectors';
import { ThresholdTracker, classifyCount } from './detectors/ThresholdTracker';
import type { IncidentManager, IncidentOutcome } from './enforcement/IncidentManager';
import type { GuardConfigService } from './GuardConfigService';
import type { EventReport, GuardReporter } from './GuardReporter';
import { decideProtection, type PolicyDecision } from './policies/ProtectionPolicy';
import type { TrustService } from './TrustService';

export interface ProcessedEvent {
  event: NormalizedSecurityEvent;
  severity: Severity;
  decision: PolicyDecision;
  exemption: ExemptionReason | null;
  count: number;
  outcome: IncidentOutcome | null;
  /** False when the event was skipped as a database-level duplicate. */
  recorded: boolean;
}

export interface UnattributedInput {
  module: GuardModule;
  eventType: string;
  targetId: string;
  targetType: TargetType;
  targetName: string | null;
  attributionFailure: 'NO_ENTRY' | 'AMBIGUOUS' | 'NO_PERMISSION' | 'FETCH_FAILED';
  occurredAt: Date;
}

export interface ProcessorDeps {
  config: GuardConfigService;
  trust: TrustService;
  repo: GuardRepository;
  incidents: IncidentManager;
  reporter: GuardReporter;
  logger: Logger;
  health?: HealthService;
}

/**
 * Central Guard pipeline:
 * audit correlation → normalization → actor verification → trust check →
 * threshold evaluation → risk classification → persistence → protection policy
 * → (monitor | alert | active enforcement) → incident report.
 */
export class SecurityEventProcessor {
  private readonly processed = new DedupeSet(20_000, 30 * 60 * 1000);
  readonly tracker = new ThresholdTracker();

  constructor(private readonly deps: ProcessorDeps) {}

  /** Processes one audit log entry. Duplicate deliveries of the same entry are ignored. */
  async processAuditEntry(guild: Guild, entry: AuditEntryLike, attribution: 'GATEWAY_AUDIT' | 'FETCHED_AUDIT'): Promise<ProcessedEvent[]> {
    // Biri's own administrative actions are never security events.
    if (entry.executorId && entry.executorId === guild.client.user?.id) return [];
    if (!this.processed.mark(`${guild.id}:${entry.id}`)) return [];

    let settings: GuardSettings;
    try {
      settings = await this.deps.config.get(guild.id);
      if (!settings.enabled) return [];
      await this.deps.trust.preload(guild.id);
    } catch (error) {
      // Allow a later redelivery (e.g. the fallback fetch) to retry this entry.
      this.processed.forget(`${guild.id}:${entry.id}`);
      this.deps.logger.error({ err: error, guildId: guild.id }, 'Guard ayarları okunamadı; olay işlenemedi');
      return [];
    }

    const ctx: DetectorContext = {
      guildId: guild.id,
      rolePermissions: (roleId) => guild.roles.cache.get(roleId)?.permissions.bitfield ?? null,
      roleName: (roleId) => guild.roles.cache.get(roleId)?.name ?? null,
      isTrustedRole: (roleId) => this.deps.trust.isTrustedRoleCached(guild.id, roleId),
    };
    const events = normalizeAuditEntry(entry, ctx).map((event) => ({ ...event, attribution }));
    const results: ProcessedEvent[] = [];
    for (const event of events) {
      const result = await this.handle(guild, event, settings);
      if (result) results.push(result);
    }
    return results;
  }

  /** A gateway event for which no reliable audit entry exists. Logged, never sanctioned. */
  async processUnattributed(guild: Guild, input: UnattributedInput): Promise<ProcessedEvent | null> {
    let settings: GuardSettings;
    try {
      settings = await this.deps.config.get(guild.id);
    } catch (error) {
      this.deps.logger.error({ err: error, guildId: guild.id }, 'Guard ayarları okunamadı');
      return null;
    }
    if (!settings.enabled) return null;
    const event: NormalizedSecurityEvent = {
      guildId: guild.id,
      module: input.module,
      eventType: input.eventType,
      dedupeId: null,
      auditEntryId: null,
      executorId: null,
      executorVerified: false,
      attribution: 'NONE',
      targetId: input.targetId,
      targetType: input.targetType,
      targetName: input.targetName,
      baseSeverity: 'LOW',
      weight: 1,
      occurredAt: input.occurredAt,
      details: { attributionFailure: input.attributionFailure },
    };
    return this.handle(guild, event, settings);
  }

  private async handle(guild: Guild, rawEvent: NormalizedSecurityEvent, settings: GuardSettings): Promise<ProcessedEvent | null> {
    const moduleSettings = settings.modules[rawEvent.module];
    if (!moduleSettings.enabled) return null;
    this.deps.health?.increment('guard.events');

    const event = await this.applyBotTrust(guild, rawEvent);

    // Actor verification and trust check.
    let exemption: ExemptionReason | null = null;
    if (event.executorVerified && event.executorId) {
      try {
        exemption = await this.deps.trust.exemptionFor(guild, event.executorId);
      } catch (error) {
        // Fail safe: without a trust decision we cannot be sure a sanction is justified.
        this.deps.logger.error({ err: error, guildId: guild.id }, 'Güven listesi okunamadı; yaptırım devre dışı');
        exemption = 'TRUST_CHECK_FAILED';
      }
    }

    // Threshold evaluation (only attributable actions can be counted per executor).
    let count = 0;
    let spanSec = 0;
    let severity: Severity = event.baseSeverity;
    let thresholdReached = false;
    if (event.executorVerified && event.executorId) {
      const tracked = this.tracker.record(
        ThresholdTracker.key(guild.id, event.module, event.executorId),
        { id: event.dedupeId ?? `${event.eventType}:${event.occurredAt.getTime()}`, at: event.occurredAt.getTime(), weight: event.weight },
        moduleSettings.windowSec * 1000,
      );
      count = tracked.count;
      spanSec = tracked.spanSec;
      const classification = classifyCount(count, moduleSettings);
      severity = maxSeverity(severity, classification.severity);
      thresholdReached = classification.thresholdReached;
    }

    const decision = decideProtection({
      mode: settings.mode,
      module: moduleSettings,
      severity,
      thresholdReached,
      executorVerified: event.executorVerified,
      exemption,
    });

    // Persist before acting, so the record exists even if Discord calls fail.
    let eventId: string | null = null;
    try {
      const row = await this.deps.repo.recordEvent({
        guildId: guild.id,
        module: event.module,
        eventType: event.eventType,
        auditEntryId: event.dedupeId,
        executorId: event.executorId,
        executorVerified: event.executorVerified,
        targetId: event.targetId,
        targetType: event.targetType,
        targetName: event.targetName,
        details: JSON.stringify({ ...event.details, count, attribution: event.attribution, exemption, decision: decision.reason }),
        severity,
        actionTaken: decision.action === 'LOG' ? 'LOGGED' : 'ALERTED',
        actionSucceeded: null,
        occurredAt: event.occurredAt,
      });
      if (!row) {
        return { event, severity, decision, exemption, count, outcome: null, recorded: false };
      }
      eventId = row.id;
    } catch (error) {
      this.deps.logger.error({ err: error, guildId: guild.id }, 'Güvenlik olayı veritabanına yazılamadı; işleme devam ediliyor');
    }

    let outcome: IncidentOutcome | null = null;
    if (decision.openIncident && event.executorId) {
      outcome = await this.deps.incidents.handle(guild, event, decision, {
        severity,
        count,
        windowSec: moduleSettings.windowSec,
        mode: settings.mode,
        cooldownSec: settings.incidentCooldownSec,
      });
      if (eventId) {
        await this.deps.repo
          .updateEvent(eventId, { actionTaken: outcome.action, actionSucceeded: outcome.duplicate ? null : outcome.succeeded, incidentId: outcome.incidentId })
          .catch(() => undefined);
      }
      if (!outcome.duplicate) this.deps.health?.increment(`guard.incidents.${outcome.action}`);
    }

    const report: EventReport = { event, severity, decision, count, spanSec, exemption, settings };
    try {
      if (outcome && !outcome.duplicate) await this.deps.reporter.reportIncident(guild, outcome, report);
      else this.deps.reporter.reportEvent(guild, report);
    } catch (error) {
      this.deps.logger.warn({ err: error, guildId: guild.id }, 'Güvenlik raporu gönderilemedi');
    }

    return { event, severity, decision, exemption, count, outcome, recorded: true };
  }

  private async applyBotTrust(guild: Guild, event: NormalizedSecurityEvent): Promise<NormalizedSecurityEvent> {
    if (event.module !== 'BOT_ADD' || !event.targetId) return event;
    const trusted = await this.deps.trust.isTrustedBot(guild.id, event.targetId).catch(() => false);
    return trusted
      ? { ...event, eventType: 'TRUSTED_BOT_ADDED', baseSeverity: 'LOW' }
      : { ...event, eventType: 'UNKNOWN_BOT_ADDED', baseSeverity: 'HIGH' };
  }
}
