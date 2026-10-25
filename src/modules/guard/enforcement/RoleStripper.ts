import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';
import { PRIVILEGED_ROLE_MASK } from '../../../config/constants';
import { withRetry } from '../../../utils/async';
import { describeError, isPermanentDiscordError } from '../../../utils/discordErrors';

export type BlockedReason = 'MANAGED' | 'HIERARCHY';

export interface StripPlanEntry {
  roleId: string;
  roleName: string;
  position: number;
  privileged: boolean;
  removable: boolean;
  blockedReason: BlockedReason | null;
}

export type StripRefusal = 'SERVER_OWNER' | 'MISSING_PERMISSION' | 'NO_BOT_MEMBER';

export interface StripPlan {
  memberId: string;
  entries: StripPlanEntry[];
  refusal: StripRefusal | null;
}

export interface RoleRemovalResult {
  roleId: string;
  removed: boolean;
  failureReason: string | null;
}

export type StripStatus = 'ROLES_STRIPPED' | 'PARTIAL' | 'FAILED' | 'ESCALATED';

export interface StripOutcome {
  status: StripStatus;
  results: RoleRemovalResult[];
  /** Human readable explanation when not everything could be removed. */
  reason: string | null;
  privilegedRemaining: number;
}

export const BLOCKED_REASON_TEXT: Record<BlockedReason, string> = {
  MANAGED: 'Entegrasyon/abonelik rolü (Discord tarafından yönetiliyor)',
  HIERARCHY: 'Rol, botun en yüksek rolüyle aynı seviyede veya üzerinde',
};

export const REFUSAL_TEXT: Record<StripRefusal, string> = {
  SERVER_OWNER: 'Sunucu sahibine yaptırım uygulanamaz',
  MISSING_PERMISSION: 'Botun **Rolleri Yönet** yetkisi yok',
  NO_BOT_MEMBER: 'Bot üyesi sunucuda bulunamadı',
};

export function isPrivilegedRole(role: Pick<Role, 'permissions'>): boolean {
  return (role.permissions.bitfield & PRIVILEGED_ROLE_MASK) !== 0n;
}

/**
 * Captures a member's roles and decides which of them Biri can legitimately
 * remove under Discord's hierarchy rules. Nothing is modified here.
 */
export function planStrip(member: GuildMember): StripPlan {
  const guild = member.guild;
  const me = guild.members.me;
  const entries: StripPlanEntry[] = [];
  const botTop = me?.roles.highest.position ?? -1;

  for (const role of member.roles.cache.values()) {
    if (role.id === guild.id) continue; // @everyone
    let blockedReason: BlockedReason | null = null;
    if (role.managed) blockedReason = 'MANAGED';
    else if (role.position >= botTop) blockedReason = 'HIERARCHY';
    entries.push({
      roleId: role.id,
      roleName: role.name,
      position: role.position,
      privileged: isPrivilegedRole(role),
      removable: blockedReason === null,
      blockedReason,
    });
  }
  entries.sort((a, b) => b.position - a.position);

  let refusal: StripRefusal | null = null;
  if (member.id === guild.ownerId) refusal = 'SERVER_OWNER';
  else if (!me) refusal = 'NO_BOT_MEMBER';
  else if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) refusal = 'MISSING_PERMISSION';

  return { memberId: member.id, entries, refusal };
}

/**
 * Removes every removable role in a single request (fast during an attack),
 * falling back to per-role removal so partial hierarchy failures are recorded
 * precisely. Results are derived from the member's actual roles afterwards.
 */
export async function executeStrip(member: GuildMember, plan: StripPlan, reason: string): Promise<StripOutcome> {
  const blockedResults = (): RoleRemovalResult[] =>
    plan.entries
      .filter((entry) => !entry.removable)
      .map((entry) => ({ roleId: entry.roleId, removed: false, failureReason: entry.blockedReason ? BLOCKED_REASON_TEXT[entry.blockedReason] : null }));

  if (plan.refusal) {
    return {
      status: 'ESCALATED',
      results: plan.entries.map((entry) => ({ roleId: entry.roleId, removed: false, failureReason: REFUSAL_TEXT[plan.refusal!] })),
      reason: REFUSAL_TEXT[plan.refusal],
      privilegedRemaining: plan.entries.filter((entry) => entry.privileged).length,
    };
  }

  const removable = plan.entries.filter((entry) => entry.removable);
  if (removable.length === 0) {
    const privilegedRemaining = plan.entries.filter((entry) => entry.privileged).length;
    return {
      status: 'ESCALATED',
      results: blockedResults(),
      reason:
        plan.entries.length === 0
          ? 'Kullanıcının alınabilecek bir rolü yok; yetkisi başka bir kaynaktan geliyor olabilir'
          : 'Kullanıcının tüm rolleri botun yönetebileceği seviyenin üzerinde',
      privilegedRemaining,
    };
  }

  const removableIds = new Set(removable.map((entry) => entry.roleId));
  const keepIds = plan.entries.filter((entry) => !entry.removable).map((entry) => entry.roleId);
  const results: RoleRemovalResult[] = [];

  let remaining: Set<string> | null = null;
  try {
    const updated = await member.roles.set(keepIds, reason);
    remaining = new Set(updated.roles.cache.keys());
  } catch {
    remaining = null;
  }

  if (remaining) {
    for (const roleId of removableIds) {
      const removed = !remaining.has(roleId);
      results.push({ roleId, removed, failureReason: removed ? null : 'Rol kaldırılamadı (bilinmeyen neden)' });
    }
  } else {
    for (const roleId of removableIds) {
      try {
        await withRetry(() => member.roles.remove(roleId, reason), {
          attempts: 3,
          baseDelayMs: 200,
          shouldRetry: (error) => !isPermanentDiscordError(error),
        });
        results.push({ roleId, removed: true, failureReason: null });
      } catch (error) {
        results.push({ roleId, removed: false, failureReason: describeError(error) });
      }
    }
  }
  results.push(...blockedResults());

  const removedCount = results.filter((result) => result.removed).length;
  const notRemoved = results.filter((result) => !result.removed);
  const privilegedRemaining = plan.entries.filter((entry) => entry.privileged && notRemoved.some((r) => r.roleId === entry.roleId)).length;

  let status: StripStatus;
  if (notRemoved.length === 0) status = 'ROLES_STRIPPED';
  else if (removedCount > 0) status = 'PARTIAL';
  else status = 'FAILED';

  return {
    status,
    results,
    reason: notRemoved.length === 0 ? null : `${notRemoved.length} rol kaldırılamadı${privilegedRemaining > 0 ? ` (${privilegedRemaining} tanesi yetkili rol)` : ''}`,
    privilegedRemaining,
  };
}
