import { Events } from 'discord.js';
import { handlePrefixMessage } from '../../modules/moderation/prefixCommands';
import { defineEvent } from '../types';

/** Registered only when ENABLE_PREFIX_COMMANDS=true. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(app, message) {
    if (!message.inGuild() || message.author.bot || message.webhookId) return;
    await handlePrefixMessage(app, message);
  },
});
