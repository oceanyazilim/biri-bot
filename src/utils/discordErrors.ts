import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';

export function discordErrorCode(error: unknown): number | null {
  if (error instanceof DiscordAPIError && typeof error.code === 'number') return error.code;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'number') return code;
  }
  return null;
}

export function isUnknownResource(error: unknown): boolean {
  const code = discordErrorCode(error);
  return (
    code === RESTJSONErrorCodes.UnknownChannel ||
    code === RESTJSONErrorCodes.UnknownMember ||
    code === RESTJSONErrorCodes.UnknownRole ||
    code === RESTJSONErrorCodes.UnknownUser ||
    code === RESTJSONErrorCodes.UnknownGuild ||
    code === RESTJSONErrorCodes.UnknownMessage
  );
}

export function isMissingPermissions(error: unknown): boolean {
  const code = discordErrorCode(error);
  return code === RESTJSONErrorCodes.MissingPermissions || code === RESTJSONErrorCodes.MissingAccess;
}

/** Errors that will not succeed on retry. */
export function isPermanentDiscordError(error: unknown): boolean {
  if (isUnknownResource(error) || isMissingPermissions(error)) return true;
  if (error instanceof DiscordAPIError) return error.status >= 400 && error.status < 500 && error.status !== 429;
  return false;
}

export function describeError(error: unknown): string {
  if (isMissingPermissions(error)) return 'Botun yetkisi yetersiz';
  if (isUnknownResource(error)) return 'Hedef artık mevcut değil';
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Prisma unique constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}
