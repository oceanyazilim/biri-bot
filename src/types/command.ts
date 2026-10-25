import type {
  AnySelectMenuInteraction,
  AutocompleteInteraction,
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { App } from '../core/App';

export type CommandCategory = 'voice' | 'guard' | 'admin' | 'moderation';

export interface SlashCommand {
  data: { name: string; toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody };
  category: CommandCategory;
  /** Overrides the default per-user cooldown. */
  cooldownMs?: number;
  execute(interaction: ChatInputCommandInteraction<'cached'>, app: App): Promise<void>;
  /** Suggestions for options declared with `setAutocomplete(true)`. */
  autocomplete?(interaction: AutocompleteInteraction<'cached'>, app: App): Promise<void>;
}

export type ComponentInteraction = ButtonInteraction<'cached'> | AnySelectMenuInteraction<'cached'> | ModalSubmitInteraction<'cached'>;

/**
 * Handles buttons, select menus and modals whose custom id starts with
 * `biri:<prefix>:`. The remaining colon-separated segments are passed as args.
 */
export interface ComponentHandler {
  prefix: string;
  handle(interaction: ComponentInteraction, app: App, args: string[]): Promise<void>;
}

export function customId(prefix: string, ...args: string[]): string {
  return ['biri', prefix, ...args].join(':');
}
