import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_BOT_OWNER_IDS, isBotOwner, setBotOwners } from '../src/config/owners';
import { loadEnv } from '../src/config/env';
import { ModerationService } from '../src/modules/moderation/ModerationService';
import { YargiService } from '../src/modules/moderation/YargiService';
import { RoomManager } from '../src/modules/tempVoice/RoomManager';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, nextSnowflake } from './fakes/discord';
import { createGuardHarness } from './fakes/guardHarness';
import { createVoiceHarness } from './fakes/harness';

const OWNER_ID = '887788724988026890';

afterEach(() => setBotOwners(DEFAULT_BOT_OWNER_IDS));

describe('bot owner is outside every sanction', () => {
  it('is configured by default', () => {
    expect(isBotOwner(OWNER_ID)).toBe(true);
    expect(loadEnv({ DISCORD_TOKEN: 'x'.repeat(60), DISCORD_CLIENT_ID: '123456789012345678', DATABASE_URL: 'file:x' }).BOT_OWNER_IDS).toEqual([OWNER_ID]);
  });

  it('enters locked rooms and cannot be kicked or blocked from a room', async () => {
    const h = await createVoiceHarness();
    const roomOwner = h.guild.addMember({ name: 'Sahip' });
    const room = await h.createRoom(roomOwner);
    const ctx = h.rooms.resolve(asDiscord<GuildMember>(roomOwner));
    if (!RoomManager.isContext(ctx)) throw new Error(ctx.message);
    await h.rooms.lock(ctx);

    const me = h.guild.addMember({ id: OWNER_ID, name: 'Emirhan' });
    await h.move(me, room.id);
    expect(me.voice.channelId).toBe(room.id);

    const locked = h.rooms.resolve(asDiscord<GuildMember>(roomOwner));
    if (!RoomManager.isContext(locked)) throw new Error(locked.message);
    expect((await h.rooms.disconnect(locked, asDiscord<GuildMember>(me))).message).toBe('Sahibimi odadan atamam.');
    expect((await h.rooms.block(locked, asDiscord<GuildMember>(me))).message).toBe('Sahibimi engelleyemem.');
    expect(me.voice.channelId).toBe(room.id);
  });

  it('cannot be banned or kicked, not even by the server owner', async () => {
    const h = await createGuardHarness();
    const moderation = new ModerationService(h.processor, createSilentLogger(), h.selfActions);
    h.guild.addMember({ id: OWNER_ID, name: 'Emirhan' });
    const serverOwner = h.guild.members.cache.get(h.guild.ownerId)!;
    const run = (action: 'BAN' | 'KICK') =>
      moderation.execute({ action, guild: h.discordGuild, moderator: asDiscord<GuildMember>(serverOwner), targetId: OWNER_ID, reason: null, invocationId: nextSnowflake() });
    expect(await run('BAN')).toMatchObject({ ok: false, message: 'Sahibimi banlayamam.' });
    expect(await run('KICK')).toMatchObject({ ok: false, message: 'Sahibimi sunucudan atamam.' });
    expect(h.guild.bans.create).not.toHaveBeenCalled();
  });

  it('is never re-banned from the yargı list and is exempt from Guard', async () => {
    const h = await createGuardHarness();
    const yargi = new YargiService(h.repos.yargi, createSilentLogger());
    await h.repos.yargi.upsert({ guildId: h.guild.id, userId: OWNER_ID, userTag: null, moderatorId: '1', reason: null });
    expect(await yargi.enforce(asDiscord<Guild>(h.discordGuild), OWNER_ID, 'JOIN')).toBe(false);
    expect(h.guild.bans.create).not.toHaveBeenCalled();
    expect(await h.trust.exemptionFor(asDiscord<Guild>(h.discordGuild), OWNER_ID)).toBe('OWNER');
  });

  it('follows BOT_OWNER_IDS', async () => {
    setBotOwners(['111111111111111111']);
    expect(isBotOwner(OWNER_ID)).toBe(false);
    expect(isBotOwner('111111111111111111')).toBe(true);
    expect(PermissionFlagsBits.BanMembers).toBeTruthy();
  });
});
