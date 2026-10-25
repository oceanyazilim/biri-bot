import { AuditLogEvent, PermissionFlagsBits, type Guild, type GuildAuditLogsEntry } from 'discord.js';
import { vi } from 'vitest';
import { AuditLogCorrelator } from '../../src/modules/guard/attribution/AuditLogCorrelator';
import { IncidentManager } from '../../src/modules/guard/enforcement/IncidentManager';
import { GuardConfigService } from '../../src/modules/guard/GuardConfigService';
import { GuardReporter } from '../../src/modules/guard/GuardReporter';
import { auditSource, GuardService } from '../../src/modules/guard/GuardService';
import { SecurityEventProcessor } from '../../src/modules/guard/SecurityEventProcessor';
import { TrustService } from '../../src/modules/guard/TrustService';
import { LogChannelService } from '../../src/modules/logging/LogChannelService';
import type { LogDispatcher } from '../../src/modules/logging/LogDispatcher';
import { SelfActionRegistry } from '../../src/services/SelfActionRegistry';
import type { ProtectionMode } from '../../src/types/guard';
import { createSilentLogger } from '../../src/utils/logger';
import { asDiscord, FakeGuild, type FakeAuditEntry, type FakeMember, type FakeRole } from './discord';
import { createMemoryRepositories } from './memoryRepositories';

export interface GuardHarnessOptions {
  mode?: ProtectionMode;
  enabled?: boolean;
  guild?: FakeGuild;
  repos?: ReturnType<typeof createMemoryRepositories>;
}

export async function createGuardHarness(options: GuardHarnessOptions = {}) {
  const repos = options.repos ?? createMemoryRepositories();
  const guild = options.guild ?? new FakeGuild();
  const logger = createSilentLogger();
  const dispatcher = { enqueue: vi.fn(), sendNow: vi.fn(async () => true) };
  const selfActions = new SelfActionRegistry();

  await repos.guard.upsertConfig(guild.id, { enabled: options.enabled ?? true, mode: options.mode ?? 'ACTIVE' });
  const config = new GuardConfigService(repos.guard);
  const trust = new TrustService(repos.guard);
  const incidents = new IncidentManager(repos.guard, logger);
  const reporter = new GuardReporter(asDiscord<LogDispatcher>(dispatcher), repos.guard, logger);
  const processor = new SecurityEventProcessor({ config, trust, repo: repos.guard, incidents, reporter, logger });
  const correlator = new AuditLogCorrelator({ windowMs: 20, fetchLimit: 25, retryDelayMs: 5 }, logger);
  const logChannels = new LogChannelService(repos.logChannels, repos.guard, selfActions, logger);
  const guard = new GuardService(processor, correlator, config, repos.guard, logChannels, selfActions, logger, (g) => auditSource(g));

  // A typical compromised moderator: one admin role and one ordinary role, both below Biri.
  const adminRole = guild.addRole({ name: 'Yönetim', position: 20, permissions: PermissionFlagsBits.Administrator });
  const memberRole = guild.addRole({ name: 'Üye', position: 5 });
  const attacker = guild.addMember({ name: 'Saldırgan', roles: [adminRole, memberRole] });

  let clock = Date.now();
  /** Creates an audit entry and delivers it through guildAuditLogEntryCreate. */
  const deliver = async (entry: Partial<FakeAuditEntry> & { action: AuditLogEvent }, executor: FakeMember | string | null = attacker) => {
    clock += 500;
    const full = guild.audit({
      executorId: typeof executor === 'string' || executor === null ? executor : executor.id,
      targetId: entry.targetId ?? `${BigInt(guild.id) + BigInt(clock)}`,
      createdTimestamp: clock,
      ...entry,
    });
    await guard.onAuditLogEntry(asDiscord<Guild>(guild), asDiscord<GuildAuditLogsEntry>(full));
    return full;
  };

  const deleteChannels = async (count: number, executor: FakeMember | string = attacker) => {
    for (let i = 0; i < count; i++) {
      await deliver({ action: AuditLogEvent.ChannelDelete, changes: [{ key: 'name', old: `kanal-${i}` }] }, executor);
    }
  };

  const incidentEmbeds = () =>
    dispatcher.sendNow.mock.calls.map((call) => JSON.stringify((call as unknown[])[2] && ((call as unknown[])[2] as Array<{ toJSON(): unknown }>)[0]!.toJSON()));

  const roleIds = (member: FakeMember) => [...member.roles.cache.keys()];
  const has = (member: FakeMember, role: FakeRole) => member.roles.cache.has(role.id);

  return {
    repos,
    guild,
    dispatcher,
    selfActions,
    config,
    trust,
    incidents,
    processor,
    correlator,
    guard,
    attacker,
    adminRole,
    memberRole,
    deliver,
    deleteChannels,
    incidentEmbeds,
    roleIds,
    has,
    discordGuild: asDiscord<Guild>(guild),
  };
}
