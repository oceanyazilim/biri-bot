import { AuditLogEvent, Collection, OverwriteType, PermissionFlagsBits, type Guild, type GuildAuditLogsEntry, type GuildMember, type Message, type NonThreadGuildBasedChannel, type VoiceState } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ActivityLogger } from '../src/modules/logging/ActivityLogger';
import { AuditLogFeed } from '../src/modules/logging/AuditLogFeed';
import { formatAuditEntry, type FeedContext } from '../src/modules/logging/auditFormatter';
import { permissionNames } from '../src/modules/logging/permissionNames';
import type { AuditEntryLike } from '../src/modules/guard/detectors/types';
import { createSilentLogger } from '../src/utils/logger';
import { asDiscord, BOT_ID, FakeGuild } from './fakes/discord';
import { createGuardHarness } from './fakes/guardHarness';

const ctx: FeedContext = { guildId: '111111111111111111', channelName: () => 'genel', roleName: () => 'Moderatör' };

const entry = (action: AuditLogEvent, changes: AuditEntryLike['changes'] = [], extra?: Partial<AuditEntryLike> & { target?: unknown }) => ({
  id: '555555555555555555',
  action,
  executorId: '222222222222222222',
  targetId: '333333333333333333',
  createdTimestamp: Date.now(),
  changes,
  ...extra,
});

const render = (e: ReturnType<typeof entry>) => {
  const item = formatAuditEntry(e, ctx);
  return { kind: item?.kind, text: item ? JSON.stringify(item.embed.toJSON()) : '' };
};

describe('permission names', () => {
  it('uses Turkish names', () => {
    expect(permissionNames(PermissionFlagsBits.Administrator | PermissionFlagsBits.SendMessages)).toEqual(['Yönetici', 'Mesaj Gönder']);
  });
});

describe('audit formatter', () => {
  it('channel edits list each change with readable values', () => {
    const { kind, text } = render(
      entry(AuditLogEvent.ChannelUpdate, [
        { key: 'name', old: 'sohbet', new: 'genel-sohbet' },
        { key: 'rate_limit_per_user', old: 0, new: 10 },
      ]),
    );
    expect(kind).toBe('CHANNEL');
    expect(text).toContain('Kanal Düzenlendi');
    expect(text).toContain('<@222222222222222222>');
    expect(text).toContain('`sohbet` → `genel-sohbet`');
    expect(text).toContain('Yavaş mod:** Kapalı → 10 saniye');
  });

  it('role edits show added and removed permissions by name', () => {
    const { kind, text } = render(
      entry(AuditLogEvent.RoleUpdate, [
        { key: 'permissions', old: PermissionFlagsBits.SendMessages.toString(), new: PermissionFlagsBits.Administrator.toString() },
        { key: 'color', old: 0, new: 0xff0000 },
      ]),
    );
    expect(kind).toBe('ROLE');
    expect(text).toContain('Eklenen İzinler');
    expect(text).toContain('Yönetici');
    expect(text).toContain('Kaldırılan İzinler');
    expect(text).toContain('Mesaj Gönder');
    expect(text).toContain('#ff0000');
  });

  it('member role changes list given and taken roles', () => {
    const { kind, text } = render(
      entry(AuditLogEvent.MemberRoleUpdate, [
        { key: '$add', new: [{ id: '444444444444444444', name: 'VIP' }] },
        { key: '$remove', new: [{ id: '666666666666666666', name: 'Yeni' }] },
      ]),
    );
    expect(kind).toBe('ROLE');
    expect(text).toContain('Verilen Roller');
    expect(text).toContain('VIP');
    expect(text).toContain('Alınan Roller');
  });

  it('timeouts get a dedicated title and end time', () => {
    const until = new Date(Date.now() + 3600_000).toISOString();
    const applied = render(entry(AuditLogEvent.MemberUpdate, [{ key: 'communication_disabled_until', new: until }]));
    expect(applied.kind).toBe('MEMBER');
    expect(applied.text).toContain('Zaman Aşımı Uygulandı');
    const lifted = render(entry(AuditLogEvent.MemberUpdate, [{ key: 'communication_disabled_until', old: until }]));
    expect(lifted.text).toContain('Zaman Aşımı Kaldırıldı');
  });

  it('channel permission overwrites show allowed, denied and reset permissions', () => {
    const { text } = render(
      entry(
        AuditLogEvent.ChannelOverwriteUpdate,
        [
          { key: 'allow', old: '0', new: PermissionFlagsBits.SendMessages.toString() },
          { key: 'deny', old: PermissionFlagsBits.SendMessages.toString(), new: PermissionFlagsBits.AttachFiles.toString() },
        ],
        { extra: { id: ctx.guildId, type: OverwriteType.Role } },
      ),
    );
    expect(text).toContain('@everyone');
    expect(text).toContain('İzin Verildi');
    expect(text).toContain('Engellendi');
    expect(text).toContain('Dosya Ekle');
  });

  it('routes moderation, messages and server settings to the right channels', () => {
    expect(render(entry(AuditLogEvent.MemberBanRemove)).kind).toBe('MEMBER');
    expect(render(entry(AuditLogEvent.MessageBulkDelete, [], { extra: { count: 42 } })).text).toContain('42');
    expect(render(entry(AuditLogEvent.MessageBulkDelete)).kind).toBe('MESSAGE');
    expect(render(entry(AuditLogEvent.MemberMove, [], { extra: { channel: { id: '777777777777777777' }, count: 3 } })).kind).toBe('VOICE');
    expect(render(entry(AuditLogEvent.WebhookCreate)).kind).toBe('WEBHOOK');
    const guild = render(entry(AuditLogEvent.GuildUpdate, [{ key: 'name', old: 'Eski', new: 'Yeni' }]));
    expect(guild.kind).toBe('GENERAL');
    expect(guild.text).toContain('Sunucu adı');
    expect(render(entry(AuditLogEvent.InviteCreate, [{ key: 'code', new: 'abc123' }, { key: 'max_uses', new: 0 }])).text).toContain('discord.gg/abc123');
  });

  it('includes the audit reason and entry id', () => {
    const { text } = render(entry(AuditLogEvent.MemberKick, [], { reason: 'Spam' }));
    expect(text).toContain('Spam');
    expect(text).toContain('555555555555555555');
  });

  it('ignores actions it does not log', () => {
    expect(formatAuditEntry(entry(AuditLogEvent.AutoModerationBlockMessage), ctx)).toBeNull();
  });
});

describe('AuditLogFeed', () => {
  const feedFor = (configured = true) => {
    const sink = { enqueue: vi.fn() };
    const feed = new AuditLogFeed(sink, { isConfigured: async () => configured }, createSilentLogger());
    const guild = new FakeGuild();
    return { sink, feed, guild: asDiscord<Guild>(guild) };
  };

  it('logs actions of people, not Biri itself', async () => {
    const { sink, feed, guild } = feedFor();
    expect(await feed.handle(guild, entry(AuditLogEvent.ChannelCreate))).toBe(true);
    expect(sink.enqueue).toHaveBeenCalledWith(guild.id, 'CHANNEL', expect.anything());
    expect(await feed.handle(guild, { ...entry(AuditLogEvent.ChannelCreate), executorId: BOT_ID })).toBe(false);
  });

  it('does nothing before log channels are set up', async () => {
    const { sink, feed, guild } = feedFor(false);
    await feed.handle(guild, entry(AuditLogEvent.ChannelCreate));
    expect(sink.enqueue).not.toHaveBeenCalled();
  });
});

describe('Guard and the audit feed do not duplicate logs', () => {
  it('Guard only writes attributed events to the guard channel', async () => {
    const h = await createGuardHarness({ mode: 'ALERT' });
    await h.deleteChannels(2);
    expect(h.dispatcher.enqueue.mock.calls.some((call) => call[1] === 'CHANNEL')).toBe(false);
  });

  it('Guard still logs events that have no audit entry', async () => {
    const h = await createGuardHarness();
    await h.guard.onChannelDelete(asDiscord<NonThreadGuildBasedChannel>(h.guild.addTextChannel('kayıp')));
    expect(h.dispatcher.enqueue.mock.calls.some((call) => call[1] === 'CHANNEL')).toBe(true);
  });

  it('feeds audit entries that were only found through a fallback fetch', async () => {
    const h = await createGuardHarness();
    const listener = vi.fn(async () => true);
    h.guard.setFetchedEntryListener(listener);
    const channel = h.guild.addTextChannel('silinecek');
    h.guild.audit({ action: AuditLogEvent.ChannelDelete, executorId: h.attacker.id, targetId: channel.id });
    await h.guard.onChannelDelete(asDiscord<NonThreadGuildBasedChannel>(channel));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('the gateway path feeds entries once', async () => {
    const h = await createGuardHarness();
    const sink = { enqueue: vi.fn() };
    const feed = new AuditLogFeed(sink, { isConfigured: async () => true }, createSilentLogger());
    const e = h.guild.audit({ action: AuditLogEvent.ChannelDelete, executorId: h.attacker.id, targetId: '123456789012345678' });
    await feed.handle(h.discordGuild, e);
    await h.guard.onAuditLogEntry(h.discordGuild, asDiscord<GuildAuditLogsEntry>(e));
    expect(sink.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe('ActivityLogger', () => {
  const setup = () => {
    const sink = { enqueue: vi.fn() };
    const logger = new ActivityLogger(sink, { isConfigured: async () => true }, createSilentLogger());
    const guild = new FakeGuild();
    const member = guild.addMember({ name: 'Ali' });
    const state = (channelId: string | null) => asDiscord<VoiceState>({ channelId, member, guild });
    const text = () => sink.enqueue.mock.calls.map((call) => JSON.stringify((call[2] as { toJSON(): unknown }).toJSON())).join('\n');
    return { sink, logger, guild, member, state, text };
  };

  it('logs voice joins, leaves and moves', async () => {
    const h = setup();
    await h.logger.voice(h.state(null), h.state('100000000000000001'), null);
    await h.logger.voice(h.state('100000000000000001'), h.state('100000000000000002'), null);
    await h.logger.voice(h.state('100000000000000002'), h.state(null), null);
    expect(h.sink.enqueue).toHaveBeenCalledTimes(3);
    expect(h.sink.enqueue.mock.calls.every((call) => call[1] === 'VOICE')).toBe(true);
    expect(h.text()).toContain('Katıldı');
    expect(h.text()).toContain('Değiştirdi');
    expect(h.text()).toContain('Ayrıldı');
  });

  it('treats the creator channel as invisible', async () => {
    const h = setup();
    const creator = '100000000000000009';
    await h.logger.voice(h.state(null), h.state(creator), creator); // joined creator: nothing yet
    await h.logger.voice(h.state(creator), h.state('100000000000000003'), creator); // moved into own room
    expect(h.sink.enqueue).toHaveBeenCalledTimes(1);
    expect(h.text()).toContain('Ses Kanalına Katıldı');
  });

  it('ignores bots and mute/deafen-only updates', async () => {
    const h = setup();
    await h.logger.voice(h.state('100000000000000001'), h.state('100000000000000001'), null);
    const bot = h.guild.addMember({ name: 'Bot', bot: true });
    await h.logger.voice(asDiscord<VoiceState>({ channelId: null, member: bot, guild: h.guild }), asDiscord<VoiceState>({ channelId: '1', member: bot, guild: h.guild }), null);
    expect(h.sink.enqueue).not.toHaveBeenCalled();
  });

  it('flags new accounts when members join', async () => {
    const h = setup();
    const member = {
      id: h.member.id,
      guild: { id: h.guild.id, memberCount: 120 },
      user: { bot: false, tag: 'Ali#0', createdAt: new Date(Date.now() - 2 * 86_400_000), displayAvatarURL: () => 'https://cdn/x.png' },
    };
    await h.logger.memberJoin(asDiscord<GuildMember>(member));
    expect(h.sink.enqueue).toHaveBeenCalledWith(h.guild.id, 'MEMBER', expect.anything());
    expect(h.text()).toContain('Yeni hesap');
    expect(h.text()).toContain('120');
  });

  it('logs deleted messages with content and skips unchanged edits', async () => {
    const h = setup();
    const base = { id: '1', guildId: h.guild.id, channelId: '200000000000000000', webhookId: null, partial: false, createdAt: new Date(), attachments: new Collection(), url: 'https://discord.com/x', author: { id: h.member.id, bot: false, tag: 'Ali#0' } };
    await h.logger.messageDelete(asDiscord<Message>({ ...base, content: 'merhaba dünya' }));
    expect(h.sink.enqueue).toHaveBeenCalledWith(h.guild.id, 'MESSAGE', expect.anything());
    expect(h.text()).toContain('merhaba dünya');

    await h.logger.messageUpdate(asDiscord<Message>({ ...base, content: 'aynı' }), asDiscord<Message>({ ...base, content: 'aynı' }));
    expect(h.sink.enqueue).toHaveBeenCalledTimes(1);
    await h.logger.messageUpdate(asDiscord<Message>({ ...base, content: 'önce' }), asDiscord<Message>({ ...base, content: 'sonra' }));
    expect(h.text()).toContain('önce');
    expect(h.text()).toContain('sonra');

    await h.logger.messageDelete(asDiscord<Message>({ ...base, content: 'bot', author: { id: BOT_ID, bot: true, tag: 'Biri#0' } }));
    expect(h.sink.enqueue).toHaveBeenCalledTimes(2);
  });
});
