import { Events } from 'discord.js';
import { defineEvent } from '../types';

/** Registered only when ENABLE_MESSAGE_LOGS=true (needs the Message Content intent). */
export const messageDelete = defineEvent({
  name: Events.MessageDelete,
  async execute(app, message) {
    await app.activity.messageDelete(message);
  },
});

export const messageUpdate = defineEvent({
  name: Events.MessageUpdate,
  async execute(app, oldMessage, newMessage) {
    await app.activity.messageUpdate(oldMessage, newMessage);
  },
});

export const messageDeleteBulk = defineEvent({
  name: Events.MessageBulkDelete,
  async execute(app, messages, channel) {
    await app.activity.messageBulkDelete(messages, channel);
  },
});
