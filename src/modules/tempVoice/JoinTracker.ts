/**
 * Remembers when members joined each temp room. Used to pick the longest
 * present member as the next owner. Entries are removed with the room, so the
 * size is bounded by active rooms × members.
 */
export class JoinTracker {
  private readonly rooms = new Map<string, Map<string, number>>();

  join(channelId: string, userId: string, at = Date.now()): void {
    let members = this.rooms.get(channelId);
    if (!members) {
      members = new Map();
      this.rooms.set(channelId, members);
    }
    if (!members.has(userId)) members.set(userId, at);
  }

  leave(channelId: string, userId: string): void {
    this.rooms.get(channelId)?.delete(userId);
  }

  joinedAt(channelId: string, userId: string): number | undefined {
    return this.rooms.get(channelId)?.get(userId);
  }

  clear(channelId: string): void {
    this.rooms.delete(channelId);
  }
}

/**
 * Deterministic successor selection: earliest tracked join first, unknown
 * join times last, ties broken by the numerically smallest user id.
 */
export function pickSuccessor(candidateIds: string[], joinedAt: (userId: string) => number | undefined): string | null {
  if (candidateIds.length === 0) return null;
  const sorted = [...candidateIds].sort((a, b) => {
    const ja = joinedAt(a) ?? Number.POSITIVE_INFINITY;
    const jb = joinedAt(b) ?? Number.POSITIVE_INFINITY;
    if (ja !== jb) return ja < jb ? -1 : 1;
    const ba = BigInt(a);
    const bb = BigInt(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  });
  return sorted[0] ?? null;
}
