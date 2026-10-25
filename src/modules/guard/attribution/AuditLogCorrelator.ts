import type { AuditLogEvent } from 'discord.js';
import { delay } from '../../../utils/async';
import { BoundedTtlMap } from '../../../utils/collections';
import type { Logger } from '../../../utils/logger';
import type { AuditEntryLike } from '../detectors/types';

/** Minimal guild surface needed for fallback audit log fetches. */
export interface AuditLogSource {
  id: string;
  canViewAuditLog(): boolean;
  fetchEntries(action: AuditLogEvent, limit: number): Promise<AuditEntryLike[]>;
}

export type CorrelationResult =
  | { status: 'MATCHED'; entry: AuditEntryLike; source: 'GATEWAY_AUDIT' | 'FETCHED_AUDIT' }
  | { status: 'AMBIGUOUS'; candidates: number }
  | { status: 'NOT_FOUND'; reason: 'NO_ENTRY' | 'NO_PERMISSION' | 'FETCH_FAILED' };

export interface CorrelatorOptions {
  /** How long to wait for the gateway to deliver the audit entry. */
  windowMs: number;
  fetchLimit: number;
  /** Delay before the second (final) fetch attempt, covering audit log propagation latency. */
  retryDelayMs?: number;
  /** Accept entries created up to this long before the gateway event was observed. */
  lookbackMs?: number;
  /** Accept entries created up to this long after the gateway event was observed (clock skew). */
  lookaheadMs?: number;
  now?: () => number;
}

interface Waiter {
  resolve: (entry: AuditEntryLike) => void;
}

/**
 * Matches gateway events (e.g. channelDelete) to the audit log entry that
 * explains them. Matching uses guild, action type, target id and timestamp —
 * never "the latest entry". Entries delivered through guildAuditLogEntryCreate
 * are indexed as they arrive; only when none shows up in time is the audit
 * log fetched, with concurrent fetches for the same guild/action coalesced.
 */
export class AuditLogCorrelator {
  private readonly recent: BoundedTtlMap<string, AuditEntryLike[]>;
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly inflightFetches = new BoundedTtlMap<string, Promise<AuditEntryLike[]>>(1_000, 1_500);
  private readonly windowMs: number;
  private readonly fetchLimit: number;
  private readonly retryDelayMs: number;
  private readonly lookbackMs: number;
  private readonly lookaheadMs: number;
  private readonly now: () => number;

  constructor(
    options: CorrelatorOptions,
    private readonly logger: Logger,
  ) {
    this.windowMs = options.windowMs;
    this.fetchLimit = options.fetchLimit;
    this.retryDelayMs = options.retryDelayMs ?? 2_000;
    this.lookbackMs = options.lookbackMs ?? 30_000;
    this.lookaheadMs = options.lookaheadMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.recent = new BoundedTtlMap(20_000, 2 * 60 * 1000, this.now);
  }

  private key(guildId: string, action: AuditLogEvent, targetId: string): string {
    return `${guildId}:${action}:${targetId}`;
  }

  /** Index an entry (from the gateway or a fetch) and wake matching waiters. */
  ingest(guildId: string, entry: AuditEntryLike): void {
    if (!entry.targetId) return;
    const key = this.key(guildId, entry.action, entry.targetId);
    const list = this.recent.get(key) ?? [];
    if (!list.some((existing) => existing.id === entry.id)) {
      list.push(entry);
      this.recent.set(key, list);
    }
    const waiters = this.waiters.get(key);
    if (waiters) {
      this.waiters.delete(key);
      for (const waiter of waiters) waiter.resolve(entry);
    }
  }

  /**
   * Picks the single entry that explains the event. Several entries from the
   * same executor are unambiguous (the most recent wins); entries from
   * different executors are reported as ambiguous and never attributed.
   */
  selectMatch(entries: AuditEntryLike[], targetId: string, observedAt: number): AuditEntryLike | 'AMBIGUOUS' | null {
    const candidates = entries.filter(
      (entry) =>
        entry.targetId === targetId &&
        entry.createdTimestamp >= observedAt - this.lookbackMs &&
        entry.createdTimestamp <= observedAt + this.lookaheadMs,
    );
    if (candidates.length === 0) return null;
    const executors = new Set(candidates.map((entry) => entry.executorId));
    if (executors.size > 1) return 'AMBIGUOUS';
    // An entry without executor still matches, but normalizes to an unverified event.
    return candidates.reduce((latest, entry) => (entry.createdTimestamp > latest.createdTimestamp ? entry : latest));
  }

  async correlate(source: AuditLogSource, action: AuditLogEvent, targetId: string, observedAt = this.now()): Promise<CorrelationResult> {
    const key = this.key(source.id, action, targetId);

    const indexed = this.selectMatch(this.recent.get(key) ?? [], targetId, observedAt);
    if (indexed === 'AMBIGUOUS') return { status: 'AMBIGUOUS', candidates: (this.recent.get(key) ?? []).length };
    if (indexed) return { status: 'MATCHED', entry: indexed, source: 'GATEWAY_AUDIT' };

    const delivered = await this.waitFor(key, this.windowMs);
    if (delivered) {
      const match = this.selectMatch(this.recent.get(key) ?? [delivered], targetId, observedAt);
      if (match === 'AMBIGUOUS') return { status: 'AMBIGUOUS', candidates: (this.recent.get(key) ?? []).length };
      if (match) return { status: 'MATCHED', entry: match, source: 'GATEWAY_AUDIT' };
    }

    if (!source.canViewAuditLog()) return { status: 'NOT_FOUND', reason: 'NO_PERMISSION' };

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await delay(this.retryDelayMs);
      // A gateway entry may have arrived while we were waiting.
      const late = this.selectMatch(this.recent.get(key) ?? [], targetId, observedAt);
      if (late === 'AMBIGUOUS') return { status: 'AMBIGUOUS', candidates: (this.recent.get(key) ?? []).length };
      if (late) return { status: 'MATCHED', entry: late, source: 'GATEWAY_AUDIT' };

      let fetched: AuditEntryLike[];
      try {
        fetched = await this.fetchCoalesced(source, action);
      } catch (error) {
        this.logger.warn({ err: error, guildId: source.id, action }, 'Denetim kaydı alınamadı');
        return { status: 'NOT_FOUND', reason: 'FETCH_FAILED' };
      }
      const match = this.selectMatch(fetched, targetId, observedAt);
      if (match === 'AMBIGUOUS') return { status: 'AMBIGUOUS', candidates: fetched.filter((e) => e.targetId === targetId).length };
      if (match) {
        this.ingest(source.id, match);
        return { status: 'MATCHED', entry: match, source: 'FETCHED_AUDIT' };
      }
    }
    return { status: 'NOT_FOUND', reason: 'NO_ENTRY' };
  }

  private waitFor(key: string, timeoutMs: number): Promise<AuditEntryLike | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve: (entry) => {
          clearTimeout(timer);
          resolve(entry);
        },
      };
      const timer = setTimeout(() => {
        const set = this.waiters.get(key);
        set?.delete(waiter);
        if (set && set.size === 0) this.waiters.delete(key);
        resolve(null);
      }, timeoutMs);
      timer.unref?.();
      const set = this.waiters.get(key) ?? new Set<Waiter>();
      set.add(waiter);
      this.waiters.set(key, set);
    });
  }

  /** One API request serves every waiter for the same guild and action type. */
  private fetchCoalesced(source: AuditLogSource, action: AuditLogEvent): Promise<AuditEntryLike[]> {
    const key = `${source.id}:${action}`;
    const pending = this.inflightFetches.get(key);
    if (pending) return pending;
    const request = source.fetchEntries(action, this.fetchLimit);
    this.inflightFetches.set(key, request);
    request.catch(() => this.inflightFetches.delete(key));
    return request;
  }

  get pendingWaiters(): number {
    let count = 0;
    for (const set of this.waiters.values()) count += set.size;
    return count;
  }
}
