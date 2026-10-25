/**
 * Named, cancellable timers. Scheduling an existing key replaces the old timer,
 * which makes "reset the countdown" semantics trivial and prevents duplicates.
 */
export class TimerRegistry {
  private readonly timers = new Map<string, { handle: NodeJS.Timeout; firesAt: number }>();

  constructor(private readonly onError: (key: string, error: unknown) => void = () => undefined) {}

  schedule(key: string, delayMs: number, task: () => Promise<void> | void): void {
    this.cancel(key);
    const handle = setTimeout(() => {
      this.timers.delete(key);
      Promise.resolve()
        .then(task)
        .catch((error: unknown) => this.onError(key, error));
    }, Math.max(0, delayMs));
    handle.unref?.();
    this.timers.set(key, { handle, firesAt: Date.now() + delayMs });
  }

  cancel(key: string): boolean {
    const timer = this.timers.get(key);
    if (!timer) return false;
    clearTimeout(timer.handle);
    this.timers.delete(key);
    return true;
  }

  has(key: string): boolean {
    return this.timers.has(key);
  }

  firesAt(key: string): number | undefined {
    return this.timers.get(key)?.firesAt;
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    this.timers.clear();
  }

  get size(): number {
    return this.timers.size;
  }
}
