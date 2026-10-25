import { OverwriteType, PermissionFlagsBits, type GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { RoomManager, type RoomContext } from '../src/modules/tempVoice/RoomManager';
import { FORBIDDEN_OWNER_PERMISSIONS } from '../src/modules/tempVoice/roomPermissions';
import { asDiscord, type FakeMember, type FakeVoiceChannel } from './fakes/discord';
import { createVoiceHarness } from './fakes/harness';

const gm = (member: FakeMember) => asDiscord<GuildMember>(member);

async function roomWithOwner() {
  const h = await createVoiceHarness();
  const owner = h.guild.addMember({ name: 'Emirhan' });
  const room = await h.createRoom(owner);
  const ctx = h.rooms.resolve(gm(owner));
  if (!RoomManager.isContext(ctx)) throw new Error(ctx.message);
  return { ...h, owner, room, ctx };
}

const overwrite = (channel: FakeVoiceChannel, id: string) => channel.permissionOverwrites.cache.get(id);

describe('[5] authorization', () => {
  it('rejects members managing someone else’s room', async () => {
    const h = await roomWithOwner();
    const intruder = h.guild.addMember({ name: 'Davetsiz' });
    await h.move(intruder, h.room.id);

    const viaCommand = h.rooms.resolve(gm(intruder));
    expect(RoomManager.isContext(viaCommand)).toBe(false);
    expect((viaCommand as { message: string }).message).toContain('sana ait değil');

    // A forwarded/stale panel button carries the channel id; it must still be rejected.
    const viaPanel = h.rooms.resolve(gm(intruder), h.room.id);
    expect(RoomManager.isContext(viaPanel)).toBe(false);
  });

  it('rejects members without any room', async () => {
    const h = await roomWithOwner();
    const result = h.rooms.resolve(gm(h.guild.addMember({ name: 'Boşta' })));
    expect(RoomManager.isContext(result)).toBe(false);
  });

  it('lets administrators override ownership', async () => {
    const h = await roomWithOwner();
    const admin = h.guild.addMember({ name: 'Yetkili', permissions: PermissionFlagsBits.ManageChannels });
    await h.move(admin, h.room.id);
    const ctx = h.rooms.resolve(gm(admin));
    expect(RoomManager.isContext(ctx) && ctx.viaAdmin).toBe(true);
  });

  it('owners resolve their own room even when not connected to it', async () => {
    const h = await roomWithOwner();
    await h.move(h.owner, null);
    expect(RoomManager.isContext(h.rooms.resolve(gm(h.owner)))).toBe(true);
  });
});

describe('[6] /at is voice-only', () => {
  it('disconnects the target from the room and never kicks or bans', async () => {
    const h = await roomWithOwner();
    const target = h.guild.addMember({ name: 'Hedef' });
    await h.move(target, h.room.id);
    const result = await h.rooms.disconnect(h.ctx, gm(target));
    expect(result.ok).toBe(true);
    expect(target.voice.disconnect).toHaveBeenCalledTimes(1);
    expect(target.kick).not.toHaveBeenCalled();
    expect(target.ban).not.toHaveBeenCalled();
    expect(h.guild.members.cache.has(target.id)).toBe(true);
    expect(target.voice.channelId).toBeNull();
  });

  it('refuses targets outside the room', async () => {
    const h = await roomWithOwner();
    const elsewhere = h.guild.addMember({ name: 'Başka' });
    const result = await h.rooms.disconnect(h.ctx, gm(elsewhere));
    expect(result.ok).toBe(false);
    expect(elsewhere.voice.disconnect).not.toHaveBeenCalled();
  });

  it('refuses to disconnect server staff or the owner themselves', async () => {
    const h = await roomWithOwner();
    const mod = h.guild.addMember({ name: 'Mod', permissions: PermissionFlagsBits.MoveMembers });
    await h.move(mod, h.room.id);
    expect((await h.rooms.disconnect(h.ctx, gm(mod))).ok).toBe(false);
    expect((await h.rooms.disconnect(h.ctx, gm(h.owner))).ok).toBe(false);
  });

  it('[18] reports a missing Move Members permission', async () => {
    const h = await roomWithOwner();
    const target = h.guild.addMember({ name: 'Hedef' });
    await h.move(target, h.room.id);
    h.guild.botRole.permissions.bitfield &= ~PermissionFlagsBits.MoveMembers;
    const result = await h.rooms.disconnect(h.ctx, gm(target));
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('Üyeleri Taşı');
  });
});

describe('room permissions never grant guild-wide privileges', () => {
  const assertNoForbidden = (channel: FakeVoiceChannel, ownerId: string) => {
    const own = overwrite(channel, ownerId);
    expect(own).toBeDefined();
    expect(own!.allow.bitfield & FORBIDDEN_OWNER_PERMISSIONS).toBe(0n);
    for (const entry of channel.permissionOverwrites.cache.values()) {
      if (entry.id === channel.client.user.id) continue;
      expect(entry.allow.bitfield & FORBIDDEN_OWNER_PERMISSIONS).toBe(0n);
    }
  };

  it('holds after creation and after every management action', async () => {
    const h = await roomWithOwner();
    assertNoForbidden(h.room, h.owner.id);
    const friend = h.guild.addMember({ name: 'Arkadaş' });
    const pest = h.guild.addMember({ name: 'Rahatsız' });
    await h.rooms.lock(h.ctx);
    await h.rooms.hide(refresh(h));
    await h.rooms.allow(refresh(h), gm(friend));
    await h.rooms.block(refresh(h), gm(pest));
    assertNoForbidden(h.room, h.owner.id);
    // The owner's guild-level permissions are unchanged.
    expect(h.owner.permissions.has(PermissionFlagsBits.ManageChannels)).toBe(false);
    expect(h.owner.permissions.has(PermissionFlagsBits.KickMembers)).toBe(false);
  });

  function refresh(h: Awaited<ReturnType<typeof roomWithOwner>>): RoomContext {
    const ctx = h.rooms.resolve(gm(h.owner));
    if (!RoomManager.isContext(ctx)) throw new Error('context');
    return ctx;
  }
});

describe('lock, hide, block, allow', () => {
  it('lock denies Connect for @everyone while connected members and the owner keep access', async () => {
    const h = await roomWithOwner();
    const inside = h.guild.addMember({ name: 'İçeride' });
    await h.move(inside, h.room.id);
    expect((await h.rooms.lock(h.ctx)).ok).toBe(true);

    const everyone = overwrite(h.room, h.guild.id)!;
    expect(everyone.deny.bitfield & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
    expect(overwrite(h.room, h.owner.id)!.allow.bitfield & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
    expect(overwrite(h.room, inside.id)!.allow.bitfield & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
    expect(inside.voice.channelId).toBe(h.room.id);
    expect((await h.repos.tempVoice.findRoomByChannel(h.room.id))?.locked).toBe(true);
  });

  it('lock neutralises role allows inherited from the category', async () => {
    const h = await createVoiceHarness();
    const memberRole = h.guild.addRole({ name: 'Üye', position: 5 });
    h.category.permissionOverwrites.cache.set(memberRole.id, {
      id: memberRole.id,
      type: OverwriteType.Role,
      allow: { bitfield: PermissionFlagsBits.Connect | PermissionFlagsBits.ViewChannel },
      deny: { bitfield: 0n },
    });
    const owner = h.guild.addMember({ name: 'Sahip' });
    const room = await h.createRoom(owner);
    const ctx = h.rooms.resolve(gm(owner)) as RoomContext;
    await h.rooms.lock(ctx);
    expect(overwrite(room, memberRole.id)!.allow.bitfield & PermissionFlagsBits.Connect).toBe(0n);
  });

  it('block stores a room-only restriction and disconnects the target', async () => {
    const h = await roomWithOwner();
    const target = h.guild.addMember({ name: 'Engellenen' });
    await h.move(target, h.room.id);
    expect((await h.rooms.block(h.ctx, gm(target))).ok).toBe(true);
    expect(overwrite(h.room, target.id)!.deny.bitfield & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
    expect(target.voice.channelId).toBeNull();
    expect(target.ban).not.toHaveBeenCalled();
    expect((await h.repos.tempVoice.listRestrictions(h.ctx.room.id)).map((r) => r.userId)).toEqual([target.id]);

    expect((await h.rooms.unblock(h.ctx, gm(target))).ok).toBe(true);
    expect(overwrite(h.room, target.id)).toBeUndefined();
  });

  it('refuses to block administrators or the owner', async () => {
    const h = await roomWithOwner();
    const admin = h.guild.addMember({ name: 'Admin', permissions: PermissionFlagsBits.Administrator });
    expect((await h.rooms.block(h.ctx, gm(admin))).ok).toBe(false);
    expect((await h.rooms.block(h.ctx, gm(h.owner))).ok).toBe(false);
  });

  it('allow replaces an existing block', async () => {
    const h = await roomWithOwner();
    const target = h.guild.addMember({ name: 'Arkadaş' });
    await h.rooms.block(h.ctx, gm(target));
    expect((await h.rooms.allow(h.ctx, gm(target))).ok).toBe(true);
    expect(await h.repos.tempVoice.listRestrictions(h.ctx.room.id)).toHaveLength(0);
    expect(overwrite(h.room, target.id)!.allow.bitfield & PermissionFlagsBits.Connect).toBe(PermissionFlagsBits.Connect);
  });

  it('refuses additions beyond the overwrite limit', async () => {
    const h = await roomWithOwner();
    for (let i = 0; i < 88; i++) await h.repos.tempVoice.addAllowed(h.ctx.room.id, `${200_000_000_000_000_000n + BigInt(i)}`, h.owner.id);
    const result = await h.rooms.allow(h.ctx, gm(h.guild.addMember({ name: 'Fazla' })));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('izin sınırına');
  });
});

describe('rename, limit, transfer, close', () => {
  it('renames within Discord’s rename rate limit', async () => {
    const h = await roomWithOwner();
    expect((await h.rooms.rename(h.ctx, 'Oyun')).ok).toBe(true);
    expect(h.room.name).toBe('🔊・Oyun');
    expect((await h.rooms.rename(h.ctx, 'Sohbet')).ok).toBe(true);
    const third = await h.rooms.rename(h.ctx, 'Müzik');
    expect(third.ok).toBe(false);
    expect(h.room.setName).toHaveBeenCalledTimes(2);
  });

  it('validates user limits', async () => {
    const h = await roomWithOwner();
    expect((await h.rooms.setLimit(h.ctx, 5)).ok).toBe(true);
    expect(h.room.userLimit).toBe(5);
    expect((await h.rooms.setLimit(h.ctx, 100)).ok).toBe(false);
    expect((await h.rooms.setLimit(h.ctx, 0)).ok).toBe(true);
  });

  it('transfers only to members inside the room', async () => {
    const h = await roomWithOwner();
    const outside = h.guild.addMember({ name: 'Dışarıda' });
    expect((await h.rooms.transfer(h.ctx, gm(outside))).ok).toBe(false);
    await h.move(outside, h.room.id);
    expect((await h.rooms.transfer(h.ctx, gm(outside))).ok).toBe(true);
    expect((await h.repos.tempVoice.findRoomByChannel(h.room.id))?.ownerId).toBe(outside.id);
    // The previous owner lost control.
    expect(RoomManager.isContext(h.rooms.resolve(gm(h.owner), h.room.id))).toBe(false);
  });

  it('close deletes the room and disconnects everyone (voice only)', async () => {
    const h = await roomWithOwner();
    const guest = h.guild.addMember({ name: 'Misafir' });
    await h.move(guest, h.room.id);
    expect((await h.rooms.close(h.ctx)).ok).toBe(true);
    expect(h.guild.channels.cache.has(h.room.id)).toBe(false);
    expect(guest.kick).not.toHaveBeenCalled();
    expect(h.repos.tempVoice.rooms.size).toBe(0);
  });
});
