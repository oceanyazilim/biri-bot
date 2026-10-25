import { Events } from 'discord.js';
import { defineEvent } from '../types';

/** Primary Guard signal: every audit entry carries a reliable executor id. */
export default defineEvent({
  name: Events.GuildAuditLogEntryCreate,
  async execute(app, entry, guild) {
    await app.auditFeed.handle(guild, entry as never);
    await app.guard.onAuditLogEntry(guild, entry);
  },
});
