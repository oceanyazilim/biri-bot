import { Events } from 'discord.js';
import { defineEvent } from '../types';

export const guildBanAdd = defineEvent({
  name: Events.GuildBanAdd,
  async execute(app, ban) {
    await app.guard.onBanAdd(ban);
  },
});

/** Requires the Server Members intent (ENABLE_GUILD_MEMBERS_INTENT=true). */
export const guildMemberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async execute(app, member) {
    await app.activity.memberLeave(member);
    await app.guard.onMemberRemove(member);
  },
});

/** Requires the Server Members intent. Bot additions are attributed through the BotAdd audit entry. */
export const guildMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(app, member) {
    await app.activity.memberJoin(member);
  },
});
