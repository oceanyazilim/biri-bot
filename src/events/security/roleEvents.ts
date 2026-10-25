import { Events } from 'discord.js';
import { defineEvent } from '../types';

export const roleDelete = defineEvent({
  name: Events.GuildRoleDelete,
  async execute(app, role) {
    await app.guard.onRoleDelete(role);
  },
});

export const roleCreate = defineEvent({
  name: Events.GuildRoleCreate,
  async execute(app, role) {
    await app.guard.onRoleCreate(role);
  },
});
