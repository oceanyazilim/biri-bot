import { Collection, PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isMediaMessage, MediaCleanupService, normalizeChannelName } from '../src/modules/chat/MediaCleanupService';
import { PULL_COMMAND_NAMES } from '../src/modules/tempVoice/prefixCommands';
import { RoomManager } from '../src/modules/tempVoice/RoomManager';
import { buildHubPanel, buildUserManagement } from '../src/modules/tempVoice/panel';
import { parsePrefixCommand } from '../src/modules/moderation/prefixParser';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, type FakeMember } from './fakes/discord';
import { createVoiceHarness } from './fakes/harness';

const gm = (member: FakeMember) => asDiscord<GuildMember>(member);

afterEach(() => {
  vi.useRealTimers();
});

async function lockedRoom() {
  const h = await createVoiceHarness();
  const owner = h.guild.addMember({ name: 'Sahip' });
  const room = await h.createRoom(owner);
  const ctx = h.rooms.resolve(gm(owner));
  if (!RoomManager.isContext(ctx)) throw new Error(ctx.message);
  expect((await h.rooms.lock(ctx)).ok).toBe(true);
  const fresh = h.rooms.resolve(gm(owner));
  if (!RoomManager.isContext(fresh)) throw new Error(fresh.message);
  return { ...h, owner, room, ctx: fresh };
}

describe('locked rooms keep out everyone without permission', () => {
  it('disconnects administrators and the server owner and warns them in the room chat', async () => {
    const h = await lockedRoom();
    const admin = h.guild.addMember({ name: 'Yönetici', permissions: PermissionFlagsBits.Administrator });
    await h.move(admin, h.room.id);
    expect(admin.voice.channelId).toBeNull();
    expect(admin.voice.disconnect).toHaveBeenCalled();
    expect(h.room.send).toHaveBeenCalledWith(expect.objectContaining({ allowedMentions: { users: [admin.id] } }));

    const crown = h.guild.addMember({ name: 'Taç' });
    h.guild.ownerId = crown.id;
    await h.move(crown, h.room.id);
    expect(crown.voice.channelId).toBeNull();
  });

  it('lets the owner, allowed members and members inside at lock time stay', async () => {
    const h = await createVoiceHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const room = await h.createRoom(owner);
    const friend = h.guild.addMember({ name: 'Arkadaş' });
    await h.move(friend, room.id);
    const ctx = h.rooms.resolve(gm(owner));
    if (!RoomManager.isContext(ctx)) throw new Error(ctx.message);
    await h.rooms.lock(ctx);

    // Inside when locked: may leave and come back.
    await h.move(friend, null);
    await h.move(friend, room.id);
    expect(friend.voice.channelId).toBe(room.id);

    const invited = h.guild.addMember({ name: 'Davetli', permissions: PermissionFlagsBits.Administrator });
    const locked = h.rooms.resolve(gm(owner));
    if (!RoomManager.isContext(locked)) throw new Error(locked.message);
    expect((await h.rooms.allow(locked, gm(invited))).ok).toBe(true);
    await h.move(invited, room.id);
    expect(invited.voice.channelId).toBe(room.id);

    await h.move(owner, null);
    await h.move(owner, room.id);
    expect(owner.voice.channelId).toBe(room.id);
  });

  it('does nothing while the room is unlocked', async () => {
    const h = await createVoiceHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const room = await h.createRoom(owner);
    const admin = h.guild.addMember({ name: 'Yönetici', permissions: PermissionFlagsBits.Administrator });
    await h.move(admin, room.id);
    expect(admin.voice.channelId).toBe(room.id);
  });
});

describe('/sese-cek', () => {
  it('pulls a member from another voice channel into the locked room', async () => {
    const h = await lockedRoom();
    const lounge = h.guild.addVoiceChannel('Lobi');
    const guest = h.guild.addMember({ name: 'Misafir' });
    await h.move(guest, lounge.id);

    const result = await h.rooms.pull(h.ctx, gm(guest));
    expect(result.ok).toBe(true);
    expect(guest.voice.channelId).toBe(h.room.id);
    // The gateway event for the bot's move must not bounce the member back out.
    const { oldState, newState } = { oldState: { channelId: lounge.id, member: guest, guild: h.guild }, newState: { channelId: h.room.id, member: guest, guild: h.guild } };
    await h.service.handleVoiceStateUpdate(asDiscord(oldState), asDiscord(newState));
    expect(guest.voice.channelId).toBe(h.room.id);
  });

  it('the pass is single-use', async () => {
    const h = await lockedRoom();
    const guest = h.guild.addMember({ name: 'Misafir' });
    h.service.grantEntryPass(h.room.id, guest.id);
    await h.move(guest, h.room.id);
    expect(guest.voice.channelId).toBe(h.room.id);
    await h.move(guest, null);
    await h.move(guest, h.room.id);
    expect(guest.voice.channelId).toBeNull();
  });

  it('refuses members who are not in voice, blocked members and the admin override', async () => {
    const h = await lockedRoom();
    const idle = h.guild.addMember({ name: 'Boşta' });
    expect((await h.rooms.pull(h.ctx, gm(idle))).message).toContain('ses kanalında değil');

    const lounge = h.guild.addVoiceChannel('Lobi');
    const blocked = h.guild.addMember({ name: 'Engelli' });
    await h.move(blocked, lounge.id);
    await h.rooms.block(h.ctx, gm(blocked));
    expect((await h.rooms.pull(h.ctx, gm(blocked))).message).toContain('engelli');

    const admin = h.guild.addMember({ name: 'Yetkili', permissions: PermissionFlagsBits.ManageChannels });
    const viaAdmin = h.rooms.resolve(gm(admin), h.room.id);
    if (!RoomManager.isContext(viaAdmin)) throw new Error(viaAdmin.message);
    const other = h.guild.addMember({ name: 'Diğer' });
    await h.move(other, lounge.id);
    expect((await h.rooms.pull(viaAdmin, gm(other))).ok).toBe(false);
    expect(RoomManager.isContext(h.rooms.resolveOwned(gm(admin)))).toBe(false);
  });

  it('accepts the prefix spellings', () => {
    for (const text of ['.sese-cek <@123456789012345678>', '.sese-çek 123456789012345678', '.SESE-CEK 1']) {
      expect(PULL_COMMAND_NAMES.has(parsePrefixCommand(text, '.')!.name)).toBe(true);
    }
  });
});

describe('panels', () => {
  it('stay within Discord component limits', () => {
    const hub = buildHubPanel('1');
    expect(hub.components.length).toBeLessThanOrEqual(5);
    for (const row of hub.components) expect(row.components.length).toBeLessThanOrEqual(5);
    expect(buildUserManagement('1').components).toHaveLength(5);
  });
});

describe('chat media cleanup', () => {
  const message = (opts: { content?: string; attachments?: number; image?: boolean; channelName?: string; createdAgoMs?: number; authorId?: string }) => {
    const remove = vi.fn(async () => undefined);
    return {
      content: opts.content ?? '',
      attachments: new Collection(Array.from({ length: opts.attachments ?? 0 }, (_, i) => [String(i), {}])),
      embeds: opts.image ? [{ image: { url: 'x' } }] : [],
      channel: { id: '42', name: opts.channelName ?? '💬・chat' },
      author: { id: opts.authorId ?? 'user' },
      client: { user: { id: 'bot' } },
      createdTimestamp: Date.now() - (opts.createdAgoMs ?? 0),
      pinned: false,
      id: String(Math.random()),
      delete: remove,
    };
  };

  it('detects images, GIFs, files and links', () => {
    expect(isMediaMessage(asDiscord<Message>(message({ content: 'selam' })))).toBe(false);
    expect(isMediaMessage(asDiscord<Message>(message({ content: 'bak https://tenor.com/view/x' })))).toBe(true);
    expect(isMediaMessage(asDiscord<Message>(message({ attachments: 1 })))).toBe(true);
    expect(isMediaMessage(asDiscord<Message>(message({ image: true })))).toBe(true);
    expect(isMediaMessage(asDiscord<Message>(message({ content: 'discord.gg/abc' })))).toBe(true);
  });

  it('matches chat channels by name when no ids are configured', () => {
    const service = new MediaCleanupService({ channelIds: [], delayMs: 60_000 }, createSilentLogger());
    expect(normalizeChannelName('💬・Sohbet')).toBe('sohbet');
    expect(service.isCleanedChannel({ id: '1', name: '💬・chat' })).toBe(true);
    expect(service.isCleanedChannel({ id: '1', name: 'genel-sohbet' })).toBe(true);
    expect(service.isCleanedChannel({ id: '1', name: 'duyurular' })).toBe(false);
    const byId = new MediaCleanupService({ channelIds: ['7'], delayMs: 60_000 }, createSilentLogger());
    expect(byId.isCleanedChannel({ id: '1', name: 'chat' })).toBe(false);
    expect(byId.isCleanedChannel({ id: '7', name: 'x' })).toBe(true);
  });

  it('deletes media one minute after it was posted and leaves text alone', async () => {
    vi.useFakeTimers();
    const service = new MediaCleanupService({ channelIds: [], delayMs: 60_000 }, createSilentLogger());
    const media = message({ content: 'https://example.com/a.gif' });
    const text = message({ content: 'merhaba' });
    const own = message({ attachments: 1, authorId: 'bot' });
    for (const m of [media, text, own]) service.handleMessage(asDiscord(m));

    await vi.advanceTimersByTimeAsync(59_000);
    expect(media.delete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(media.delete).toHaveBeenCalledTimes(1);
    expect(text.delete).not.toHaveBeenCalled();
    expect(own.delete).not.toHaveBeenCalled();
  });
});
