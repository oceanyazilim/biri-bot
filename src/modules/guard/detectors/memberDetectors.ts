import { baseEvent, type Detector } from './types';

/** 9.6 Anti Mass Ban */
export const detectBan: Detector = (entry, ctx) => [
  baseEvent(entry, ctx, { module: 'MEMBER_BAN', eventType: 'MEMBER_BAN', targetType: 'USER', baseSeverity: 'LOW' }),
];

/**
 * 9.7 Anti Mass Kick. Only MemberKick audit entries count, so a voluntary
 * leave (which produces no audit entry) can never be counted as a kick.
 */
export const detectKick: Detector = (entry, ctx) => [
  baseEvent(entry, ctx, { module: 'MEMBER_KICK', eventType: 'MEMBER_KICK', targetType: 'USER', baseSeverity: 'LOW' }),
];

/** A prune removes many members in one action; it is weighted by the removed count. */
export const detectPrune: Detector = (entry, ctx) => {
  const extra = entry.extra as { removed?: unknown; days?: unknown } | null | undefined;
  const removed = Math.max(1, Number(extra?.removed ?? 1) || 1);
  return [
    baseEvent(entry, ctx, {
      module: 'MEMBER_KICK',
      eventType: 'MEMBER_PRUNE',
      targetType: 'GUILD',
      targetId: ctx.guildId,
      baseSeverity: removed >= 10 ? 'HIGH' : 'MEDIUM',
      weight: removed,
      details: { removed, days: Number(extra?.days ?? 0) || null },
    }),
  ];
};

/** 9.9 Anti Bot Addition. Trust is applied later by the processor. */
export const detectBotAdd: Detector = (entry, ctx) => [
  baseEvent(entry, ctx, { module: 'BOT_ADD', eventType: 'BOT_ADD', targetType: 'USER', baseSeverity: 'MEDIUM' }),
];
