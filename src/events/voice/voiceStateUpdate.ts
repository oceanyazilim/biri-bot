import { Events } from 'discord.js';
import { defineEvent } from '../types';

export default defineEvent({
  name: Events.VoiceStateUpdate,
  async execute(app, oldState, newState) {
    await app.tempVoice.handleVoiceStateUpdate(oldState, newState);
  },
});
