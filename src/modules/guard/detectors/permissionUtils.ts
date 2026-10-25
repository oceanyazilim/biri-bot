import { PermissionFlagsBits } from 'discord.js';
import { DANGEROUS_PERMISSIONS, DANGEROUS_PERMISSION_MASK } from '../../../config/constants';

export function dangerousBits(permissions: bigint, mask: bigint = DANGEROUS_PERMISSION_MASK): bigint {
  return permissions & mask;
}

/** Bits present in `next` but not in `previous`. */
export function addedBits(previous: bigint, next: bigint): bigint {
  return next & ~previous;
}

export function permissionLabels(bits: bigint): string[] {
  return DANGEROUS_PERMISSIONS.filter((permission) => (bits & permission.flag) !== 0n).map((permission) => permission.label);
}

export function hasAdministrator(bits: bigint): boolean {
  return (bits & PermissionFlagsBits.Administrator) !== 0n;
}
