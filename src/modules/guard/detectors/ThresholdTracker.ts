import type { GuardModuleSettings, Severity } from '../../../types/guard';

interface Hit {
  id: string;
  at: number;
  weight: number;
}

export interface ThresholdResult {
  /** Weighted number of actions inside the window ending at the newest action. */
  count: number;
  /** Seconds between the first and last counted action. */
  spanSec: number;
}

const MAX_HITS_PER_KEY = 500;
const MAX_KEYS = 50_000;

/**
 * Sliding-window counters per (guild, module, executor). Uses the audit entry
 * timestamps rather than arrival time, so delayed or out-of-order gateway
 * events are still counted in the correct window. Identical hit ids are
 * ignored, which makes recording idempotent for duplicate deliveries.
 *
 * Node.js runs this synchronously on one thread, so a record() call is atomic.
 */
export class ThresholdTracker {
  private readonly hits = new Map<string, Hit[]>();

  constructor(private readonly maxWindowMs = 10 * 60 * 1000) {}

  static key(guildId: string, module: string, executorId: string): string {
    return `${guildId}:${module}:${executorId}`;
  }

  record(key: string, hit: Hit, windowMs: number): ThresholdResult {
    let list = this.hits.get(key);
    if (!list) {
      list = [];
      this.hits.set(key, list);
      this.evictIfNeeded();
    }
    if (!list.some((existing) => existing.id === hit.id)) {
      list.push(hit);
      list.sort((a, b) => a.at - b.at);
    }
    const newest = list[list.length - 1]?.at ?? hit.at;
    // Drop hits that can no longer fall inside any window.
    const horizon = newest - Math.max(windowMs, this.maxWindowMs);
    while (list.length > 0 && (list[0]?.at ?? 0) < horizon) list.shift();
    while (list.length > MAX_HITS_PER_KEY) list.shift();

    const windowStart = newest - windowMs;
    let count = 0;
    let first = newest;
    for (const entry of list) {
      if (entry.at < windowStart) continue;
      count += entry.weight;
      first = Math.min(first, entry.at);
    }
    return { count, spanSec: Math.max(0, Math.round((newest - first) / 1000)) };
  }

  /** Removes executors without recent activity. */
  sweep(now = Date.now()): void {
    for (const [key, list] of this.hits) {
      const newest = list[list.length - 1]?.at ?? 0;
      if (now - newest > this.maxWindowMs) this.hits.delete(key);
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  get size(): number {
    return this.hits.size;
  }

  private evictIfNeeded(): void {
    while (this.hits.size > MAX_KEYS) {
      const oldest = this.hits.keys().next();
      if (oldest.done) return;
      this.hits.delete(oldest.value);
    }
  }
}

export interface Classification {
  severity: Severity;
  /** The module's main (sanction) threshold was reached. */
  thresholdReached: boolean;
  /** The optional warning tier was reached. */
  warnReached: boolean;
}

export function classifyCount(count: number, settings: Pick<GuardModuleSettings, 'warnThreshold' | 'threshold' | 'severity'>): Classification {
  if (settings.threshold > 0 && count >= settings.threshold) {
    return { severity: settings.severity, thresholdReached: true, warnReached: true };
  }
  if (settings.warnThreshold > 0 && count >= settings.warnThreshold) {
    return { severity: 'HIGH', thresholdReached: false, warnReached: true };
  }
  return { severity: 'INFO', thresholdReached: false, warnReached: false };
}
