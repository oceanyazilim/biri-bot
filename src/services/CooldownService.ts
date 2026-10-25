import { BoundedTtlMap } from '../utils/collections';

/** Per-user, per-command cooldowns with bounded memory. */
export class CooldownService {
  private readonly until = new BoundedTtlMap<string, number>(50_000, 60_000);

  constructor(private readonly now: () => number = Date.now) {}

  /** Returns remaining milliseconds when on cooldown, otherwise starts the cooldown and returns 0. */
  consume(userId: string, key: string, cooldownMs: number): number {
    if (cooldownMs <= 0) return 0;
    const mapKey = `${userId}:${key}`;
    const now = this.now();
    const expiresAt = this.until.get(mapKey);
    if (expiresAt !== undefined && expiresAt > now) return expiresAt - now;
    this.until.set(mapKey, now + cooldownMs, cooldownMs);
    return 0;
  }
}
