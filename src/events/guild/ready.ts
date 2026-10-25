import { ActivityType, Events } from 'discord.js';
import { defineEvent } from '../types';

/** Startup recovery: rebuilds temp room state and preloads Guard settings for every guild. */
export default defineEvent({
  name: Events.ClientReady,
  once: true,
  async execute(app, client) {
    app.logger.info({ user: client.user.tag, guilds: client.guilds.cache.size }, 'Biri hazır');
    client.user.setPresence({ activities: [{ name: 'ses odalarını ve sunucu güvenliğini', type: ActivityType.Watching }] });

    let restored = 0;
    let removed = 0;
    for (const guild of client.guilds.cache.values()) {
      try {
        await app.repos.guilds.ensure(guild.id);
        const result = await app.tempVoice.recoverGuild(guild);
        restored += result.restored;
        removed += result.removed;
        await app.guardConfig.get(guild.id);
        await app.trust.preload(guild.id);
      } catch (error) {
        app.logger.error({ err: error, guildId: guild.id }, 'Sunucu durumu kurtarılamadı');
      }
    }
    app.logger.info({ restored, removed }, 'Geçici oda durumu kurtarıldı');
  },
});
