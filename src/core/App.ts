import type { PrismaClient } from '@prisma/client';
import type { Client } from 'discord.js';
import type { Env } from '../config/env';
import type { Repositories } from '../database/repositories/types';
import type { AuditLogCorrelator } from '../modules/guard/attribution/AuditLogCorrelator';
import type { IncidentManager } from '../modules/guard/enforcement/IncidentManager';
import type { GuardConfigService } from '../modules/guard/GuardConfigService';
import type { GuardReporter } from '../modules/guard/GuardReporter';
import type { GuardService } from '../modules/guard/GuardService';
import type { SecurityEventProcessor } from '../modules/guard/SecurityEventProcessor';
import type { TrustService } from '../modules/guard/TrustService';
import type { LogChannelService } from '../modules/logging/LogChannelService';
import type { LogDispatcher } from '../modules/logging/LogDispatcher';
import type { ModerationService } from '../modules/moderation/ModerationService';
import type { RoomManager } from '../modules/tempVoice/RoomManager';
import type { TempVoiceService } from '../modules/tempVoice/TempVoiceService';
import type { CooldownService } from '../services/CooldownService';
import type { HealthService } from '../services/HealthService';
import type { SelfActionRegistry } from '../services/SelfActionRegistry';
import type { ComponentHandler, SlashCommand } from '../types/command';
import type { Logger } from '../utils/logger';

/** Dependency container shared by commands, components and event handlers. */
export interface App {
  client: Client;
  env: Env;
  logger: Logger;
  prisma: PrismaClient;
  repos: Repositories;

  selfActions: SelfActionRegistry;
  cooldowns: CooldownService;
  health: HealthService;

  logChannels: LogChannelService;
  logDispatcher: LogDispatcher;

  tempVoice: TempVoiceService;
  rooms: RoomManager;

  guard: GuardService;
  guardConfig: GuardConfigService;
  trust: TrustService;
  correlator: AuditLogCorrelator;
  incidents: IncidentManager;
  processor: SecurityEventProcessor;
  reporter: GuardReporter;

  moderation: ModerationService;

  commands: Map<string, SlashCommand>;
  components: Map<string, ComponentHandler>;
}
