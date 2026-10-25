/**
 * A Map with a hard size cap and per-entry expiry. Oldest entries are evicted
 * first, so it is safe to feed it unbounded streams (gateway events, audit ids).
 */
export class BoundedTtlMap<K, V> {
  private readonly entries = new Map<K, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxSize: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs = this.ttlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }

  /** Removes expired entries. */
  prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  values(): V[] {
    this.prune();
    return [...this.entries.values()].map((entry) => entry.value);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Atomically checks-and-marks keys as seen. Returns false for duplicates. */
export class DedupeSet {
  private readonly seen: BoundedTtlMap<string, true>;

  constructor(maxSize = 10_000, ttlMs = 15 * 60 * 1000, now: () => number = Date.now) {
    this.seen = new BoundedTtlMap(maxSize, ttlMs, now);
  }

  /** Marks the key; returns true when it was not seen before. */
  mark(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.set(key, true);
    return true;
  }

  has(key: string): boolean {
    return this.seen.has(key);
  }

  forget(key: string): void {
    this.seen.delete(key);
  }
}
