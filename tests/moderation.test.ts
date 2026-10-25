import { Collection, PermissionFlagsBits, type AutocompleteInteraction, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/core/App';
import { ModerationService, type ModerationAction } from '../src/modules/moderation/ModerationService';
import banCommand from '../src/commands/moderation/ban';
import kickCommand from '../src/commands/moderation/kick';
import unbanCommand, { forgetBans } from '../src/commands/moderation/unban';
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

describe('ban / kick', () => {
  it('bans a member with an attributable audit reason', async () => {
    const h = await modHarness();
    const result = await h.run('BAN', h.victim.id);
    expect(result.ok).toBe(true);
    expect(h.guild.bans.create).toHaveBeenCalledWith(h.victim.id, { reason: expect.stringContaining(`Moderatör#0 (${h.moderator.id}): kural ihlali`), deleteMessageSeconds: 0 });
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

describe('unban', () => {
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

describe('slash commands', () => {
  async function slashHarness() {
    const h = await modHarness();
    const app = asDiscord<App>({ moderation: h.moderation });
    const invoke = async (command: typeof banCommand, options: Record<string, unknown>) => {
      const interaction = {
        id: nextSnowflake(),
        guild: h.guild,
        guildId: h.guild.id,
        member: h.moderator,
        deferReply: vi.fn(async () => undefined),
        editReply: vi.fn(async () => undefined),
        reply: vi.fn(async () => undefined),
        deferred: false,
        replied: false,
        options: {
          getUser: (name: string) => (options[name] ? { id: options[name] } : null),
          getString: (name: string) => (options[name] as string | undefined) ?? null,
          getInteger: (name: string) => (options[name] as number | undefined) ?? null,
        },
      };
      let thrown: unknown = null;
      await command.execute(asDiscord<ChatInputCommandInteraction<'cached'>>(interaction), app).catch((error: unknown) => {
        thrown = error;
      });
      return { interaction, thrown, text: JSON.stringify(interaction.editReply.mock.calls) };
    };
    return { ...h, invoke };
  }

  it('are registered with permission-gated menus', () => {
    const json = [banCommand, kickCommand, unbanCommand].map((c) => c.data.toJSON());
    expect(json.map((c) => c.name)).toEqual(['ban', 'kick', 'unban']);
    expect(json[0]!.default_member_permissions).toBe(PermissionFlagsBits.BanMembers.toString());
    expect(json[1]!.default_member_permissions).toBe(PermissionFlagsBits.KickMembers.toString());
    expect(JSON.stringify(json[0])).toContain('mesaj-sil');
    expect(JSON.stringify(json[2])).toContain('"autocomplete":true');
  });

  it('/ban bans privately and passes the message deletion window', async () => {
    const h = await slashHarness();
    const { interaction, thrown, text } = await h.invoke(banCommand, { kullanici: h.victim.id, sebep: 'reklam', 'mesaj-sil': 86_400 });
    expect(thrown).toBeNull();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(h.guild.bans.create).toHaveBeenCalledWith(h.victim.id, { reason: expect.stringContaining('reklam'), deleteMessageSeconds: 86_400 });
    expect(text).toContain('Yasaklandı');
  });

  it('/kick explains refusals and marks them as handled', async () => {
    const h = await slashHarness();
    const { thrown, text } = await h.invoke(kickCommand, { kullanici: h.guild.ownerId });
    expect(text).toContain('Sunucu sahibini');
    expect(thrown).toMatchObject({ handled: true });
  });

  it('/unban accepts an id or mention and rejects free text', async () => {
    const h = await slashHarness();
    h.guild.bannedIds.add(h.victim.id);
    expect((await h.invoke(unbanCommand, { kullanici: `<@${h.victim.id}>` })).text).toContain('Yasak Kaldırıldı');
    const bad = await h.invoke(unbanCommand, { kullanici: 'birisi' });
    expect(bad.interaction.reply).toHaveBeenCalled();
    expect(h.guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  it('/unban autocompletes from the ban list', async () => {
    const h = await modHarness();
    const bans = new Collection([
      ['300000000000000001', { user: { id: '300000000000000001', tag: 'Spammer#0' }, reason: 'reklam' }],
      ['300000000000000002', { user: { id: '300000000000000002', tag: 'Troll#0' }, reason: null }],
    ]);
    const guild = { id: nextSnowflake(), bans: { fetch: vi.fn(async () => bans) } };
    const respond = vi.fn(async () => undefined);
    const ask = (focused: string) =>
      unbanCommand.autocomplete!(asDiscord<AutocompleteInteraction<'cached'>>({ guild, options: { getFocused: () => focused }, respond }), asDiscord<App>({}));

    await ask('troll');
    expect(respond).toHaveBeenLastCalledWith([{ name: 'Troll#0 (300000000000000002)', value: '300000000000000002' }]);
    await ask('');
    expect((respond.mock.calls.at(-1) as unknown[])[0]).toHaveLength(2);
    expect(guild.bans.fetch).toHaveBeenCalledTimes(1); // cached between keystrokes
    forgetBans(guild.id);
    await ask('spam');
    expect(guild.bans.fetch).toHaveBeenCalledTimes(2);
    void h;
  });
});
