import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';
import { buildCommandMap } from '../commands';
import { buildComponentMap } from '../components';
import type { Env } from '../config/env';
import { checkDatabase, createPrismaClient } from '../database/client';
import { createPrismaRepositories } from '../database/repositories/prismaRepositories';
import { AuditLogCorrelator } from '../modules/guard/attribution/AuditLogCorrelator';
import { IncidentManager } from '../modules/guard/enforcement/IncidentManager';
import { GuardConfigService } from '../modules/guard/GuardConfigService';
import { GuardReporter } from '../modules/guard/GuardReporter';
import { GuardService } from '../modules/guard/GuardService';
import { SecurityEventProcessor } from '../modules/guard/SecurityEventProcessor';
import { TrustService } from '../modules/guard/TrustService';
import { ActivityLogger } from '../modules/logging/ActivityLogger';
import { AuditLogFeed } from '../modules/logging/AuditLogFeed';
import { LogChannelService } from '../modules/logging/LogChannelService';
import { LogDispatcher } from '../modules/logging/LogDispatcher';
import { ModerationService } from '../modules/moderation/ModerationService';
import { RoomManager } from '../modules/tempVoice/RoomManager';
import { TempVoiceService } from '../modules/tempVoice/TempVoiceService';
import { CooldownService } from '../services/CooldownService';
import { HealthService } from '../services/HealthService';
import { SelfActionRegistry } from '../services/SelfActionRegistry';
import type { Logger } from '../utils/logger';
import type { App } from './App';

export function gatewayIntents(env: Pick<Env, 'ENABLE_GUILD_MEMBERS_INTENT' | 'ENABLE_MESSAGE_LOGS'>): GatewayIntentBits[] {
  const intents = [
    GatewayIntentBits.Guilds, // channels, roles, guild updates
    GatewayIntentBits.GuildVoiceStates, // join-to-create rooms
    GatewayIntentBits.GuildModeration, // audit log entries + bans
  ];
  // Privileged: only requested when explicitly enabled.
  if (env.ENABLE_GUILD_MEMBERS_INTENT) intents.push(GatewayIntentBits.GuildMembers);
  // Message logs need to read message content; MessageContent is privileged.
  if (env.ENABLE_MESSAGE_LOGS) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  return intents;
}

/** Wires every service together. Nothing connects to Discord until `client.login`. */
export function createApp(env: Env, logger: Logger): App {
  const client = new Client({
    intents: gatewayIntents(env),
    partials: [Partials.GuildMember, Partials.User],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      // Message logs need recent messages cached to show deleted/edited content.
      MessageManager: env.ENABLE_MESSAGE_LOGS ? 200 : 0,
      ReactionManager: 0,
      PresenceManager: 0,
      GuildStickerManager: 0,
      GuildEmojiManager: 0,
    }),
    allowedMentions: { parse: [], repliedUser: false },
  });

  const prisma = createPrismaClient(logger);
  const repos = createPrismaRepositories(prisma);
  const selfActions = new SelfActionRegistry();
  const cooldowns = new CooldownService();
  const health = new HealthService(client, () => checkDatabase(prisma), logger);

  const logChannels = new LogChannelService(repos.logChannels, repos.guard, selfActions, logger.child({ module: 'logs' }));
  const logDispatcher = new LogDispatcher(client, logChannels, logger.child({ module: 'dispatcher' }), env.LOG_FLUSH_INTERVAL_MS);
  logChannels.attachDispatcher(logDispatcher);
  const auditFeed = new AuditLogFeed(logDispatcher, logChannels, logger.child({ module: 'auditFeed' }));
  const activity = new ActivityLogger(logDispatcher, logChannels, logger.child({ module: 'activity' }));

  const tempVoice = new TempVoiceService(repos.tempVoice, selfActions, logger.child({ module: 'tempVoice' }), {
    creationConcurrency: env.ROOM_CREATION_CONCURRENCY,
  });
  const rooms = new RoomManager(tempVoice, repos.tempVoice, logger.child({ module: 'rooms' }));
  const voiceLog = (guildId: string, embed: Parameters<LogDispatcher['enqueue']>[2]) => logDispatcher.enqueue(guildId, 'VOICE', embed);
  tempVoice.setLogSink(voiceLog);
  rooms.setLogSink(voiceLog);

  const guardLogger = logger.child({ module: 'guard' });
  const guardConfig = new GuardConfigService(repos.guard);
  const trust = new TrustService(repos.guard);
  const correlator = new AuditLogCorrelator({ windowMs: env.AUDIT_CORRELATION_WINDOW_MS, fetchLimit: env.AUDIT_FETCH_LIMIT }, guardLogger);
  const incidents = new IncidentManager(repos.guard, guardLogger);
  const reporter = new GuardReporter(logDispatcher, repos.guard, guardLogger);
  const processor = new SecurityEventProcessor({ config: guardConfig, trust, repo: repos.guard, incidents, reporter, logger: guardLogger, health });
  const moderation = new ModerationService(processor, logger.child({ module: 'moderation' }));
  moderation.setLogSink((guildId, embed) => logDispatcher.enqueue(guildId, 'MEMBER', embed));
  const guard = new GuardService(processor, correlator, guardConfig, repos.guard, logChannels, selfActions, guardLogger);
  guard.setFetchedEntryListener((guild, entry) => auditFeed.handle(guild, entry));

  return {
    client,
    env,
    logger,
    prisma,
    repos,
    selfActions,
    cooldowns,
    health,
    logChannels,
    logDispatcher,
    auditFeed,
    activity,
    tempVoice,
    rooms,
    guard,
    guardConfig,
    trust,
    correlator,
    incidents,
    processor,
    reporter,
    moderation,
    commands: buildCommandMap(),
    components: buildComponentMap(),
  };
}
