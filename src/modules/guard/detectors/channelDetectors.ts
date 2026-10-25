import { OverwriteType } from 'discord.js';
import { DANGEROUS_OVERWRITE_MASK } from '../../../config/constants';
import { baseEvent, changeOf, stringOrNull, toBigInt, type Detector } from './types';
import { addedBits, dangerousBits, permissionLabels } from './permissionUtils';

/** 9.1 Anti Channel Delete */
export const detectChannelDelete: Detector = (entry, ctx) => [
  baseEvent(entry, ctx, {
    module: 'CHANNEL_DELETE',
    eventType: 'CHANNEL_DELETE',
    targetType: 'CHANNEL',
    targetName: stringOrNull(changeOf(entry, 'name')?.old),
    baseSeverity: 'LOW',
  }),
];

/** 9.2 Anti Channel Create */
export const detectChannelCreate: Detector = (entry, ctx) => [
  baseEvent(entry, ctx, {
    module: 'CHANNEL_CREATE',
    eventType: 'CHANNEL_CREATE',
    targetType: 'CHANNEL',
    targetName: stringOrNull(changeOf(entry, 'name')?.new),
    baseSeverity: 'INFO',
  }),
];

/**
 * 9.5 (channel part): dangerous permissions granted to @everyone through a
 * channel overwrite. Overwrites for specific roles or members are not flagged.
 */
export const detectChannelOverwrite: Detector = (entry, ctx) => {
  const extra = entry.extra as { id?: string; type?: unknown } | null | undefined;
  const overwriteId = extra?.id ?? stringOrNull(changeOf(entry, 'id')?.new);
  if (overwriteId !== ctx.guildId) return [];

  const typeChange = changeOf(entry, 'type');
  const type = typeChange?.new ?? typeChange?.old;
  if (type !== undefined && Number(type) !== OverwriteType.Role) return [];

  const allowChange = changeOf(entry, 'allow');
  if (!allowChange) return [];
  const granted = dangerousBits(addedBits(toBigInt(allowChange.old), toBigInt(allowChange.new)), DANGEROUS_OVERWRITE_MASK);
  if (granted === 0n) return [];

  return [
    baseEvent(entry, ctx, {
      module: 'PERMISSION_ESCALATION',
      eventType: 'EVERYONE_CHANNEL_OVERWRITE_ESCALATED',
      targetType: 'CHANNEL',
      baseSeverity: 'HIGH',
      details: { permissions: permissionLabels(granted), permissionBits: granted.toString() },
    }),
  ];
};
