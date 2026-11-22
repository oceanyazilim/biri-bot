import { Events } from 'discord.js';
import { handlePrefixMessage } from '../../modules/moderation/prefixCommands';
import { defineEvent } from '../types';

/** Registered when prefix commands or chat media cleanup are on and Discord granted the Message Content intent. */
export default defineEvent({
  name: Events.MessageCreate,
  async execute(app, message) {
    if (!message.inGuild()) return;
    if (app.env.ENABLE_MEDIA_CLEANUP) app.mediaCleanup.handleMessage(message);
    if (!app.env.ENABLE_PREFIX_COMMANDS || message.author.bot || message.webhookId) return;
    await handlePrefixMessage(app, message);
  },
});
