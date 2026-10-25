import { AuditLogEvent } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { AuditLogCorrelator, type AuditLogSource } from '../src/modules/guard/attribution/AuditLogCorrelator';
import type { AuditEntryLike } from '../src/modules/guard/detectors';
import { createSilentLogger } from '../src/utils/logger';

const entry = (overrides: Partial<AuditEntryLike>): AuditEntryLike => ({
  id: Math.random().toString().slice(2),
  action: AuditLogEvent.ChannelDelete,
  executorId: 'attacker',
  targetId: 'chan',
  createdTimestamp: Date.now(),
  changes: [],
  ...overrides,
});

function source(entries: AuditEntryLike[], canView = true): AuditLogSource & { fetchEntries: ReturnType<typeof vi.fn> } {
  return {
    id: 'guild',
    canViewAuditLog: () => canView,
    fetchEntries: vi.fn(async (action: AuditLogEvent) => entries.filter((e) => e.action === action)),
  };
}

const correlator = () => new AuditLogCorrelator({ windowMs: 30, fetchLimit: 25, retryDelayMs: 10 }, createSilentLogger());

describe('AuditLogCorrelator', () => {
  it('matches an entry already delivered by the gateway without fetching', async () => {
    const c = correlator();
    const e = entry({});
    c.ingest('guild', e);
    const src = source([]);
    const result = await c.correlate(src, AuditLogEvent.ChannelDelete, 'chan');
    expect(result).toMatchObject({ status: 'MATCHED', source: 'GATEWAY_AUDIT' });
    expect(src.fetchEntries).not.toHaveBeenCalled();
  });

  it('waits for a late gateway entry', async () => {
    const c = correlator();
    const e = entry({});
    setTimeout(() => c.ingest('guild', e), 5);
    const result = await c.correlate(source([]), AuditLogEvent.ChannelDelete, 'chan');
    expect(result).toMatchObject({ status: 'MATCHED', entry: { id: e.id } });
  });

  it('falls back to a fetch and matches by target id, not by recency', async () => {
    const c = correlator();
    const unrelatedButNewer = entry({ targetId: 'other', createdTimestamp: Date.now() + 1 });
    const correct = entry({ targetId: 'chan' });
    const result = await c.correlate(source([correct, unrelatedButNewer]), AuditLogEvent.ChannelDelete, 'chan');
    expect(result).toMatchObject({ status: 'MATCHED', source: 'FETCHED_AUDIT', entry: { id: correct.id } });
  });

  it('reports ambiguity when different executors match the same target', async () => {
    const c = correlator();
    const result = await c.correlate(
      source([entry({ executorId: 'a' }), entry({ executorId: 'b' })]),
      AuditLogEvent.ChannelDelete,
      'chan',
    );
    expect(result.status).toBe('AMBIGUOUS');
  });

  it('ignores entries far outside the event time', async () => {
    const c = correlator();
    const stale = entry({ createdTimestamp: Date.now() - 10 * 60 * 1000 });
    const result = await c.correlate(source([stale]), AuditLogEvent.ChannelDelete, 'chan');
    expect(result).toEqual({ status: 'NOT_FOUND', reason: 'NO_ENTRY' });
  });

  it('does not fetch without the View Audit Log permission', async () => {
    const c = correlator();
    const src = source([entry({})], false);
    expect(await c.correlate(src, AuditLogEvent.ChannelDelete, 'chan')).toEqual({ status: 'NOT_FOUND', reason: 'NO_PERMISSION' });
    expect(src.fetchEntries).not.toHaveBeenCalled();
  });

  it('coalesces concurrent fetches for the same guild and action', async () => {
    const c = correlator();
    const entries = [entry({ targetId: 'c1' }), entry({ targetId: 'c2' }), entry({ targetId: 'c3' })];
    const src = source(entries);
    const results = await Promise.all(['c1', 'c2', 'c3'].map((t) => c.correlate(src, AuditLogEvent.ChannelDelete, t)));
    expect(results.every((r) => r.status === 'MATCHED')).toBe(true);
    expect(src.fetchEntries).toHaveBeenCalledTimes(1);
  });

  it('a voluntary leave has no kick entry', async () => {
    const c = correlator();
    const result = await c.correlate(source([]), AuditLogEvent.MemberKick, 'user');
    expect(result.status).toBe('NOT_FOUND');
  });
});
