import { ChannelType, PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TempVoiceService } from '../src/modules/tempVoice/TempVoiceService';
import { asDiscord, FakeGuild, FakeVoiceChannel } from './fakes/discord';
import { createVoiceHarness } from './fakes/harness';

afterEach(() => {
  vi.useRealTimers();
});

const roomChannels = (guild: FakeGuild, creatorId: string) =>
  [...guild.channels.cache.values()].filter((c): c is FakeVoiceChannel => c instanceof FakeVoiceChannel && c.id !== creatorId);

describe('temp voice creation', () => {
  it('creates a personalised room, moves the owner and stores ownership', async () => {
    const h = await createVoiceHarness();
    const emirhan = h.guild.addMember({ name: 'Emirhan' });
    const room = await h.createRoom(emirhan);

    expect(room.name).toBe("🔊・Emirhan'ın Odası");
    expect(room.parentId).toBe(h.category.id);
    expect(room.members.has(emirhan.id)).toBe(true);
    expect((await h.repos.tempVoice.findRoomByChannel(room.id))?.ownerId).toBe(emirhan.id);
    expect(h.selfActions.isSelfAction(h.guild.id, 'CHANNEL_CREATE', room.id)).toBe(true);
  });

  it('[1] handles simultaneous joins without duplicates', async () => {
    const h = await createVoiceHarness();
    const members = Array.from({ length: 6 }, (_, i) => h.guild.addMember({ name: `Üye${i}` }));
    for (const member of members) h.guild.moveMember(member, h.creator.id);

    const config = (await h.repos.tempVoice.getConfig(h.guild.id))!;
    // Every member triggers creation twice (duplicate gateway delivery) at the same time.
    await Promise.all(members.flatMap((m) => [h.service.createRoomFor(asDiscord<GuildMember>(m), config), h.service.createRoomFor(asDiscord<GuildMember>(m), config)]));

    expect(h.repos.tempVoice.rooms.size).toBe(6);
    expect(roomChannels(h.guild, h.creator.id)).toHaveLength(6);
    for (const member of members) {
      expect(await h.repos.tempVoice.findRoomsByOwner(h.guild.id, member.id)).toHaveLength(1);
      expect(member.voice.channelId).not.toBe(h.creator.id);
    }
  });

  it('enforces one active room per member and moves them back to it', async () => {
    const h = await createVoiceHarness();
    const member = h.guild.addMember({ name: 'Ahmet' });
    const room = await h.createRoom(member);
    await h.move(member, h.creator.id);
    expect(member.voice.channelId).toBe(room.id);
    expect(h.guild.channels.create).toHaveBeenCalledTimes(1);
  });

  it('ignores bots joining the creator channel', async () => {
    const h = await createVoiceHarness();
    const bot = h.guild.addMember({ name: 'MüzikBot', bot: true });
    await h.move(bot, h.creator.id);
    expect(h.repos.tempVoice.rooms.size).toBe(0);
  });

  it('[18] does not create rooms when the bot lacks permissions', async () => {
    const guild = new FakeGuild({ botPermissions: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect });
    const h = await createVoiceHarness({ guild });
    const member = h.guild.addMember({ name: 'Mehmet' });
    await h.move(member, h.creator.id);
    expect(h.guild.channels.create).not.toHaveBeenCalled();
    expect(h.service.missingPermissions(asDiscord<Guild>(h.guild))).toEqual(['Kanalları Yönet', 'Rolleri Yönet', 'Üyeleri Taşı']);
  });

  it('rolls the channel back when the database write fails', async () => {
    const h = await createVoiceHarness();
    vi.spyOn(h.repos.tempVoice, 'createRoomIfUnderLimit').mockRejectedValueOnce(new Error('db down'));
    const member = h.guild.addMember({ name: 'Zeynep' });
    await h.move(member, h.creator.id);
    expect(roomChannels(h.guild, h.creator.id)).toHaveLength(0);
    expect(h.service.activeRoomCount()).toBe(0);
  });
});

describe('room cleanup', () => {
  it('[3] deletes an empty room after the configured delay', async () => {
    vi.useFakeTimers();
    const h = await createVoiceHarness({ emptyDeleteDelaySec: 5 });
    const member = h.guild.addMember({ name: 'Ali' });
    const room = await h.createRoom(member);
    await h.move(member, null);

    expect(h.service.isDeletionScheduled(room.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(4_900);
    expect(h.guild.channels.cache.has(room.id)).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.guild.channels.cache.has(room.id)).toBe(false);
    expect(await h.repos.tempVoice.findRoomByChannel(room.id)).toBeNull();
    expect(h.selfActions.isSelfAction(h.guild.id, 'CHANNEL_DELETE', room.id)).toBe(true);
  });

  it('cancels deletion when someone rejoins in time', async () => {
    vi.useFakeTimers();
    const h = await createVoiceHarness({ emptyDeleteDelaySec: 5 });
    const member = h.guild.addMember({ name: 'Ali' });
    const room = await h.createRoom(member);
    await h.move(member, null);
    await vi.advanceTimersByTimeAsync(3_000);
    await h.move(member, room.id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.guild.channels.cache.has(room.id)).toBe(true);
    expect(h.service.isDeletionScheduled(room.id)).toBe(false);
  });

  it('never deletes untracked or creator channels', async () => {
    const h = await createVoiceHarness();
    const permanent = h.guild.addVoiceChannel('Genel Sohbet', h.category.id);
    const g = asDiscord<Guild>(h.guild);
    expect(await h.service.deleteRoom(g, permanent.id, { reason: 'admin', actorId: 'x' })).toBe(false);
    expect(await h.service.deleteRoom(g, h.creator.id, { reason: 'admin', actorId: 'x' })).toBe(false);
    expect(permanent.delete).not.toHaveBeenCalled();
    expect(h.creator.delete).not.toHaveBeenCalled();
  });

  it('treats a room with only bots left as empty', async () => {
    vi.useFakeTimers();
    const h = await createVoiceHarness({ emptyDeleteDelaySec: 1 });
    const owner = h.guild.addMember({ name: 'Ece' });
    const bot = h.guild.addMember({ name: 'Bot', bot: true });
    const room = await h.createRoom(owner);
    await h.move(bot, room.id);
    await h.move(owner, null);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(h.guild.channels.cache.has(room.id)).toBe(false);
  });

  it('cleans up the record when an admin deletes a room manually', async () => {
    const h = await createVoiceHarness();
    const member = h.guild.addMember({ name: 'Deniz' });
    const room = await h.createRoom(member);
    h.guild.channels.cache.delete(room.id);
    await h.service.handleChannelDeleted(asDiscord<Guild>(h.guild), room.id);
    expect(h.repos.tempVoice.rooms.size).toBe(0);
  });

  it('disables the system when the creator channel is deleted', async () => {
    const h = await createVoiceHarness();
    h.guild.channels.cache.delete(h.creator.id);
    await h.service.handleChannelDeleted(asDiscord<Guild>(h.guild), h.creator.id);
    expect((await h.repos.tempVoice.getConfig(h.guild.id))?.enabled).toBe(false);
  });
});

describe('ownership hand-over', () => {
  it('[2][4] transfers ownership to the longest present member after the grace period', async () => {
    vi.useFakeTimers();
    const h = await createVoiceHarness({ ownerGraceSec: 10 });
    const owner = h.guild.addMember({ name: 'Sahip' });
    const first = h.guild.addMember({ name: 'İlk' });
    const second = h.guild.addMember({ name: 'İkinci' });
    const room = await h.createRoom(owner);
    await h.move(second, room.id);
    await vi.advanceTimersByTimeAsync(1_000);
    await h.move(first, room.id);

    await h.move(owner, null);
    expect(h.service.isTransferScheduled(room.id)).toBe(true);
    expect((await h.repos.tempVoice.findRoomByChannel(room.id))?.ownerLeftAt).not.toBeNull();

    await vi.advanceTimersByTimeAsync(10_100);
    const stored = await h.repos.tempVoice.findRoomByChannel(room.id);
    expect(stored?.ownerId).toBe(second.id); // joined earlier than `first`
    expect(stored?.ownerLeftAt).toBeNull();
    const overwrites = room.permissionOverwrites.cache;
    expect(overwrites.has(second.id)).toBe(true);
    expect(overwrites.has(owner.id)).toBe(false);
  });

  it('keeps ownership when the owner returns within the grace period', async () => {
    vi.useFakeTimers();
    const h = await createVoiceHarness({ ownerGraceSec: 10 });
    const owner = h.guild.addMember({ name: 'Sahip' });
    const guest = h.guild.addMember({ name: 'Misafir' });
    const room = await h.createRoom(owner);
    await h.move(guest, room.id);
    await h.move(owner, null);
    await vi.advanceTimersByTimeAsync(5_000);
    await h.move(owner, room.id);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await h.repos.tempVoice.findRoomByChannel(room.id))?.ownerId).toBe(owner.id);
  });

  it('ownership swap is atomic under concurrent transfers', async () => {
    const h = await createVoiceHarness();
    const owner = h.guild.addMember({ name: 'Sahip' });
    const a = h.guild.addMember({ name: 'A' });
    const b = h.guild.addMember({ name: 'B' });
    const room = await h.createRoom(owner);
    await h.move(a, room.id);
    await h.move(b, room.id);
    const g = asDiscord<Guild>(h.guild);
    const results = await Promise.all([
      h.service.transferOwnership(g, room.id, a.id, { expectedOwnerId: owner.id, actorId: owner.id }),
      h.service.transferOwnership(g, room.id, b.id, { expectedOwnerId: owner.id, actorId: owner.id }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: 'OWNER_CHANGED' });
  });
});

describe('[17] restart recovery', () => {
  it('rebuilds state, drops stale records and re-arms timers', async () => {
    vi.useFakeTimers();
    const h = await createVoiceHarness({ emptyDeleteDelaySec: 5, ownerGraceSec: 10 });
    const owner = h.guild.addMember({ name: 'Kaan' });
    const guest = h.guild.addMember({ name: 'Misafir' });
    const alone = h.guild.addMember({ name: 'Yalnız' });
    const busyRoom = await h.createRoom(owner);
    await h.move(guest, busyRoom.id);
    const emptyRoom = await h.createRoom(alone);
    const ghost = await h.createRoom(h.guild.addMember({ name: 'Hayalet' }));

    // Simulated downtime: the owner left, the lonely room emptied, one channel vanished.
    h.guild.moveMember(owner, null);
    h.guild.moveMember(alone, null);
    h.guild.channels.cache.delete(ghost.id);
    const waiting = h.guild.addMember({ name: 'Bekleyen' });
    h.guild.moveMember(waiting, h.creator.id);

    const restarted = new TempVoiceService(h.repos.tempVoice, h.selfActions, h.logger, { creationConcurrency: 3 });
    const result = await restarted.recoverGuild(asDiscord<Guild>(h.guild));
    expect(result).toEqual({ restored: 2, removed: 1 });
    expect(await h.repos.tempVoice.findRoomByChannel(ghost.id)).toBeNull();
    expect(restarted.isDeletionScheduled(emptyRoom.id)).toBe(true);
    expect(restarted.isTransferScheduled(busyRoom.id)).toBe(true);

    // Members sitting in the creator channel get their room after restart.
    await vi.advanceTimersByTimeAsync(0);
    expect(waiting.voice.channelId).not.toBe(h.creator.id);

    await vi.advanceTimersByTimeAsync(10_100);
    expect(h.guild.channels.cache.has(emptyRoom.id)).toBe(false);
    expect((await h.repos.tempVoice.findRoomByChannel(busyRoom.id))?.ownerId).toBe(guest.id);
    restarted.shutdown();
  });
});

describe('[20] multiple guilds', () => {
  it('keeps rooms and limits isolated per guild', async () => {
    const a = await createVoiceHarness();
    const b = await createVoiceHarness({ repos: a.repos });
    // The same Discord user exists in both guilds.
    const inA = a.guild.addMember({ name: 'Ortak' });
    const inB = b.guild.addMember({ name: 'Ortak' });
    (inB as { id: string }).id = inA.id;
    b.guild.members.cache.set(inA.id, inB);

    await a.createRoom(inA);
    const configB = (await b.repos.tempVoice.getConfig(b.guild.id))!;
    b.guild.moveMember(inB, b.creator.id);
    const roomB = await b.service.createRoomFor(asDiscord<GuildMember>(inB), configB);
    expect(roomB).not.toBeNull();
    expect(await a.repos.tempVoice.findRoomsByOwner(a.guild.id, inA.id)).toHaveLength(1);
    expect(await a.repos.tempVoice.findRoomsByOwner(b.guild.id, inA.id)).toHaveLength(1);
    expect(roomB!.type).toBe(ChannelType.GuildVoice);
  });
});
