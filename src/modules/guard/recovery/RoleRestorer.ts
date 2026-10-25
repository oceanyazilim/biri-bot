import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import type { IncidentWithRoles } from '../../../database/repositories/types';
import { describeError } from '../../../utils/discordErrors';
import { isPrivilegedRole } from '../enforcement/RoleStripper';

export type RestoreStatus = 'RESTORABLE' | 'PRIVILEGED' | 'MISSING' | 'NOT_MANAGEABLE' | 'ALREADY_HAS' | 'NOT_REMOVED' | 'RESTORED';

export interface RestorePreviewItem {
  roleId: string;
  roleName: string;
  status: RestoreStatus;
}

export const RESTORE_STATUS_TEXT: Record<RestoreStatus, string> = {
  RESTORABLE: '✅ İade edilebilir',
  PRIVILEGED: '⚠️ Yetkili rol — ayrıca onay gerekir',
  MISSING: '❌ Rol artık mevcut değil',
  NOT_MANAGEABLE: '❌ Bot bu rolü veremez (hiyerarşi/entegrasyon)',
  ALREADY_HAS: '➖ Kullanıcıda zaten var',
  NOT_REMOVED: '➖ Olay sırasında alınmamıştı',
  RESTORED: '↩️ Daha önce iade edildi',
};

/** Classifies each snapshot role for the restore confirmation screen. */
export function previewRestore(guild: Guild, member: GuildMember | null, incident: IncidentWithRoles): RestorePreviewItem[] {
  const me = guild.members.me;
  const botTop = me?.roles.highest.position ?? -1;
  const canManage = Boolean(me?.permissions.has(PermissionFlagsBits.ManageRoles));

  return incident.roles.map((snapshot) => {
    const role = guild.roles.cache.get(snapshot.roleId);
    let status: RestoreStatus;
    if (snapshot.restored) status = 'RESTORED';
    else if (!snapshot.removed) status = 'NOT_REMOVED';
    else if (!role) status = 'MISSING';
    else if (!canManage || role.managed || role.position >= botTop) status = 'NOT_MANAGEABLE';
    else if (member?.roles.cache.has(role.id)) status = 'ALREADY_HAS';
    else if (snapshot.privileged || isPrivilegedRole(role)) status = 'PRIVILEGED';
    else status = 'RESTORABLE';
    return { roleId: snapshot.roleId, roleName: role?.name ?? snapshot.roleName, status };
  });
}

export interface RestoreResult {
  restored: string[];
  failed: Array<{ roleId: string; reason: string }>;
}

/**
 * Gives back the selected snapshot roles. Privileged roles are only included
 * when the administrator explicitly confirmed them.
 */
export async function restoreRoles(member: GuildMember, items: RestorePreviewItem[], includePrivileged: boolean, reason: string): Promise<RestoreResult> {
  const targets = items.filter((item) => item.status === 'RESTORABLE' || (includePrivileged && item.status === 'PRIVILEGED'));
  const result: RestoreResult = { restored: [], failed: [] };
  if (targets.length === 0) return result;

  try {
    await member.roles.add(
      targets.map((item) => item.roleId),
      reason,
    );
    result.restored.push(...targets.map((item) => item.roleId));
    return result;
  } catch {
    // Fall back to individual additions to find out exactly which role failed.
  }
  for (const item of targets) {
    try {
      await member.roles.add(item.roleId, reason);
      result.restored.push(item.roleId);
    } catch (error) {
      result.failed.push({ roleId: item.roleId, reason: describeError(error) });
    }
  }
  return result;
}
