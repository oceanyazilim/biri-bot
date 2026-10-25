import { Events } from 'discord.js';
import { defineEvent } from '../types';

export const channelDelete = defineEvent({
  name: Events.ChannelDelete,
  async execute(app, channel) {
    if (channel.isDMBased()) return;
    // Order matters: room/log bookkeeping is local and fast; Guard may wait for audit correlation.
    await app.tempVoice.handleChannelDeleted(channel.guild, channel.id);
    await app.logChannels.handleChannelDeleted(channel.guild, channel.id, channel.name);
    await app.guard.onChannelDelete(channel);
  },
});

export const channelCreate = defineEvent({
  name: Events.ChannelCreate,
  async execute(app, channel) {
    await app.guard.onChannelCreate(channel);
  },
});
