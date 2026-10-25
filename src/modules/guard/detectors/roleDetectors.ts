import { PRIVILEGED_ROLE_MASK } from '../../../config/constants';
import type { NormalizedSecurityEvent } from '../../../types/guard';
import { baseEvent, changeOf, stringOrNull, toBigInt, type Detector } from './types';
import { addedBits, dangerousBits, hasAdministrator, permissionLabels } from './permissionUtils';

/** 9.3 Anti Role Delete */
export const detectRoleDelete: Detector = (entry, ctx) => {
  const permissions = toBigInt(changeOf(entry, 'permissions')?.old);
  return [
    baseEvent(entry, ctx, {
      module: 'ROLE_DELETE',
      eventType: 'ROLE_DELETE',
      targetType: 'ROLE',
      targetName: stringOrNull(changeOf(entry, 'name')?.old),
      baseSeverity: (permissions & PRIVILEGED_ROLE_MASK) !== 0n ? 'MEDIUM' : 'LOW',
      details: { privileged: (permissions & PRIVILEGED_ROLE_MASK) !== 0n },
    }),
  ];
};

/** 9.4 Anti Role Create, plus 9.5 for roles created with dangerous permissions. */
export const detectRoleCreate: Detector = (entry, ctx) => {
  const name = stringOrNull(changeOf(entry, 'name')?.new);
  const events: NormalizedSecurityEvent[] = [
    baseEvent(entry, ctx, { module: 'ROLE_CREATE', eventType: 'ROLE_CREATE', targetType: 'ROLE', targetName: name, baseSeverity: 'INFO' }),
  ];
  const dangerous = dangerousBits(toBigInt(changeOf(entry, 'permissions')?.new));
  if (dangerous !== 0n) {
    events.push(
      baseEvent(entry, ctx, {
        module: 'PERMISSION_ESCALATION',
        eventType: 'ROLE_CREATED_WITH_DANGEROUS_PERMISSIONS',
        dedupeId: `${entry.id}#escalation`,
        targetType: 'ROLE',
        targetName: name,
        baseSeverity: hasAdministrator(dangerous) ? 'CRITICAL' : 'HIGH',
        details: { permissions: permissionLabels(dangerous), permissionBits: dangerous.toString() },
      }),
    );
  }
  return events;
};

/** 9.5 Dangerous permissions added to an existing role (incl. @everyone). */
export const detectRoleUpdate: Detector = (entry, ctx) => {
  const change = changeOf(entry, 'permissions');
  if (!change) return [];
  const granted = dangerousBits(addedBits(toBigInt(change.old), toBigInt(change.new)));
  if (granted === 0n) return [];
  const isEveryone = entry.targetId === ctx.guildId;
  return [
    baseEvent(entry, ctx, {
      module: 'PERMISSION_ESCALATION',
      eventType: isEveryone ? 'EVERYONE_PERMISSIONS_ESCALATED' : 'ROLE_PERMISSIONS_ESCALATED',
      targetType: 'ROLE',
      targetName: isEveryone ? '@everyone' : (entry.targetId ? ctx.roleName(entry.targetId) : null),
      baseSeverity: isEveryone || hasAdministrator(granted) ? 'CRITICAL' : 'HIGH',
      details: { permissions: permissionLabels(granted), permissionBits: granted.toString() },
    }),
  ];
};

/**
 * 9.5 Privileged roles (dangerous permissions, or roles on the trusted list)
 * granted to a member — the classic "give myself Administrator" step.
 */
export const detectMemberRoleUpdate: Detector = (entry, ctx) => {
  const added = changeOf(entry, '$add')?.new;
  if (!Array.isArray(added)) return [];
  let granted = 0n;
  const roles: Array<{ id: string; name: string }> = [];
  let trustedRoleGranted = false;
  for (const raw of added as Array<{ id?: unknown; name?: unknown }>) {
    const roleId = typeof raw.id === 'string' ? raw.id : null;
    if (!roleId) continue;
    const bits = dangerousBits(ctx.rolePermissions(roleId) ?? 0n);
    const trusted = ctx.isTrustedRole(roleId);
    if (bits === 0n && !trusted) continue;
    granted |= bits;
    trustedRoleGranted ||= trusted;
    roles.push({ id: roleId, name: typeof raw.name === 'string' ? raw.name : (ctx.roleName(roleId) ?? roleId) });
  }
  if (roles.length === 0) return [];
  return [
    baseEvent(entry, ctx, {
      module: 'PERMISSION_ESCALATION',
      eventType: trustedRoleGranted && granted === 0n ? 'TRUSTED_ROLE_GRANTED' : 'PRIVILEGED_ROLE_GRANTED',
      targetType: 'USER',
      baseSeverity: hasAdministrator(granted) ? 'CRITICAL' : 'HIGH',
      details: {
        roles,
        permissions: permissionLabels(granted),
        permissionBits: granted.toString(),
        trustedRoleGranted,
      },
    }),
  ];
};
