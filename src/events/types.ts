import type { ClientEvents } from 'discord.js';
import type { App } from '../core/App';

export interface BotEvent<K extends keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(app: App, ...args: ClientEvents[K]): Promise<void> | void;
}

export type AnyBotEvent = { [K in keyof ClientEvents]: BotEvent<K> }[keyof ClientEvents];

export function defineEvent<K extends keyof ClientEvents>(event: BotEvent<K>): BotEvent<K> {
  return event;
}
