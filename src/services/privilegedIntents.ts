import { ApplicationFlags } from 'discord.js';
import type { Env } from '../config/env';

/** Privileged gateway intents switched on for the application in the Developer Portal. */
export interface PrivilegedIntents {
  messageContent: boolean;
  guildMembers: boolean;
}

type IntentEnv = Pick<Env, 'ENABLE_PREFIX_COMMANDS' | 'ENABLE_MESSAGE_LOGS' | 'ENABLE_GUILD_MEMBERS_INTENT'>;

/** Reads the intent switches from the application flags. Null when Discord could not be asked. */
export async function fetchPrivilegedIntents(token: string, fetchImpl: typeof fetch = fetch): Promise<PrivilegedIntents | null> {
  try {
    const response = await fetchImpl('https://discord.com/api/v10/applications/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const { flags } = (await response.json()) as { flags?: number };
    if (typeof flags !== 'number') return null;
    const has = (...bits: number[]) => bits.some((bit) => (flags & bit) !== 0);
    return {
      messageContent: has(ApplicationFlags.GatewayMessageContent, ApplicationFlags.GatewayMessageContentLimited),
      guildMembers: has(ApplicationFlags.GatewayGuildMembers, ApplicationFlags.GatewayGuildMembersLimited),
    };
  } catch {
    return null;
  }
}

/**
 * Turns off features whose intent is not enabled in the Developer Portal, so
 * Discord does not refuse the whole connection (close code 4014). Returns the
 * adjusted settings and a Turkish warning for each feature that was turned off.
 */
export function fitToPrivilegedIntents<T extends IntentEnv>(env: T, available: PrivilegedIntents): { env: T; warnings: string[] } {
  const next = { ...env };
  const warnings: string[] = [];
  const where = 'Developer Portal → Bot → Privileged Gateway Intents';
  if (!available.messageContent && (env.ENABLE_PREFIX_COMMANDS || env.ENABLE_MESSAGE_LOGS)) {
    next.ENABLE_PREFIX_COMMANDS = false;
    next.ENABLE_MESSAGE_LOGS = false;
    warnings.push(`"Message Content Intent" kapalı: .yargi / .unyargı ve mesaj logları devre dışı. Açmak için: ${where}.`);
  }
  if (!available.guildMembers && env.ENABLE_GUILD_MEMBERS_INTENT) {
    next.ENABLE_GUILD_MEMBERS_INTENT = false;
    warnings.push(`"Server Members Intent" kapalı: üye katılma/ayrılma logları devre dışı. Açmak için: ${where}.`);
  }
  return { env: next, warnings };
}
