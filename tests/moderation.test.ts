import { PermissionFlagsBits, type GuildMember, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/core/App';
import { ModerationService, type ModerationAction } from '../src/modules/moderation/ModerationService';
import { handlePrefixMessage } from '../src/modules/moderation/prefixCommands';
import { parsePrefixCommand, parseUserId } from '../src/modules/moderation/prefixParser';
import { CooldownService } from '../src/services/CooldownService';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, BOT_ID, nextSnowflake, type FakeMember } from './fakes/discord';
import { createGuardHarness, type GuardHarnessOptions } from './fakes/guardHarness';

async function modHarness(options: GuardHarnessOptions = {}) {
  const h = await createGuardHarness(options);
  const moderation = new ModerationService(h.processor, createSilentLogger());
  const modRole = h.guild.addRole({ name: 'Moderatör', position: 15, permissions: PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers });
  const moderator = h.guild.addMember({ name: 'Moderatör', roles: [modRole] });
  const victim = h.guild.addMember({ name: 'Kurban', roles: [h.memberRole] });
  const run = (action: ModerationAction, targetId: string, by: FakeMember = moderator, reason: string | null = 'kural ihlali') =>
    moderation.execute({ action, guild: h.discordGuild, moderator: asDiscord<GuildMember>(by), targetId, reason, invocationId: nextSnowflake() });
  return { ...h, moderation, modRole, moderator, victim, run };
}

describe('prefix parsing', () => {
  it('parses commands and arguments', () => {
    expect(parsePrefixCommand('.ban <@123456789012345678> spam yapıyor', '.')).toEqual({ name: 'ban', args: ['<@123456789012345678>', 'spam', 'yapıyor'] });
    expect(parsePrefixCommand('.KICK 123', '.')?.name).toBe('kick');
    expect(parsePrefixCommand('merhaba', '.')).toBeNull();
    expect(parsePrefixCommand('.', '.')).toBeNull();
  });

  it('accepts mentions and raw ids only', () => {
    expect(parseUserId('<@123456789012345678>')).toBe('123456789012345678');
    expect(parseUserId('<@!123456789012345678>')).toBe('123456789012345678');
    expect(parseUserId('123456789012345678')).toBe('123456789012345678');
    expect(parseUserId('@kullanici')).toBeNull();
    expect(parseUserId(undefined)).toBeNull();
  });
});

describe('.ban / .kick', () => {
  it('bans a member with an attributable audit reason', async () => {
    const h = await modHarness();
    const result = await h.run('BAN', h.victim.id);
    expect(result.ok).toBe(true);
    expect(h.guild.bans.create).toHaveBeenCalledWith(h.victim.id, { reason: expect.stringContaining(`Moderatör#0 (${h.moderator.id}): kural ihlali`) });
    expect(h.victim.send).toHaveBeenCalled();
  });

  it('kicks a member from the server', async () => {
    const h = await modHarness();
    expect((await h.run('KICK', h.victim.id)).ok).toBe(true);
    expect(h.victim.kick).toHaveBeenCalledTimes(1);
    expect(h.guild.bans.create).not.toHaveBeenCalled();
  });

  it('can ban a user who is not in the server by id', async () => {
    const h = await modHarness();
    const outsider = nextSnowflake();
    expect((await h.run('BAN', outsider)).ok).toBe(true);
    expect(h.guild.bannedIds.has(outsider)).toBe(true);
    expect((await h.run('KICK', nextSnowflake())).ok).toBe(false);
  });

  it('requires the matching permission', async () => {
    const h = await modHarness();
    const regular = h.guild.addMember({ name: 'Sıradan' });
    const ban = await h.run('BAN', h.victim.id, regular);
    expect(ban).toMatchObject({ ok: false });
    expect(ban.message).toContain('Üyeleri Yasakla');
    expect(h.guild.bans.create).not.toHaveBeenCalled();
  });

  it('enforces role hierarchy, self, owner and bot protection', async () => {
    const h = await modHarness();
    const peer = h.guild.addMember({ name: 'Eşit', roles: [h.modRole] });
    expect((await h.run('BAN', peer.id)).ok).toBe(false); // same level
    expect((await h.run('BAN', h.attacker.id)).ok).toBe(false); // higher (admin role at 20)
    expect((await h.run('BAN', h.moderator.id)).ok).toBe(false);
    expect((await h.run('BAN', h.guild.ownerId)).ok).toBe(false);
    expect((await h.run('KICK', BOT_ID)).ok).toBe(false);
    expect(h.guild.bans.create).not.toHaveBeenCalled();
  });

  it('refuses targets above Biri even for the owner', async () => {
    const h = await modHarness();
    const top = h.guild.addRole({ name: 'Zirve', position: 70 });
    const high = h.guild.addMember({ name: 'Yüksek', roles: [top] });
    const owner = h.guild.members.cache.get(h.guild.ownerId)!;
    const result = await h.run('BAN', high.id, owner);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Biri rolünü yukarı taşıyın');
  });

  it('reports a missing bot permission', async () => {
    const h = await modHarness();
    h.guild.botRole.permissions.bitfield &= ~PermissionFlagsBits.BanMembers;
    h.guild.botRole.permissions.bitfield &= ~PermissionFlagsBits.Administrator;
    const result = await h.run('BAN', h.victim.id);
    expect(result.message).toContain("Biri'nin **Üyeleri Yasakla** yetkisi yok");
  });
});

describe('.unban', () => {
  it('lifts an existing ban with an attributable reason', async () => {
    const h = await modHarness();
    expect((await h.run('BAN', h.victim.id)).ok).toBe(true);
    const result = await h.run('UNBAN', h.victim.id, h.moderator, 'itiraz kabul edildi');
    expect(result.ok).toBe(true);
    expect(h.guild.bans.remove).toHaveBeenCalledWith(h.victim.id, expect.stringContaining(`(${h.moderator.id}): itiraz kabul edildi`));
    expect(h.guild.bannedIds.has(h.victim.id)).toBe(false);
  });

  it('reports users who are not banned', async () => {
    const h = await modHarness();
    const result = await h.run('UNBAN', nextSnowflake());
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain('yasaklı değil');
  });

  it('requires Ban Members and is not counted by Guard', async () => {
    const h = await modHarness({ mode: 'ACTIVE' });
    const regular = h.guild.addMember({ name: 'Sıradan' });
    expect((await h.run('UNBAN', h.victim.id, regular)).message).toContain('Üyeleri Yasakla');

    const ids = Array.from({ length: 5 }, () => nextSnowflake());
    for (const id of ids) h.guild.bannedIds.add(id);
    for (const id of ids) expect((await h.run('UNBAN', id)).ok).toBe(true);
    expect(h.repos.guard.events).toHaveLength(0);
    expect(h.repos.guard.incidents).toHaveLength(0);
  });
});

describe('Guard sees bot-proxied moderation', () => {
  it('blocks the ban that completes a mass-ban burst and strips the moderator', async () => {
    const h = await modHarness({ mode: 'ACTIVE' });
    h.guild.botRole.permissions.bitfield |= PermissionFlagsBits.BanMembers;
    const targets = Array.from({ length: 3 }, (_, i) => h.guild.addMember({ name: `Hedef${i}` }));
    const results = [];
    for (const target of targets) results.push(await h.run('BAN', target.id));

    expect(results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(results[2]?.blockedByGuard).toBe(true);
    expect(h.guild.bans.create).toHaveBeenCalledTimes(2);
    const incident = h.repos.guard.incidents[0]!;
    expect(incident).toMatchObject({ executorId: h.moderator.id, module: 'MEMBER_BAN', actionTaken: 'ROLES_STRIPPED' });
    expect(h.moderator.roles.cache.size).toBe(0);
    // With the role gone, further bans are refused by the permission check.
    expect((await h.run('BAN', h.victim.id)).ok).toBe(false);
  });

  it('ALERT mode records the burst but does not block moderators', async () => {
    const h = await modHarness({ mode: 'ALERT' });
    h.guild.botRole.permissions.bitfield |= PermissionFlagsBits.BanMembers;
    for (let i = 0; i < 3; i++) expect((await h.run('BAN', h.guild.addMember({ name: `H${i}` }).id)).ok).toBe(true);
    expect(h.repos.guard.incidents[0]).toMatchObject({ executorId: h.moderator.id, actionTaken: 'ALERTED' });
  });

  it('trusted moderators are logged but never blocked', async () => {
    const h = await modHarness({ mode: 'ACTIVE' });
    h.guild.botRole.permissions.bitfield |= PermissionFlagsBits.BanMembers;
    await h.trust.add(h.guild.id, h.moderator.id, 'USER', h.guild.ownerId, null);
    for (let i = 0; i < 4; i++) expect((await h.run('BAN', h.guild.addMember({ name: `H${i}` }).id)).ok).toBe(true);
    expect(h.repos.guard.events.filter((e) => e.executorId === h.moderator.id)).toHaveLength(4);
  });
});

describe('prefix message handler', () => {
  async function messageHarness() {
    const h = await modHarness();
    h.guild.botRole.permissions.bitfield |= PermissionFlagsBits.BanMembers;
    const record = vi.fn(async () => undefined);
    const app = asDiscord<App>({
      env: { PREFIX: '.' },
      cooldowns: new CooldownService(),
      moderation: h.moderation,
      repos: { commandAudit: { record } },
      logger: createSilentLogger(),
    });
    const send = async (content: string) => {
      const message = {
        id: nextSnowflake(),
        content,
        author: { id: h.moderator.id, bot: false },
        member: h.moderator,
        guild: h.guild,
        guildId: h.guild.id,
        reply: vi.fn(async () => undefined),
      };
      await handlePrefixMessage(app, asDiscord<Message<true>>(message));
      return message;
    };
    return { ...h, send, record };
  }

  it('runs .ban with a mention and records the command', async () => {
    const h = await messageHarness();
    const message = await h.send(`.ban <@${h.victim.id}> reklam yapıyor`);
    expect(h.guild.bans.create).toHaveBeenCalledWith(h.victim.id, { reason: expect.stringContaining('reklam yapıyor') });
    expect(message.reply).toHaveBeenCalledTimes(1);
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ command: '.ban', success: true }));
  });

  it('shows usage for a missing target and ignores unrelated messages', async () => {
    const h = await messageHarness();
    const usage = await h.send('.kick');
    expect(JSON.stringify((usage.reply.mock.calls[0] as unknown[])[0])).toContain('Kullanım');
    const unrelated = await h.send('.selam herkese');
    expect(unrelated.reply).not.toHaveBeenCalled();
    const chat = await h.send('ban atın şuna');
    expect(chat.reply).not.toHaveBeenCalled();
  });
});

describe('.unban via prefix', () => {
  it('is routed by the prefix handler', () => {
    expect(parsePrefixCommand('.unban 123456789012345678 itiraz', '.')).toEqual({ name: 'unban', args: ['123456789012345678', 'itiraz'] });
  });
});
