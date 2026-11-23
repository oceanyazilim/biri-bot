import type { SuspectRecord, SuspectRepository } from '../../database/repositories/types';
import type { Logger } from '../../utils/logger';

/**
 * The suspect list (`.şüpheli`): only these users' media is removed from the
 * chat channel. Each guild's list is read from the database once and then kept
 * in memory, so checking every chat message costs no query.
 */
export class SuspectService {
  private readonly cache = new Map<string, Promise<Set<string>>>();

  constructor(
    private readonly repo: SuspectRepository,
    private readonly logger: Logger,
  ) {}

  private ids(guildId: string): Promise<Set<string>> {
    let ids = this.cache.get(guildId);
    if (!ids) {
      ids = this.repo.list(guildId).then((rows) => new Set(rows.map((r) => r.userId)));
      // A failed read must not stick: drop it so the next message retries.
      ids.catch((error: unknown) => {
        this.cache.delete(guildId);
        this.logger.warn({ err: error, guildId }, 'Şüpheli listesi okunamadı');
      });
      this.cache.set(guildId, ids);
    }
    return ids;
  }

  async isSuspect(guildId: string, userId: string): Promise<boolean> {
    try {
      return (await this.ids(guildId)).has(userId);
    } catch {
      return false;
    }
  }

  async add(entry: { guildId: string; userId: string; userTag: string | null; moderatorId: string; reason: string | null }): Promise<void> {
    await this.repo.upsert(entry);
    (await this.ids(entry.guildId).catch(() => null))?.add(entry.userId);
  }

  /** Returns whether the user was on the list. */
  async remove(guildId: string, userId: string): Promise<boolean> {
    const removed = await this.repo.remove(guildId, userId);
    (await this.ids(guildId).catch(() => null))?.delete(userId);
    return removed;
  }

  list(guildId: string): Promise<SuspectRecord[]> {
    return this.repo.list(guildId);
  }
}
