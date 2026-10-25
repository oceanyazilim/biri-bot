import { PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOG_CHANNEL_KINDS } from '../src/config/constants';
import { auditSource, GuardService } from '../src/modules/guard/GuardService';
import { brandEmbed } from '../src/modules/logging/embeds';
import { LogChannelService } from '../src/modules/logging/LogChannelService';
import { LogDispatcher } from '../src/modules/logging/LogDispatcher';
import { SelfActionRegistry } from '../src/services/SelfActionRegistry';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, FakeGuild, FakeTextChannel } from './fakes/discord';
import { createGuardHarness } from './fakes/guardHarness';
import { createMemoryRepositories } from './fakes/memoryRepositories';

afterEach(() => vi.useRealTimers());

function logHarness(guild = new FakeGuild()) {
  const repos = createMemoryRepositories();
  const selfActions = new SelfActionRegistry();
  const service = new LogChannelService(repos.logChannels, repos.guard, selfActions, createSilentLogger());
  return { repos, guild, service, selfActions, g: asDiscord<Guild>(guild) };
}

describe('log channel structure', () => {
  it('creates a protected category with all channels', async () => {
    const h = logHarness();
    const result = await h.service.ensureStructure(h.g, LOG_CHANNEL_KINDS);
    expect(result.created).toHaveLength(LOG_CHANNEL_KINDS.length + 1);
    expect(result.failed).toHaveLength(0);
    const category = h.guild.channels.cache.find((c) => c.name === '🛡️ BİRİ・GÜVENLİK')!;
    const everyone = category.permissionOverwrites.cache.get(h.guild.id)!;
    expect(everyone.deny.bitfield & PermissionFlagsBits.ViewChannel).toBe(PermissionFlagsBits.ViewChannel);
    expect(await h.service.getChannelId(h.guild.id, 'GUARD')).toBeTruthy();
    expect(h.selfActions.isSelfAction(h.guild.id, 'CHANNEL_CREATE', category.id)).toBe(true);
  });

  it('never creates duplicates when run again or after a restart', async () => {
    const h = logHarness();
    await h.service.ensureStructure(h.g, LOG_CHANNEL_KINDS);
    const count = h.guild.channels.cache.size;
    await h.service.ensureStructure(h.g, LOG_CHANNEL_KINDS);
    const restarted = new LogChannelService(h.repos.logChannels, h.repos.guard, h.selfActions, createSilentLogger());
    const result = await restarted.ensureStructure(h.g, LOG_CHANNEL_KINDS);
    expect(result.created).toHaveLength(0);
    expect(h.guild.channels.cache.size).toBe(count);
  });

  it('reuses existing channels found by name even without stored ids', async () => {
    const h = logHarness();
    await h.service.ensureStructure(h.g, ['GUARD']);
    const fresh = logHarness(h.guild);
    const result = await fresh.service.ensureStructure(fresh.g, ['GUARD']);
    expect(result.reused).toEqual(['CATEGORY', 'GUARD']);
  });

  it('[18] reports channels it could not create', async () => {
    const h = logHarness();
    h.guild.failChannelCreate = true;
    const result = await h.service.ensureStructure(h.g, ['GUARD']);
    expect(result.failed[0]?.kind).toBe('CATEGORY');
  });

  it('records log channel deletions and recovers with loop protection', async () => {
    vi.useFakeTimers();
    const h = logHarness();
    await h.service.ensureStructure(h.g, ['GUARD']);
    for (let round = 0; round < 5; round++) {
      const id = (await h.service.getChannelId(h.guild.id, 'GUARD'))!;
      const channel = h.guild.channels.cache.get(id);
      if (!channel) break; // recovery limit reached: the channel stays deleted
      h.guild.channels.cache.delete(id);
      await h.service.handleChannelDeleted(h.g, id, channel.name);
      await vi.advanceTimersByTimeAsync(3_100);
    }
    const deletions = h.repos.guard.events.filter((e) => e.eventType === 'LOG_CHANNEL_DELETED');
    expect(deletions).toHaveLength(4);
    // 1 initial creation + at most 3 recoveries within the hour.
    const guardChannels = h.guild.channels.create.mock.calls.filter((call) => (call[0] as { name: string }).name.includes('guard-log'));
    expect(guardChannels).toHaveLength(4);
  });
});

describe('LogDispatcher', () => {
  it('batches up to 10 embeds per message and summarises overflow', async () => {
    const channel = new FakeTextChannel(new FakeGuild(), { name: 'log' });
    const client = asDiscord<Client>({ channels: { cache: new Map([[channel.id, channel]]), fetch: async () => null } });
    const dispatcher = new LogDispatcher(client, { getChannelId: async () => channel.id }, createSilentLogger(), 1_000);
    for (let i = 0; i < 60; i++) dispatcher.enqueue('g', 'GUARD', brandEmbed().setTitle(`olay ${i}`));
    for (let i = 0; i < 6; i++) await dispatcher.flush();
    const sizes = channel.send.mock.calls.map((call) => ((call as unknown[])[0] as { embeds: unknown[] }).embeds.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(10);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(51); // 50 queued + 1 summary
    expect(JSON.stringify(channel.send.mock.calls.at(-1))).toContain('10');
  });
});

describe('[18] guard setup diagnostics', () => {
  it('warns about missing permissions and roles above the bot', async () => {
    const guild = new FakeGuild({ botPermissions: PermissionFlagsBits.ManageChannels });
    guild.addRole({ name: 'Kurucu', position: 80, permissions: PermissionFlagsBits.Administrator });
    const h = await createGuardHarness({ guild });
    const warnings = h.guard.diagnose(h.discordGuild);
    expect(warnings.join('\n')).toContain('Denetim Kaydını Görüntüle');
    expect(warnings.join('\n')).toContain('Rolleri Yönet');
    expect(warnings.join('\n')).toContain('yetkili rol var');
  });

  it('setup enables Guard, keeps the mode and creates all log channels', async () => {
    const h = await createGuardHarness({ mode: 'MONITOR', enabled: false });
    const result = await h.guard.setup(h.discordGuild, h.guild.ownerId);
    expect(result.logs.failed).toHaveLength(0);
    const settings = await h.config.get(h.guild.id);
    expect(settings).toMatchObject({ enabled: true, mode: 'MONITOR' });
    expect(h.repos.guard.modules).toHaveLength(10);
    expect(GuardService).toBeDefined();
    expect(auditSource(h.discordGuild).canViewAuditLog()).toBe(true);
  });
});
