import { Events } from 'discord.js';
import { defineEvent } from '../types';

export const guildCreate = defineEvent({
  name: Events.GuildCreate,
  async execute(app, guild) {
    app.logger.info({ guildId: guild.id, name: guild.name }, 'Yeni sunucuya katılındı');
    await app.repos.guilds.ensure(guild.id);
    await app.tempVoice.recoverGuild(guild);
  },
});

export const guildDelete = defineEvent({
  name: Events.GuildDelete,
  async execute(app, guild) {
    app.logger.info({ guildId: guild.id }, 'Sunucudan ayrılındı');
    app.tempVoice.forgetGuild(guild.id);
    app.guardConfig.invalidate(guild.id);
    app.trust.invalidate(guild.id);
    app.logChannels.invalidate(guild.id);
    await app.repos.guilds.markLeft(guild.id);
  },
});
