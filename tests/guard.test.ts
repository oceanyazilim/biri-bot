import { AuditLogEvent, PermissionFlagsBits, type NonThreadGuildBasedChannel, type GuildMember } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { previewRestore, restoreRoles } from '../src/modules/guard/recovery/RoleRestorer';
import { BOT_ID, FakeGuild, asDiscord } from './fakes/discord';
import { createGuardHarness } from './fakes/guardHarness';

describe('[12] mass channel deletion', () => {
  it('escalates 3 → HIGH and strips manageable roles at 5 deletions', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(3);
    expect(h.repos.guard.incidents).toHaveLength(0);
    expect(h.repos.guard.events.at(-1)?.severity).toBe('HIGH');
    expect(h.has(h.attacker, h.adminRole)).toBe(true);

    await h.deleteChannels(2);
    const incident = h.repos.guard.incidents[0]!;
    expect(incident).toMatchObject({ module: 'CHANNEL_DELETE', severity: 'CRITICAL', actionTaken: 'ROLES_STRIPPED', actionSucceeded: true, eventCount: 5 });
    expect(h.roleIds(h.attacker)).toEqual([]);

    const report = h.incidentEmbeds()[0]!;
    expect(report).toContain('Toplu Kanal Silme');
    expect(report).toContain('Yönetilebilir Roller Alındı');
    expect(report).toContain('Koruma Başarılı');
  });

  it('[14] stores the role snapshot before removal and records each result', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(5);
    const incident = h.repos.guard.incidents[0]!;
    const snapshot = h.repos.guard.snapshots.filter((s) => s.incidentId === incident.id);
    expect(snapshot.map((s) => s.roleId).sort()).toEqual([h.adminRole.id, h.memberRole.id].sort());
    expect(snapshot.every((s) => s.removed)).toBe(true);
    expect(snapshot.find((s) => s.roleId === h.adminRole.id)?.privileged).toBe(true);
    // Removal happened in a single request.
    expect(h.attacker.roles.set).toHaveBeenCalledTimes(1);
  });

  it('does not punish twice for the same burst', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(9);
    expect(h.repos.guard.incidents).toHaveLength(1);
    expect(h.attacker.roles.set).toHaveBeenCalledTimes(1);
    expect(h.dispatcher.sendNow).toHaveBeenCalledTimes(1);
    expect(h.repos.guard.incidents[0]!.eventCount).toBe(9);
  });
});

describe('[13] mass role deletion', () => {
  it('strips roles after 3 role deletions', async () => {
    const h = await createGuardHarness();
    for (let i = 0; i < 3; i++) await h.deliver({ action: AuditLogEvent.RoleDelete, changes: [{ key: 'name', old: `rol-${i}` }] });
    expect(h.repos.guard.incidents[0]).toMatchObject({ module: 'ROLE_DELETE', actionTaken: 'ROLES_STRIPPED' });
    expect(h.roleIds(h.attacker)).toEqual([]);
  });
});

describe('[7] detection thresholds', () => {
  it('does not trigger below the critical threshold', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(4);
    expect(h.repos.guard.incidents).toHaveLength(0);
    expect(h.has(h.attacker, h.adminRole)).toBe(true);
  });

  it('does not trigger when deletions are spread beyond the window', async () => {
    const h = await createGuardHarness();
    const base = Date.now();
    for (let i = 0; i < 6; i++) {
      // 6 deletions, 4 seconds apart: never 5 inside a 10 s window.
      await h.deliver({ action: AuditLogEvent.ChannelDelete, createdTimestamp: base + i * 4_000 });
    }
    expect(h.repos.guard.incidents).toHaveLength(0);
  });

  it('honours custom thresholds', async () => {
    const h = await createGuardHarness();
    await h.config.updateModule(h.guild.id, 'CHANNEL_DELETE', { threshold: 2, warnThreshold: 0 });
    await h.deleteChannels(2);
    expect(h.repos.guard.incidents).toHaveLength(1);
  });

  it('counts kicks and weights prunes', async () => {
    const h = await createGuardHarness();
    await h.deliver({ action: AuditLogEvent.MemberPrune, extra: { removed: 4, days: 7 } });
    expect(h.repos.guard.incidents[0]).toMatchObject({ module: 'MEMBER_KICK', actionTaken: 'ROLES_STRIPPED' });
  });

  it('strips after 3 bans and 4 kicks', async () => {
    const bans = await createGuardHarness();
    for (let i = 0; i < 3; i++) await bans.deliver({ action: AuditLogEvent.MemberBanAdd });
    expect(bans.repos.guard.incidents[0]?.module).toBe('MEMBER_BAN');

    const kicks = await createGuardHarness();
    for (let i = 0; i < 3; i++) await kicks.deliver({ action: AuditLogEvent.MemberKick });
    expect(kicks.repos.guard.incidents).toHaveLength(0);
    await kicks.deliver({ action: AuditLogEvent.MemberKick });
    expect(kicks.repos.guard.incidents[0]?.module).toBe('MEMBER_KICK');
  });
});

describe('[8] trusted executors and the owner', () => {
  it('never sanctions trusted users but still records and alerts', async () => {
    const h = await createGuardHarness();
    await h.trust.add(h.guild.id, h.attacker.id, 'USER', h.guild.ownerId, null);
    await h.deleteChannels(6);
    expect(h.repos.guard.incidents).toHaveLength(0);
    expect(h.has(h.attacker, h.adminRole)).toBe(true);
    expect(h.repos.guard.events).toHaveLength(6);
    expect(JSON.parse(h.repos.guard.events.at(-1)!.details).exemption).toBe('TRUSTED_USER');
    expect(h.dispatcher.enqueue.mock.calls.some((call) => call[1] === 'GUARD')).toBe(true);
  });

  it('exempts members holding a trusted role', async () => {
    const h = await createGuardHarness();
    await h.trust.add(h.guild.id, h.memberRole.id, 'ROLE', h.guild.ownerId, null);
    await h.deleteChannels(5);
    expect(h.repos.guard.incidents).toHaveLength(0);
  });

  it('never punishes the server owner', async () => {
    const h = await createGuardHarness();
    const owner = h.guild.members.cache.get(h.guild.ownerId)!;
    owner.roles.give(h.memberRole);
    await h.deleteChannels(8, owner);
    expect(h.repos.guard.incidents).toHaveLength(0);
    expect(owner.roles.set).not.toHaveBeenCalled();
    expect(JSON.parse(h.repos.guard.events.at(-1)!.details).exemption).toBe('OWNER');
  });

  it('flags granting a trusted role as escalation', async () => {
    const h = await createGuardHarness();
    const trustedRole = h.guild.addRole({ name: 'Güvenilir', position: 8 });
    await h.trust.add(h.guild.id, trustedRole.id, 'ROLE', h.guild.ownerId, null);
    await h.deliver({ action: AuditLogEvent.MemberRoleUpdate, changes: [{ key: '$add', new: [{ id: trustedRole.id, name: 'Güvenilir' }] }] });
    expect(h.repos.guard.events.at(-1)).toMatchObject({ module: 'PERMISSION_ESCALATION', eventType: 'TRUSTED_ROLE_GRANTED' });
  });
});

describe('[9] ambiguous or missing attribution', () => {
  it('records an unverified event and never sanctions when executors conflict', async () => {
    const h = await createGuardHarness();
    const other = h.guild.addMember({ name: 'Diğer' });
    const channel = h.guild.addTextChannel('genel');
    h.guild.audit({ action: AuditLogEvent.ChannelDelete, executorId: h.attacker.id, targetId: channel.id });
    h.guild.audit({ action: AuditLogEvent.ChannelDelete, executorId: other.id, targetId: channel.id });
    await h.guard.onChannelDelete(asDiscord<NonThreadGuildBasedChannel>(channel));

    const event = h.repos.guard.events.at(-1)!;
    expect(event).toMatchObject({ executorId: null, executorVerified: false });
    expect(JSON.parse(event.details).attributionFailure).toBe('AMBIGUOUS');
    expect(h.repos.guard.incidents).toHaveLength(0);
    expect(h.attacker.roles.set).not.toHaveBeenCalled();
  });

  it('records unverified events when no audit entry exists', async () => {
    const h = await createGuardHarness();
    for (let i = 0; i < 6; i++) await h.guard.onChannelDelete(asDiscord<NonThreadGuildBasedChannel>(h.guild.addTextChannel(`k${i}`)));
    expect(h.repos.guard.events).toHaveLength(6);
    expect(h.repos.guard.events.every((e) => !e.executorVerified)).toBe(true);
    expect(h.repos.guard.incidents).toHaveLength(0);
  });

  it('uses the fallback fetch when the gateway entry never arrives', async () => {
    const h = await createGuardHarness();
    const channels = Array.from({ length: 5 }, (_, i) => h.guild.addTextChannel(`k${i}`));
    for (const channel of channels) h.guild.audit({ action: AuditLogEvent.ChannelDelete, executorId: h.attacker.id, targetId: channel.id });
    for (const channel of channels) await h.guard.onChannelDelete(asDiscord<NonThreadGuildBasedChannel>(channel));
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('ROLES_STRIPPED');
  });
});

describe('[10] false-positive prevention', () => {
  it('MONITOR mode only records', async () => {
    const h = await createGuardHarness({ mode: 'MONITOR' });
    await h.deleteChannels(6);
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('LOGGED');
    expect(h.attacker.roles.set).not.toHaveBeenCalled();
    expect((h.dispatcher.sendNow.mock.calls[0] as unknown[] | undefined)?.[3]).toMatchObject({ content: undefined });
  });

  it('ALERT mode notifies without sanctions', async () => {
    const h = await createGuardHarness({ mode: 'ALERT' });
    await h.deleteChannels(6);
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('ALERTED');
    expect(h.attacker.roles.set).not.toHaveBeenCalled();
    expect(h.dispatcher.sendNow).toHaveBeenCalledTimes(1);
  });

  it('respects a module with auto-strip disabled', async () => {
    const h = await createGuardHarness();
    await h.config.updateModule(h.guild.id, 'CHANNEL_DELETE', { autoStrip: false });
    await h.deleteChannels(6);
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('ALERTED');
    expect(h.attacker.roles.set).not.toHaveBeenCalled();
  });

  it('ignores disabled modules and a disabled Guard', async () => {
    const h = await createGuardHarness();
    await h.config.updateModule(h.guild.id, 'CHANNEL_DELETE', { enabled: false });
    await h.deleteChannels(6);
    expect(h.repos.guard.events).toHaveLength(0);

    const off = await createGuardHarness({ enabled: false });
    await off.deleteChannels(6);
    expect(off.repos.guard.events).toHaveLength(0);
  });

  it('a voluntary leave is never counted as a kick', async () => {
    const h = await createGuardHarness();
    const leaver = h.guild.addMember({ name: 'Ayrılan' });
    for (let i = 0; i < 5; i++) await h.guard.onMemberRemove(asDiscord<GuildMember>(leaver));
    expect(h.repos.guard.events).toHaveLength(0);
  });

  it('a single legitimate settings change is logged, not punished', async () => {
    const h = await createGuardHarness();
    await h.deliver({ action: AuditLogEvent.GuildUpdate, targetId: h.guild.id, changes: [{ key: 'name', old: 'Eski', new: 'Yeni' }] });
    expect(h.repos.guard.events.at(-1)).toMatchObject({ module: 'GUILD_UPDATE', severity: 'MEDIUM', actionTaken: 'LOGGED' });
    expect(h.repos.guard.incidents).toHaveLength(0);
  });

  it('dangerous permission grants alert but need an explicit policy to sanction', async () => {
    const h = await createGuardHarness();
    const target = h.guild.addRole({ name: 'Rol', position: 3 });
    const grant = { action: AuditLogEvent.RoleUpdate, targetId: target.id, changes: [{ key: 'permissions', old: '0', new: PermissionFlagsBits.Administrator.toString() }] };
    await h.deliver(grant);
    expect(h.repos.guard.events.at(-1)).toMatchObject({ module: 'PERMISSION_ESCALATION', eventType: 'ROLE_PERMISSIONS_ESCALATED', severity: 'CRITICAL' });
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('ALERTED');
    expect(h.attacker.roles.set).not.toHaveBeenCalled();

    const strict = await createGuardHarness();
    await strict.config.updateModule(strict.guild.id, 'PERMISSION_ESCALATION', { autoStrip: true });
    await strict.deliver({ ...grant, targetId: strict.guild.addRole({ name: 'Rol', position: 3 }).id });
    expect(strict.repos.guard.incidents[0]?.actionTaken).toBe('ROLES_STRIPPED');
  });

  it('flags dangerous @everyone permissions as critical', async () => {
    const h = await createGuardHarness({ mode: 'ALERT' });
    await h.deliver({ action: AuditLogEvent.RoleUpdate, targetId: h.guild.id, changes: [{ key: 'permissions', old: '0', new: PermissionFlagsBits.BanMembers.toString() }] });
    expect(h.repos.guard.events.at(-1)).toMatchObject({ eventType: 'EVERYONE_PERMISSIONS_ESCALATED', severity: 'CRITICAL' });
  });

  it('non-dangerous role edits are not security events', async () => {
    const h = await createGuardHarness();
    await h.deliver({ action: AuditLogEvent.RoleUpdate, changes: [{ key: 'permissions', old: '0', new: PermissionFlagsBits.SendMessages.toString() }] });
    expect(h.repos.guard.events).toHaveLength(0);
  });

  it('distinguishes unknown and trusted bot additions', async () => {
    const h = await createGuardHarness();
    const trustedBot = '777777777777777777';
    await h.trust.add(h.guild.id, trustedBot, 'BOT', h.guild.ownerId, null);
    await h.deliver({ action: AuditLogEvent.BotAdd, targetId: trustedBot });
    await h.deliver({ action: AuditLogEvent.BotAdd, targetId: '888888888888888888' });
    const [trusted, unknown] = h.repos.guard.events.slice(-2);
    expect(trusted).toMatchObject({ eventType: 'TRUSTED_BOT_ADDED', severity: 'LOW' });
    expect(unknown).toMatchObject({ eventType: 'UNKNOWN_BOT_ADDED', severity: 'HIGH' });
  });
});

describe('[11] Biri’s own operations', () => {
  it('ignores audit entries executed by Biri', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(10, BOT_ID);
    expect(h.repos.guard.events).toHaveLength(0);
  });

  it('skips correlation entirely for registered self actions', async () => {
    const h = await createGuardHarness();
    const room = h.guild.addVoiceChannel('🔊・Oda');
    h.selfActions.register(h.guild.id, 'CHANNEL_DELETE', room.id);
    await h.guard.onChannelDelete(asDiscord<NonThreadGuildBasedChannel>(room));
    expect(h.guild.fetchAuditLogs).not.toHaveBeenCalled();
    expect(h.repos.guard.events).toHaveLength(0);
  });
});

describe('[15] partial failures caused by role hierarchy', () => {
  it('removes what it can, keeps the rest and reports honestly', async () => {
    const h = await createGuardHarness();
    const aboveBot = h.guild.addRole({ name: 'Üst Yönetim', position: 60, permissions: PermissionFlagsBits.Administrator });
    const booster = h.guild.addRole({ name: 'Booster', position: 2, managed: true });
    h.attacker.roles.give(aboveBot, booster);

    await h.deleteChannels(5);
    const incident = h.repos.guard.incidents[0]!;
    expect(incident).toMatchObject({ actionTaken: 'PARTIAL', actionSucceeded: false });
    expect(h.roleIds(h.attacker).sort()).toEqual([aboveBot.id, booster.id].sort());
    const snapshots = h.repos.guard.snapshots.filter((s) => s.incidentId === incident.id);
    expect(snapshots.find((s) => s.roleId === aboveBot.id)).toMatchObject({ removed: false });
    expect(snapshots.find((s) => s.roleId === aboveBot.id)?.failureReason).toContain('botun en yüksek rolü');
    expect(snapshots.find((s) => s.roleId === booster.id)?.failureReason).toContain('Entegrasyon');

    const report = h.incidentEmbeds()[0]!;
    expect(report).toContain('Kısmen Başarılı');
    expect(report).not.toContain('Koruma Başarılı');
    expect(report).toContain('Alınamayan Roller');
  });

  it('falls back to per-role removal when the bulk request fails', async () => {
    const h = await createGuardHarness();
    h.attacker.roles.set.mockRejectedValueOnce(new Error('bulk failed'));
    await h.deleteChannels(5);
    expect(h.attacker.roles.remove).toHaveBeenCalledTimes(2);
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('ROLES_STRIPPED');
  });

  it('escalates when every role is above the bot', async () => {
    const h = await createGuardHarness();
    const top = h.guild.addRole({ name: 'Zirve', position: 70, permissions: PermissionFlagsBits.Administrator });
    const victim = h.guild.addMember({ name: 'Güçlü', roles: [top] });
    await h.deleteChannels(5, victim);
    expect(h.repos.guard.incidents[0]).toMatchObject({ actionTaken: 'ESCALATED', actionSucceeded: false });
    expect(victim.roles.cache.has(top.id)).toBe(true);
  });

  it('[18] escalates when Biri lacks Manage Roles', async () => {
    const guild = new FakeGuild({ botPermissions: PermissionFlagsBits.ViewAuditLog | PermissionFlagsBits.ViewChannel });
    const h = await createGuardHarness({ guild });
    await h.deleteChannels(5);
    expect(h.repos.guard.incidents[0]).toMatchObject({ actionTaken: 'ESCALATED' });
    expect(h.repos.guard.incidents[0]?.failureReason).toContain('Rolleri Yönet');
    expect(h.has(h.attacker, h.adminRole)).toBe(true);
  });

  it('escalates when the executor already left the server', async () => {
    const h = await createGuardHarness();
    h.guild.members.cache.delete(h.attacker.id);
    await h.deleteChannels(5);
    expect(h.repos.guard.incidents[0]?.actionTaken).toBe('ESCALATED');
  });
});

describe('[19] duplicate audit events', () => {
  it('processes a redelivered entry only once', async () => {
    const h = await createGuardHarness();
    const entry = await h.deliver({ action: AuditLogEvent.ChannelDelete });
    await h.guard.onAuditLogEntry(h.discordGuild, entry as never);
    await h.guard.onAuditLogEntry(h.discordGuild, entry as never);
    expect(h.repos.guard.events).toHaveLength(1);
  });

  it('deduplicates at the database level across restarts', async () => {
    const h = await createGuardHarness();
    const entry = await h.deliver({ action: AuditLogEvent.ChannelDelete });
    const restarted = await createGuardHarness({ repos: h.repos, guild: h.guild });
    const results = await restarted.processor.processAuditEntry(h.discordGuild, entry as never, 'FETCHED_AUDIT');
    expect(results[0]?.recorded).toBe(false);
    expect(h.repos.guard.events).toHaveLength(1);
  });

  it('duplicates never inflate the threshold count', async () => {
    const h = await createGuardHarness();
    const entry = await h.deliver({ action: AuditLogEvent.ChannelDelete });
    for (let i = 0; i < 10; i++) await h.guard.onAuditLogEntry(h.discordGuild, entry as never);
    expect(h.repos.guard.incidents).toHaveLength(0);
  });
});

describe('[20] multiple guilds', () => {
  it('counts each guild separately', async () => {
    const a = await createGuardHarness();
    const b = await createGuardHarness({ repos: a.repos });
    await a.deleteChannels(3);
    await b.deleteChannels(3);
    expect(a.repos.guard.incidents).toHaveLength(0);
    // Config and trust of one guild do not leak into another.
    await a.trust.add(a.guild.id, b.attacker.id, 'USER', a.guild.ownerId, null);
    await b.deleteChannels(2);
    expect(a.repos.guard.incidents.map((i) => i.guildId)).toEqual([b.guild.id]);
  });
});

describe('resilience', () => {
  it('still protects the server during a database outage', async () => {
    const h = await createGuardHarness();
    await h.config.get(h.guild.id); // settings cached before the outage
    h.repos.guard.failWrites = true;
    await h.deleteChannels(5);
    expect(h.roleIds(h.attacker)).toEqual([]);
    expect(h.incidentEmbeds()[0]).toContain('Veritabanı Yedeği');
  });
});

describe('[16] restoring roles from snapshots', () => {
  it('restores safe roles first and privileged roles only with explicit confirmation', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(5);
    const incident = (await h.repos.guard.findRestorableIncident(h.guild.id, h.attacker.id))!;
    const member = h.attacker as unknown as GuildMember;

    const preview = previewRestore(h.discordGuild, member, incident);
    expect(preview.find((i) => i.roleId === h.memberRole.id)?.status).toBe('RESTORABLE');
    expect(preview.find((i) => i.roleId === h.adminRole.id)?.status).toBe('PRIVILEGED');

    const safe = await restoreRoles(member, preview, false, 'test');
    expect(safe.restored).toEqual([h.memberRole.id]);
    expect(h.has(h.attacker, h.adminRole)).toBe(false);

    const all = await restoreRoles(member, previewRestore(h.discordGuild, member, incident), true, 'test');
    expect(all.restored).toEqual([h.adminRole.id]);
    expect(h.has(h.attacker, h.adminRole)).toBe(true);
  });

  it('skips roles that were deleted or became unmanageable', async () => {
    const h = await createGuardHarness();
    await h.deleteChannels(5);
    const incident = (await h.repos.guard.findRestorableIncident(h.guild.id, h.attacker.id))!;
    h.guild.roles.cache.delete(h.memberRole.id);
    h.adminRole.position = 90;
    const preview = previewRestore(h.discordGuild, h.attacker as unknown as GuildMember, incident);
    expect(preview.find((i) => i.roleId === h.memberRole.id)?.status).toBe('MISSING');
    expect(preview.find((i) => i.roleId === h.adminRole.id)?.status).toBe('NOT_MANAGEABLE');
    const result = await restoreRoles(h.attacker as unknown as GuildMember, preview, true, 'test');
    expect(result.restored).toEqual([]);
  });
});
