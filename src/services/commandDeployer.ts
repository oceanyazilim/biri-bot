import { REST, Routes } from 'discord.js';
import { commandPayloads } from '../commands';
import type { Logger } from '../utils/logger';

export interface DeployOptions {
  token: string;
  clientId: string;
  /** Deploy to one guild (instant) instead of globally (may take up to an hour to propagate). */
  guildId?: string;
}

/** Registers all slash commands with a single bulk overwrite (idempotent). */
export async function deployCommands(options: DeployOptions, logger: Logger): Promise<number> {
  const rest = new REST({ version: '10' }).setToken(options.token);
  const body = commandPayloads();
  const route = options.guildId
    ? Routes.applicationGuildCommands(options.clientId, options.guildId)
    : Routes.applicationCommands(options.clientId);
  await rest.put(route, { body });
  logger.info({ count: body.length, scope: options.guildId ? `guild:${options.guildId}` : 'global' }, 'Slash komutları kaydedildi');
  return body.length;
}
