import { BoundedTtlMap } from '../utils/collections';

export type SelfActionType =
  | 'CHANNEL_CREATE'
  | 'CHANNEL_DELETE'
  | 'CHANNEL_UPDATE'
  | 'OVERWRITE_UPDATE'
  | 'MEMBER_ROLE_UPDATE'
  | 'MEMBER_MOVE';

/**
 * Remembers administrative operations Biri itself is about to perform so the
 * Guard engine never mistakes them for attacks. Audit entries executed by the
 * bot are already ignored by executor id; this registry additionally covers
 * gateway events that arrive without a matched audit entry (fallback path).
 */
export class SelfActionRegistry {
  private readonly actions: BoundedTtlMap<string, number>;

  constructor(ttlMs = 2 * 60 * 1000, maxSize = 20_000, now: () => number = Date.now) {
    this.actions = new BoundedTtlMap(maxSize, ttlMs, now);
  }

  private key(guildId: string, type: SelfActionType, targetId: string): string {
    return `${guildId}:${type}:${targetId}`;
  }

  register(guildId: string, type: SelfActionType, targetId: string): void {
    const key = this.key(guildId, type, targetId);
    this.actions.set(key, (this.actions.get(key) ?? 0) + 1);
  }

  /** Forget a registration when the operation failed. */
  unregister(guildId: string, type: SelfActionType, targetId: string): void {
    const key = this.key(guildId, type, targetId);
    const count = this.actions.get(key);
    if (count === undefined) return;
    if (count <= 1) this.actions.delete(key);
    else this.actions.set(key, count - 1);
  }

  isSelfAction(guildId: string, type: SelfActionType, targetId: string): boolean {
    return this.actions.has(this.key(guildId, type, targetId));
  }

  get size(): number {
    return this.actions.size;
  }
}
