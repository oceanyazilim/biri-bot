export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Return false to stop retrying (e.g. for permission errors that will never succeed). */
  shouldRetry?: (error: unknown) => boolean;
}

/** Retries an async operation with exponential backoff and jitter. */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const base = options.baseDelayMs ?? 250;
  const max = options.maxDelayMs ?? 4_000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (options.shouldRetry && !options.shouldRetry(error))) break;
      const backoff = Math.min(max, base * 2 ** (attempt - 1));
      await delay(backoff / 2 + Math.random() * (backoff / 2));
    }
  }
  throw lastError;
}

/**
 * Serializes async work per key. Different keys run concurrently; the same key
 * runs strictly in order. Keys are removed when their queue drains, so memory
 * does not grow with the number of distinct keys seen.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }

  isLocked(key: string): boolean {
    return this.tails.has(key);
  }

  get size(): number {
    return this.tails.size;
  }
}

/** Limits how many tasks run at the same time for a key (e.g. per guild). */
export class KeyedSemaphore {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly limit: number) {}

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(key);
    try {
      return await task();
    } finally {
      this.release(key);
    }
  }

  private acquire(key: string): Promise<void> {
    const count = this.active.get(key) ?? 0;
    if (count < this.limit) {
      this.active.set(key, count + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const queue = this.waiting.get(key) ?? [];
      queue.push(() => {
        this.active.set(key, (this.active.get(key) ?? 0) + 1);
        resolve();
      });
      this.waiting.set(key, queue);
    });
  }

  private release(key: string): void {
    const count = (this.active.get(key) ?? 1) - 1;
    if (count <= 0) this.active.delete(key);
    else this.active.set(key, count);
    const queue = this.waiting.get(key);
    const next = queue?.shift();
    if (queue && queue.length === 0) this.waiting.delete(key);
    next?.();
  }
}
