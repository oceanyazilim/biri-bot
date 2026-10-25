import { OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';

/** What a room owner receives on their own channel. Deliberately no moderation or management bits. */
export const OWNER_ALLOW =
  PermissionFlagsBits.ViewChannel |
  PermissionFlagsBits.Connect |
  PermissionFlagsBits.Speak |
  PermissionFlagsBits.Stream |
  PermissionFlagsBits.UseVAD;

/** Permissions a room owner must never be granted by Biri. */
export const FORBIDDEN_OWNER_PERMISSIONS =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers;

export const BOT_ROOM_ALLOW =
  PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.ManageChannels | PermissionFlagsBits.MoveMembers;

export const ALLOWED_MEMBER_ALLOW = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect;
export const BLOCKED_MEMBER_DENY = PermissionFlagsBits.Connect;

export interface BaseOverwrite {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

export interface RoomPermissionState {
  everyoneRoleId: string;
  botId: string;
  ownerId: string;
  locked: boolean;
  hidden: boolean;
  /** Role overwrites inherited from the temp voice category. */
  categoryOverwrites: BaseOverwrite[];
  allowedUserIds: string[];
  blockedUserIds: string[];
  /** Members currently connected; they keep access while the room is hidden or locked. */
  connectedUserIds: string[];
}

export interface ComputedOverwrite {
  id: string;
  type: OverwriteType;
  allow: bigint;
  deny: bigint;
}

/**
 * Computes the full, deterministic overwrite list for a temp room. The whole
 * list is applied in one API call, so the channel can never end up in a
 * half-updated state and repeated application is idempotent.
 */
export function computeRoomOverwrites(state: RoomPermissionState): ComputedOverwrite[] {
  const byId = new Map<string, ComputedOverwrite>();

  for (const overwrite of state.categoryOverwrites) {
    // Member overwrites from the category are not inherited; rooms manage members themselves.
    if (overwrite.type !== OverwriteType.Role) continue;
    let allow = overwrite.allow;
    let deny = overwrite.deny;
    if (overwrite.id !== state.everyoneRoleId) {
      // Role allows would bypass the @everyone lock/hide deny, so neutralise them.
      if (state.locked) allow &= ~PermissionFlagsBits.Connect;
      if (state.hidden) allow &= ~PermissionFlagsBits.ViewChannel;
    }
    byId.set(overwrite.id, { id: overwrite.id, type: OverwriteType.Role, allow, deny });
  }

  const everyone = byId.get(state.everyoneRoleId) ?? {
    id: state.everyoneRoleId,
    type: OverwriteType.Role,
    allow: 0n,
    deny: 0n,
  };
  if (state.locked) {
    everyone.deny |= PermissionFlagsBits.Connect;
    everyone.allow &= ~PermissionFlagsBits.Connect;
  }
  if (state.hidden) {
    everyone.deny |= PermissionFlagsBits.ViewChannel;
    everyone.allow &= ~PermissionFlagsBits.ViewChannel;
  }
  if (everyone.allow !== 0n || everyone.deny !== 0n) byId.set(everyone.id, everyone);

  const allowMember = (id: string) => {
    const existing = byId.get(id);
    if (existing && existing.type === OverwriteType.Member) existing.allow |= ALLOWED_MEMBER_ALLOW;
    else byId.set(id, { id, type: OverwriteType.Member, allow: ALLOWED_MEMBER_ALLOW, deny: 0n });
  };

  if (state.hidden || state.locked) {
    for (const userId of state.connectedUserIds) allowMember(userId);
  }
  for (const userId of state.allowedUserIds) allowMember(userId);
  for (const userId of state.blockedUserIds) {
    if (userId === state.ownerId) continue;
    byId.set(userId, { id: userId, type: OverwriteType.Member, allow: 0n, deny: BLOCKED_MEMBER_DENY });
  }
  byId.set(state.ownerId, { id: state.ownerId, type: OverwriteType.Member, allow: OWNER_ALLOW, deny: 0n });
  byId.set(state.botId, { id: state.botId, type: OverwriteType.Member, allow: BOT_ROOM_ALLOW, deny: 0n });

  return [...byId.values()];
}

export function toOverwriteOptions(list: ComputedOverwrite[]) {
  return list.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: new PermissionsBitField(overwrite.allow),
    deny: new PermissionsBitField(overwrite.deny),
  }));
}
