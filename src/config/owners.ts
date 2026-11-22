/**
 * Biri's owners. They are outside every sanction Biri applies: locked-room
 * enforcement, room kick/block, server ban/kick (including `.yargi` re-bans)
 * and Guard's automatic role stripping.
 */
export const DEFAULT_BOT_OWNER_IDS: readonly string[] = ['887788724988026890'];

let owners: ReadonlySet<string> = new Set(DEFAULT_BOT_OWNER_IDS);

export function setBotOwners(ids: readonly string[]): void {
  owners = new Set(ids);
}

export function isBotOwner(userId: string | null | undefined): boolean {
  return Boolean(userId && owners.has(userId));
}
