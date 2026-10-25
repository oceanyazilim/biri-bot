import type { ClientEvents } from 'discord.js';
import type { App } from '../core/App';
import { guildCreate, guildDelete } from './guild/guildLifecycle';
import interactionCreate from './guild/interactionCreate';
import messageCreate from './guild/messageCreate';
import { messageDelete, messageDeleteBulk, messageUpdate } from './guild/messageLogs';
import ready from './guild/ready';
import auditLogEntryCreate from './security/auditLogEntryCreate';
import { channelCreate, channelDelete } from './security/channelEvents';
import { guildBanAdd, guildMemberAdd, guildMemberRemove } from './security/memberEvents';
import { roleCreate, roleDelete } from './security/roleEvents';
import type { AnyBotEvent } from './types';
import voiceStateUpdate from './voice/voiceStateUpdate';

export function buildEventList(membersIntent: boolean, prefixCommands: boolean, messageLogs = false): AnyBotEvent[] {
  const events: AnyBotEvent[] = [
    ready,
    guildCreate,
    guildDelete,
    interactionCreate,
    voiceStateUpdate,
    auditLogEntryCreate,
    channelDelete,
    channelCreate,
    roleDelete,
    roleCreate,
    guildBanAdd,
  ];
  if (membersIntent) events.push(guildMemberRemove, guildMemberAdd);
  if (prefixCommands) events.push(messageCreate);
  if (messageLogs) events.push(messageDelete, messageUpdate, messageDeleteBulk);
  return events;
}

/** Registers handlers; a failing handler is logged and never crashes the process. */
export function registerEvents(app: App): void {
  for (const event of buildEventList(app.env.ENABLE_GUILD_MEMBERS_INTENT, app.env.ENABLE_PREFIX_COMMANDS, app.env.ENABLE_MESSAGE_LOGS)) {
    const listener = (...args: unknown[]) => {
      Promise.resolve()
        .then(() => (event.execute as (app: App, ...rest: unknown[]) => Promise<void> | void)(app, ...args))
        .catch((error: unknown) => app.logger.error({ err: error, event: event.name }, 'Olay işleyici hatası'));
    };
    if (event.once) app.client.once(event.name as keyof ClientEvents, listener);
    else app.client.on(event.name as keyof ClientEvents, listener);
  }
}
