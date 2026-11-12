import { Collection, GatewayIntentBits, PermissionFlagsBits, type AutocompleteInteraction, type ChatInputCommandInteraction, type GuildMember, type Message } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../src/core/App';
import { ModerationService, type ModerationAction, type NukeableChannel } from '../src/modules/moderation/ModerationService';
import banCommand from '../src/commands/moderation/ban';
import kickCommand from '../src/commands/moderation/kick';
import unbanCommand, { forgetBans } from '../src/commands/moderation/unban';
import { gatewayIntents } from '../src/core/createApp';
import { buildEventList } from '../src/events';
import { handlePrefixMessage } from '../src/modules/moderation/prefixCommands';
import { parsePrefixCommand } from '../src/modules/moderation/prefixParser';
import { CooldownService } from '../src/services/CooldownService';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, BOT_ID, nextSnowflake, type FakeMember, type FakeTextChannel } from './fakes/discord';
import { createGuardHarness, type GuardHarnessOptions } from './fakes/guardHarness';

async function modHarness(options: GuardHarnessOptions = {}) {
  const h = await createGuardHarness(options);
  const moderation = new ModerationService(h.processor, createSilentLogger(), h.selfActions);
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

describe('nuke', () => {
  async function nukeHarness(options: GuardHarnessOptions = {}) {
    const h = await modHarness(options);
    h.modRole.permissions.bitfield |= PermissionFlagsBits.ManageChannels;
    const nuke = (channel: FakeTextChannel, by: FakeMember = h.moderator) =>
      h.moderation.nuke({ guild: h.discordGuild, moderator: asDiscord<GuildMember>(by), channel: asDiscord<NukeableChannel>(channel), reason: 'reklam', invocationId: nextSnowflake() });
    return { ...h, nuke };
  }

  it('recreates the channel in place and deletes the original', async () => {
    const h = await nukeHarness();
    const channel = h.guild.addTextChannel('sohbet');
    channel.rawPosition = 4;
    const result = await h.nuke(channel);
    expect(result.ok).toBe(true);
    expect(channel.delete).toHaveBeenCalledWith(expect.stringContaining(`(${h.moderator.id}): reklam`));
    expect(h.guild.channels.cache.has(channel.id)).toBe(false);
    const fresh = h.guild.channels.cache.get(result.channel!.id) as FakeTextChannel;
    expect(fresh.name).toBe('sohbet');
    expect(fresh.rawPosition).toBe(4);
    expect(fresh.sent).toHaveLength(1);
    expect(h.selfActions.isSelfAction(h.guild.id, 'CHANNEL_DELETE', channel.id)).toBe(true);
  });

  it('requires Manage Channels', async () => {
    const h = await nukeHarness();
    const channel = h.guild.addTextChannel('sohbet');
    const result = await h.nuke(channel, h.victim);
    expect(result.message).toContain('Kanalları Yönet');
    expect(channel.clone).not.toHaveBeenCalled();
  });

  it('removes the copy when the original cannot be deleted', async () => {
    const h = await nukeHarness();
    const channel = h.guild.addTextChannel('sohbet');
    channel.delete.mockRejectedValueOnce(new Error('Missing Permissions'));
    const result = await h.nuke(channel);
    expect(result.ok).toBe(false);
    expect([...h.guild.channels.cache.values()].filter((c) => c.name === 'sohbet')).toHaveLength(1);
  });

  it('counts as channel deletion for Guard and blocks a mass nuke', async () => {
    const h = await nukeHarness({ mode: 'ACTIVE' });
    const channels = Array.from({ length: 5 }, (_, i) => h.guild.addTextChannel(`kanal-${i}`));
    const results = [];
    for (const channel of channels) results.push(await h.nuke(channel));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, false]);
    expect(results[4]?.blockedByGuard).toBe(true);
    expect(h.repos.guard.incidents[0]).toMatchObject({ executorId: h.moderator.id, module: 'CHANNEL_DELETE', actionTaken: 'ROLES_STRIPPED' });
    expect(h.guild.channels.cache.has(channels[4]!.id)).toBe(true);
  });
});

describe('prefix commands (.yargi / .unyargı)', () => {
  async function prefixHarness(options: GuardHarnessOptions = {}) {
    const h = await modHarness(options);
    const logs: Array<{ kind: string; embed: { title?: string; description?: string; footer?: { text: string } } }> = [];
    h.moderation.setLogSink((_guildId, embed, kind) => logs.push({ kind, embed: embed.toJSON() }));
    const audit: Array<{ command: string; success: boolean; options: string }> = [];
    const cooldowns = new CooldownService();
    const app = asDiscord<App>({
      env: { PREFIX: '.' },
      moderation: h.moderation,
      cooldowns,
      health: { increment: vi.fn() },
      logger: createSilentLogger(),
      repos: { commandAudit: { record: vi.fn(async (entry: (typeof audit)[number]) => void audit.push(entry)) } },
    });
    const say = async (content: string, by: FakeMember = h.moderator) => {
      const reply = vi.fn(async (_payload: unknown) => undefined);
      const message = { id: nextSnowflake(), content, guild: h.guild, guildId: h.guild.id, member: by, author: by.user, reply };
      await handlePrefixMessage(app, asDiscord<Message<true>>(message));
      return { reply, text: JSON.stringify(reply.mock.calls) };
    };
    /** A second moderator, so consecutive commands are not stopped by the per-user cooldown. */
    const colleague = h.guild.addMember({ name: 'Yargıç', roles: [h.modRole] });
    return { ...h, logs, audit, say, colleague };
  }

  it('parses names case- and dotless-i-insensitively', () => {
    expect(parsePrefixCommand('.yargi 123 reklam yaptı', '.')).toEqual({ name: 'yargi', args: ['123', 'reklam', 'yaptı'] });
    expect(parsePrefixCommand('.YARGI 123', '.')?.name).toBe('yargi');
    expect(parsePrefixCommand('.unyargı 123', '.')?.name).toBe('unyargi');
    expect(parsePrefixCommand('.UNYARGİ 123', '.')?.name).toBe('unyargi');
    expect(parsePrefixCommand('. yargi 123', '.')).toBeNull();
    expect(parsePrefixCommand('yargi 123', '.')).toBeNull();
    expect(parsePrefixCommand('.', '.')).toBeNull();
  });

  it('.yargi bans by id with a reason and logs who, why and how', async () => {
    const h = await prefixHarness();
    const { text } = await h.say(`.yargi ${h.victim.id} reklam ve küfür`);
    expect(text).toContain('Yargılandı');
    expect(h.guild.bans.create).toHaveBeenCalledWith(h.victim.id, { reason: expect.stringContaining(`(${h.moderator.id}): reklam ve küfür`), deleteMessageSeconds: 0 });
    expect(h.logs).toHaveLength(1);
    expect(h.logs[0]!.embed.description).toContain(`<@${h.victim.id}> \`Kurban#0\` (\`${h.victim.id}\`)`);
    expect(h.logs[0]!.embed.description).toContain('**Sebep:** reklam ve küfür');
    expect(h.logs[0]!.embed.footer?.text).toContain('.yargi');
    expect(h.audit[0]).toMatchObject({ command: '.yargi', success: true });
  });

  it('.yargi works without a reason and for users outside the server', async () => {
    const h = await prefixHarness();
    const outsider = nextSnowflake();
    const { text } = await h.say(`.yargı ${outsider}`);
    expect(text).toContain('Yargılandı');
    expect(h.guild.bannedIds.has(outsider)).toBe(true);
    expect(h.logs[0]!.embed.description).toContain('**Sebep:** Belirtilmedi');
    expect(h.logs[0]!.embed.description).toContain('sunucuda değildi');
  });

  it('.unyargı lifts the ban, with or without a reason, and shows the original ban reason', async () => {
    const h = await prefixHarness();
    await h.say(`.yargi ${h.victim.id} reklam`);
    const { text } = await h.say(`.unyargı ${h.victim.id}`);
    expect(text).toContain('Yargı Kaldırıldı');
    expect(h.guild.bannedIds.has(h.victim.id)).toBe(false);
    expect(h.logs[1]!.embed.title).toContain('Yasak Kaldırıldı');
    expect(h.logs[1]!.embed.description).toContain('**Yasaklanma sebebi:**');
    expect(h.logs[1]!.embed.description).toContain('reklam');

    h.guild.bannedIds.add(h.victim.id);
    expect((await h.say(`.unyargi <@${h.victim.id}> itiraz kabul`, h.colleague)).text).toContain('Yargı Kaldırıldı');
    expect(h.guild.bans.remove).toHaveBeenLastCalledWith(h.victim.id, expect.stringContaining('itiraz kabul'));
    expect((await h.say(`.unyargi ${nextSnowflake()}`, h.guild.members.cache.get(h.guild.ownerId)!)).text).toContain('yasaklı değil');
  });

  it('explains the usage when the id is missing or invalid', async () => {
    const h = await prefixHarness();
    expect((await h.say('.yargi')).text).toContain('Kullanım');
    expect((await h.say('.yargi birisi reklam')).text).toContain('Kullanım');
    expect(h.guild.bans.create).not.toHaveBeenCalled();
  });

  it('rejects ids that are not Discord users before Guard counts them', async () => {
    const h = await prefixHarness({ mode: 'ACTIVE' });
    const ghost = nextSnowflake();
    h.guild.unknownUserIds.add(ghost);
    expect((await h.say(`.yargi ${ghost}`)).text).toContain('bulunamadı');
    expect(h.guild.bans.create).not.toHaveBeenCalled();
    expect(h.repos.guard.events).toHaveLength(0);
  });

  it('ignores members without Ban Members and unrelated messages silently', async () => {
    const h = await prefixHarness();
    const regular = h.guild.addMember({ name: 'Sıradan' });
    expect((await h.say(`.yargi ${h.victim.id}`, regular)).reply).not.toHaveBeenCalled();
    expect((await h.say('.selam nasılsın')).reply).not.toHaveBeenCalled();
    expect((await h.say('...')).reply).not.toHaveBeenCalled();
    expect(h.guild.bans.create).not.toHaveBeenCalled();
    expect(h.audit).toHaveLength(0);
  });

  it('is rate limited per moderator and still counted by Guard', async () => {
    const h = await prefixHarness({ mode: 'ALERT' });
    const [a, b] = [h.guild.addMember({ name: 'A' }), h.guild.addMember({ name: 'B' })];
    await h.say(`.yargi ${a.id}`);
    expect((await h.say(`.yargi ${b.id}`)).text).toContain('Çok hızlısın');
    expect(h.guild.bans.create).toHaveBeenCalledTimes(1);
    const event = h.repos.guard.events.find((e) => e.executorId === h.moderator.id)!;
    expect(event.module).toBe('MEMBER_BAN');
    expect(event.details).toContain('.yargi');
  });

  it('requests the Message Content intent and the message event only when enabled', () => {
    const off = { ENABLE_GUILD_MEMBERS_INTENT: false, ENABLE_MESSAGE_LOGS: false, ENABLE_PREFIX_COMMANDS: false };
    expect(gatewayIntents(off)).not.toContain(GatewayIntentBits.MessageContent);
    expect(gatewayIntents({ ...off, ENABLE_PREFIX_COMMANDS: true })).toEqual(expect.arrayContaining([GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]));
    const names = (prefix: boolean) => buildEventList(false, false, prefix).map((event) => event.name);
    expect(names(true)).toContain('messageCreate');
    expect(names(false)).not.toContain('messageCreate');
  });
});
