import { Events } from 'discord.js';
import { handlePrefixMessage } from '../../modules/moderation/prefixCommands';
import { defineEvent } from '../types';

/** Registered when prefix commands are on (default) and Discord granted the Message Content intent. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(app, message) {
    if (!message.inGuild() || message.author.bot || message.webhookId) return;
    await handlePrefixMessage(app, message);
  },
});
