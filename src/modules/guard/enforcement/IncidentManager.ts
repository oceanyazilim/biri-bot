import type { Guild, GuildMember } from 'discord.js';
import { MODULE_INCIDENT_TITLES } from '../../../config/constants';
import type { GuardRepository, IncidentCreate, SecurityIncident } from '../../../database/repositories/types';
import type { EnforcementAction, NormalizedSecurityEvent, ProtectionMode, Severity } from '../../../types/guard';
import { KeyedMutex } from '../../../utils/async';
import { BoundedTtlMap } from '../../../utils/collections';
import type { Logger } from '../../../utils/logger';
import type { PolicyDecision } from '../policies/ProtectionPolicy';
import { executeStrip, planStrip, type StripOutcome, type StripPlan } from './RoleStripper';

export interface IncidentOutcome {
  incidentId: string | null;
  action: EnforcementAction;
  succeeded: boolean;
  /** The event was attached to an incident opened earlier in the cooldown window; nothing new happened. */
  duplicate: boolean;
  removedRoles: Array<{ roleId: string; roleName: string }>;
  failedRoles: Array<{ roleId: string; reason: string }>;
  reason: string | null;
  /** True when the database could not be written; the snapshot then lives only in the Discord report. */
  persistenceFailed: boolean;
  snapshotRoleIds: string[];
}

export interface IncidentContext {
  severity: Severity;
  count: number;
  windowSec: number;
  mode: ProtectionMode;
  cooldownSec: number;
}

const ENFORCED_ACTIONS = new Set(['ROLES_STRIPPED', 'PARTIAL', 'FAILED', 'ESCALATED', 'IN_PROGRESS']);

function emptyOutcome(partial: Partial<IncidentOutcome>): IncidentOutcome {
  return {
    incidentId: null,
    action: 'NONE',
    succeeded: false,
    duplicate: false,
    removedRoles: [],
    failedRoles: [],
    reason: null,
    persistenceFailed: false,
    snapshotRoleIds: [],
    ...partial,
  };
}

/**
 * Opens incidents and runs the role-removal workflow: capture snapshot →
 * persist → remove roles → record per-role results. Work is serialized per
 * (guild, executor) and deduplicated by an incident cooldown plus a unique
 * dedupe key, so one attack never punishes the same person twice.
 */
export class IncidentManager {
  private readonly mutex = new KeyedMutex();
  /** Fallback memory of recent incidents for when the database is unavailable. */
  private readonly recent = new BoundedTtlMap<string, { incidentId: string | null; action: string; at: number }>(10_000, 60 * 60 * 1000);

  constructor(
    private readonly repo: GuardRepository,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  handle(guild: Guild, event: NormalizedSecurityEvent, decision: PolicyDecision, ctx: IncidentContext): Promise<IncidentOutcome> {
    const executorId = event.executorId;
    if (!executorId) return Promise.resolve(emptyOutcome({ reason: 'Sorumlu doğrulanamadı' }));
    return this.mutex.run(`${guild.id}:${executorId}`, () => this.handleLocked(guild, executorId, event, decision, ctx));
  }

  private async handleLocked(
    guild: Guild,
    executorId: string,
    event: NormalizedSecurityEvent,
    decision: PolicyDecision,
    ctx: IncidentContext,
  ): Promise<IncidentOutcome> {
    const localKey = `${guild.id}:${executorId}`;
    const since = new Date(this.now() - ctx.cooldownSec * 1000);

    let existing: Pick<SecurityIncident, 'id' | 'actionTaken' | 'eventCount'> | null = null;
    try {
      existing = await this.repo.findRecentIncident(guild.id, executorId, since);
    } catch (error) {
      this.logger.error({ err: error, guildId: guild.id }, 'Son olaylar okunamadı; bellek içi kayıt kullanılıyor');
      const local = this.recent.get(localKey);
      if (local && local.at >= since.getTime()) existing = { id: local.incidentId ?? '', actionTaken: local.action, eventCount: 0 };
    }

    const upgradeToEnforcement = decision.action === 'ENFORCE' && existing !== null && !ENFORCED_ACTIONS.has(existing.actionTaken);
    if (existing && !upgradeToEnforcement) {
      if (existing.id && ctx.count > existing.eventCount) {
        await this.repo.updateIncident(existing.id, { eventCount: ctx.count }).catch(() => undefined);
      }
      return emptyOutcome({ incidentId: existing.id || null, action: existing.actionTaken as EnforcementAction, duplicate: true });
    }

    const base = {
      guildId: guild.id,
      executorId,
      module: event.module,
      severity: ctx.severity,
      mode: ctx.mode,
      dedupeKey: `${guild.id}:${executorId}:${event.dedupeId ?? `${event.eventType}:${event.occurredAt.getTime()}`}`,
      eventCount: ctx.count,
      windowSec: ctx.windowSec,
    };

    if (decision.action !== 'ENFORCE') {
      const action: EnforcementAction = decision.action === 'ALERT' ? 'ALERTED' : 'LOGGED';
      try {
        const incident = await this.repo.createIncident({ ...base, actionTaken: action, actionSucceeded: true, failureReason: null }, []);
        if (!incident) return emptyOutcome({ action, duplicate: true });
        this.recent.set(localKey, { incidentId: incident.id, action, at: this.now() });
        return emptyOutcome({ incidentId: incident.id, action, succeeded: true });
      } catch (error) {
        this.logger.error({ err: error, guildId: guild.id }, 'Olay kaydı oluşturulamadı');
        this.recent.set(localKey, { incidentId: null, action, at: this.now() });
        return emptyOutcome({ action, succeeded: true, persistenceFailed: true });
      }
    }

    return this.enforce(guild, executorId, event, base, localKey);
  }

  private async enforce(
    guild: Guild,
    executorId: string,
    event: NormalizedSecurityEvent,
    base: Omit<IncidentCreate, 'actionTaken' | 'actionSucceeded' | 'failureReason'>,
    localKey: string,
  ): Promise<IncidentOutcome> {
    const member: GuildMember | null = guild.members.cache.get(executorId) ?? (await guild.members.fetch(executorId).catch(() => null));

    if (!member) {
      const reason = 'Sorumlu kullanıcı sunucuda bulunamadı (ayrılmış veya bir webhook olabilir); yöneticilerin incelemesi gerekiyor';
      const incidentId = await this.createSafely({ ...base, actionTaken: 'ESCALATED', actionSucceeded: false, failureReason: reason }, []);
      this.recent.set(localKey, { incidentId: incidentId.id, action: 'ESCALATED', at: this.now() });
      if (incidentId.duplicate) return emptyOutcome({ action: 'ESCALATED', duplicate: true });
      return emptyOutcome({ incidentId: incidentId.id, action: 'ESCALATED', reason, persistenceFailed: incidentId.failed });
    }

    // 6–7: capture and store the snapshot before touching any role.
    const plan: StripPlan = planStrip(member);
    const created = await this.createSafely(
      { ...base, actionTaken: 'IN_PROGRESS', actionSucceeded: false, failureReason: null },
      plan.entries.map((entry) => ({ roleId: entry.roleId, roleName: entry.roleName, position: entry.position, privileged: entry.privileged })),
    );
    if (created.duplicate) return emptyOutcome({ action: 'NONE', duplicate: true });
    this.recent.set(localKey, { incidentId: created.id, action: 'IN_PROGRESS', at: this.now() });

    // 8–9: remove what Discord allows; leave the rest untouched.
    const reasonText = `Biri Guard: ${MODULE_INCIDENT_TITLES[event.module]}${created.id ? ` (olay ${created.id})` : ''}`;
    let strip: StripOutcome;
    try {
      strip = await executeStrip(member, plan, reasonText);
    } catch (error) {
      this.logger.error({ err: error, guildId: guild.id }, 'Rol alma işlemi beklenmedik şekilde başarısız oldu');
      strip = {
        status: 'FAILED',
        results: plan.entries.map((entry) => ({ roleId: entry.roleId, removed: false, failureReason: 'Beklenmeyen hata' })),
        reason: 'Rol alma işlemi beklenmedik bir hata nedeniyle tamamlanamadı',
        privilegedRemaining: plan.entries.filter((entry) => entry.privileged).length,
      };
    }

    // 10: record each role's result.
    const action: EnforcementAction = strip.status;
    const succeeded = strip.status === 'ROLES_STRIPPED';
    let persistenceFailed = created.failed;
    if (created.id) {
      try {
        for (const result of strip.results) {
          await this.repo.updateSnapshot(created.id, result.roleId, { removed: result.removed, failureReason: result.failureReason });
        }
        await this.repo.updateIncident(created.id, { actionTaken: action, actionSucceeded: succeeded, failureReason: strip.reason });
      } catch (error) {
        persistenceFailed = true;
        this.logger.error({ err: error, incidentId: created.id }, 'Rol alma sonuçları kaydedilemedi');
      }
    }
    this.recent.set(localKey, { incidentId: created.id, action, at: this.now() });

    const nameOf = new Map(plan.entries.map((entry) => [entry.roleId, entry.roleName]));
    return {
      incidentId: created.id,
      action,
      succeeded,
      duplicate: false,
      removedRoles: strip.results.filter((r) => r.removed).map((r) => ({ roleId: r.roleId, roleName: nameOf.get(r.roleId) ?? r.roleId })),
      failedRoles: strip.results.filter((r) => !r.removed).map((r) => ({ roleId: r.roleId, reason: r.failureReason ?? 'Bilinmeyen neden' })),
      reason: strip.reason,
      persistenceFailed,
      snapshotRoleIds: strip.results.filter((r) => r.removed).map((r) => r.roleId),
    };
  }

  private async createSafely(
    data: Parameters<GuardRepository['createIncident']>[0],
    roles: Parameters<GuardRepository['createIncident']>[1],
  ): Promise<{ id: string | null; duplicate: boolean; failed: boolean }> {
    try {
      const incident = await this.repo.createIncident(data, roles);
      if (!incident) return { id: null, duplicate: true, failed: false };
      return { id: incident.id, duplicate: false, failed: false };
    } catch (error) {
      this.logger.error({ err: error, guildId: data.guildId }, 'Olay veritabanına yazılamadı; koruma yine de uygulanıyor');
      return { id: null, duplicate: false, failed: true };
    }
  }
}
