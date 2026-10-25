import { Events } from 'discord.js';
import { defineEvent } from '../types';

export default defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(app, oldState, newState) {
    await app.tempVoice.handleVoiceStateUpdate(oldState, newState);
    const config = await app.tempVoice.getConfig(newState.guild.id);
    await app.activity.voice(oldState, newState, config?.enabled ? config.creatorChannelId : null);
  },
});
