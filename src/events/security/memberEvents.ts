import { Events } from 'discord.js';
import { defineEvent } from '../types';

export const guildBanAdd = defineEvent({
  name: Events.GuildBanAdd,
  async execute(app, ban) {
    await app.guard.onBanAdd(ban);
  },
});

/** Someone lifted a ban: a user judged with `.yargi` is banned again until `.unyargı`. */
export const guildBanRemove = defineEvent({
  name: Events.GuildBanRemove,
  async execute(app, ban) {
    await app.yargi.enforce(ban.guild, ban.user.id, 'UNBAN', ban.user.tag ?? null);
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
    // A judged user who got back in (e.g. the ban was lifted while Biri was offline) is removed first.
    if (await app.yargi.enforce(member.guild, member.id, 'JOIN', member.user.tag)) return;
    await app.activity.memberJoin(member);
  },
});
