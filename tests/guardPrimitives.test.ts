import { describe, expect, it } from 'vitest';
import { GUARD_MODULE_DEFAULTS } from '../src/config/constants';
import { ThresholdTracker, classifyCount } from '../src/modules/guard/detectors/ThresholdTracker';
import { decideProtection } from '../src/modules/guard/policies/ProtectionPolicy';
import { KeyedMutex } from '../src/utils/async';
import { DedupeSet } from '../src/utils/collections';

describe('ThresholdTracker', () => {
  it('counts actions inside the sliding window only', () => {
    const tracker = new ThresholdTracker();
    const key = ThresholdTracker.key('g', 'CHANNEL_DELETE', 'u');
    const t0 = 1_000_000;
    expect(tracker.record(key, { id: 'a', at: t0, weight: 1 }, 10_000).count).toBe(1);
    expect(tracker.record(key, { id: 'b', at: t0 + 4_000, weight: 1 }, 10_000).count).toBe(2);
    // 11 s after the first: the first one fell out of the window.
    const result = tracker.record(key, { id: 'c', at: t0 + 11_000, weight: 1 }, 10_000);
    expect(result.count).toBe(2);
    expect(result.spanSec).toBe(7);
  });

  it('is idempotent for duplicate hits and handles out-of-order delivery', () => {
    const tracker = new ThresholdTracker();
    const key = 'k';
    tracker.record(key, { id: 'b', at: 5_000, weight: 1 }, 10_000);
    tracker.record(key, { id: 'a', at: 1_000, weight: 1 }, 10_000);
    expect(tracker.record(key, { id: 'a', at: 1_000, weight: 1 }, 10_000).count).toBe(2);
  });

  it('weights bulk actions such as prunes', () => {
    const tracker = new ThresholdTracker();
    expect(tracker.record('k', { id: 'p', at: 1, weight: 12 }, 15_000).count).toBe(12);
  });

  it('keys executors and guilds independently', () => {
    const tracker = new ThresholdTracker();
    tracker.record(ThresholdTracker.key('g1', 'M', 'u'), { id: '1', at: 1, weight: 1 }, 10_000);
    expect(tracker.record(ThresholdTracker.key('g2', 'M', 'u'), { id: '2', at: 2, weight: 1 }, 10_000).count).toBe(1);
  });
});

describe('classifyCount', () => {
  const channelDelete = GUARD_MODULE_DEFAULTS.CHANNEL_DELETE;
  it('uses the default 3 high / 5 critical tiers for channel deletion', () => {
    expect(classifyCount(2, channelDelete)).toMatchObject({ severity: 'INFO', thresholdReached: false });
    expect(classifyCount(3, channelDelete)).toMatchObject({ severity: 'HIGH', thresholdReached: false, warnReached: true });
    expect(classifyCount(5, channelDelete)).toMatchObject({ severity: 'CRITICAL', thresholdReached: true });
  });
});

describe('decideProtection', () => {
  const base = { mode: 'ACTIVE' as const, module: { autoStrip: true }, severity: 'CRITICAL' as const, thresholdReached: true, executorVerified: true, exemption: null };

  it('enforces only when every condition holds', () => {
    expect(decideProtection(base).action).toBe('ENFORCE');
  });
  it('never enforces on unverified attribution', () => {
    expect(decideProtection({ ...base, executorVerified: false })).toMatchObject({ action: 'ALERT', reason: 'UNVERIFIED', openIncident: false });
  });
  it('never enforces on exempt executors, but still alerts', () => {
    expect(decideProtection({ ...base, exemption: 'TRUSTED_USER' })).toMatchObject({ action: 'ALERT', reason: 'EXEMPT', openIncident: false });
    expect(decideProtection({ ...base, exemption: 'OWNER' }).action).not.toBe('ENFORCE');
  });
  it('never enforces below threshold', () => {
    expect(decideProtection({ ...base, thresholdReached: false, severity: 'HIGH' }).action).toBe('ALERT');
    expect(decideProtection({ ...base, thresholdReached: false, severity: 'LOW' }).action).toBe('LOG');
  });
  it('respects protection modes and module policy', () => {
    expect(decideProtection({ ...base, mode: 'MONITOR' })).toMatchObject({ action: 'LOG', notify: false, openIncident: true });
    expect(decideProtection({ ...base, mode: 'ALERT' })).toMatchObject({ action: 'ALERT', notify: true });
    expect(decideProtection({ ...base, module: { autoStrip: false } })).toMatchObject({ action: 'ALERT', reason: 'AUTO_STRIP_DISABLED' });
  });
});

describe('concurrency helpers', () => {
  it('KeyedMutex serializes the same key', async () => {
    const mutex = new KeyedMutex();
    const order: string[] = [];
    const slow = mutex.run('k', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('first');
    });
    const fast = mutex.run('k', async () => {
      order.push('second');
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
    expect(mutex.size).toBe(0);
  });

  it('DedupeSet marks each key once', () => {
    const set = new DedupeSet();
    expect(set.mark('a')).toBe(true);
    expect(set.mark('a')).toBe(false);
  });
});
