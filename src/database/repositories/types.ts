import type {
  CommandAuditLog,
  GuardConfig,
  GuardManager,
  GuardModuleConfig,
  LogChannelConfig,
  RoomAllowedMember,
  RoomMemberRestriction,
  SecurityEvent,
  SecurityIncident,
  SecurityIncidentRoleSnapshot,
  TempVoiceConfig,
  TempVoiceRoom,
  TrustedExecutor,
} from '@prisma/client';

export type {
  CommandAuditLog,
  GuardConfig,
  GuardManager,
  GuardModuleConfig,
  LogChannelConfig,
  RoomAllowedMember,
  RoomMemberRestriction,
  SecurityEvent,
  SecurityIncident,
  SecurityIncidentRoleSnapshot,
  TempVoiceConfig,
  TempVoiceRoom,
  TrustedExecutor,
};

export interface TempVoiceConfigInput {
  categoryId: string;
  creatorChannelId: string;
  emptyDeleteDelaySec: number;
  ownerGraceSec: number;
  maxRoomsPerMember: number;
  defaultUserLimit: number;
}

export interface CreateRoomInput {
  guildId: string;
  channelId: string;
  ownerId: string;
  name: string;
  userLimit: number;
}

export type RoomUpdate = Partial<Pick<TempVoiceRoom, 'name' | 'locked' | 'hidden' | 'userLimit' | 'ownerLeftAt'>>;

export interface TempVoiceRepository {
  getConfig(guildId: string): Promise<TempVoiceConfig | null>;
  listConfigs(): Promise<TempVoiceConfig[]>;
  upsertConfig(guildId: string, input: TempVoiceConfigInput): Promise<TempVoiceConfig>;
  setConfigEnabled(guildId: string, enabled: boolean): Promise<void>;
  setPanel(guildId: string, panelChannelId: string | null, panelMessageId: string | null): Promise<void>;

  findRoomByChannel(channelId: string): Promise<TempVoiceRoom | null>;
  findRoomsByOwner(guildId: string, ownerId: string): Promise<TempVoiceRoom[]>;
  listRooms(guildId: string): Promise<TempVoiceRoom[]>;
  /**
   * Inserts the room only when the owner has fewer than `maxRooms` rooms in the
   * guild. Runs atomically; returns null when the limit was already reached.
   */
  createRoomIfUnderLimit(input: CreateRoomInput, maxRooms: number): Promise<TempVoiceRoom | null>;
  updateRoom(channelId: string, data: RoomUpdate): Promise<TempVoiceRoom | null>;
  deleteRoom(channelId: string): Promise<boolean>;
  /** Compare-and-swap ownership change. Returns false when the current owner no longer matches. */
  transferOwnership(channelId: string, fromOwnerId: string, toOwnerId: string): Promise<boolean>;

  listRestrictions(roomId: string): Promise<RoomMemberRestriction[]>;
  addRestriction(roomId: string, userId: string, createdById: string): Promise<boolean>;
  removeRestriction(roomId: string, userId: string): Promise<boolean>;
  listAllowed(roomId: string): Promise<RoomAllowedMember[]>;
  addAllowed(roomId: string, userId: string, createdById: string): Promise<boolean>;
  removeAllowed(roomId: string, userId: string): Promise<boolean>;
}

export interface GuardConfigUpdate {
  enabled?: boolean;
  mode?: string;
  activatedById?: string | null;
  activatedAt?: Date | null;
  incidentCooldownSec?: number;
  logRetentionDays?: number;
  notifyOwner?: boolean;
  notifyRoleIds?: string;
}

export interface ModuleConfigUpdate {
  enabled?: boolean;
  warnThreshold?: number;
  threshold?: number;
  windowSec?: number;
  severity?: string;
  autoStrip?: boolean;
}

export interface ModuleConfigCreate {
  enabled: boolean;
  warnThreshold: number;
  threshold: number;
  windowSec: number;
  severity: string;
  autoStrip: boolean;
}

export interface SecurityEventCreate {
  guildId: string;
  module: string;
  eventType: string;
  auditEntryId: string | null;
  executorId: string | null;
  executorVerified: boolean;
  targetId: string | null;
  targetType: string | null;
  targetName: string | null;
  details: string;
  severity: string;
  actionTaken: string;
  actionSucceeded: boolean | null;
  occurredAt: Date;
}

export interface IncidentCreate {
  guildId: string;
  executorId: string;
  module: string;
  severity: string;
  mode: string;
  dedupeKey: string;
  eventCount: number;
  windowSec: number;
  actionTaken: string;
  actionSucceeded: boolean;
  failureReason: string | null;
}

export interface RoleSnapshotCreate {
  roleId: string;
  roleName: string;
  position: number;
  privileged: boolean;
}

export type IncidentWithRoles = SecurityIncident & { roles: SecurityIncidentRoleSnapshot[] };

export interface GuardRepository {
  getConfig(guildId: string): Promise<GuardConfig | null>;
  upsertConfig(guildId: string, update: GuardConfigUpdate): Promise<GuardConfig>;
  listModules(guildId: string): Promise<GuardModuleConfig[]>;
  upsertModule(guildId: string, module: string, create: ModuleConfigCreate, update: ModuleConfigUpdate): Promise<GuardModuleConfig>;

  listTrusted(guildId: string): Promise<TrustedExecutor[]>;
  addTrusted(guildId: string, targetId: string, type: string, addedById: string, note: string | null): Promise<boolean>;
  removeTrusted(guildId: string, targetId: string): Promise<number>;

  listManagers(guildId: string): Promise<GuardManager[]>;
  addManager(guildId: string, userId: string, addedById: string): Promise<boolean>;
  removeManager(guildId: string, userId: string): Promise<boolean>;

  /** Returns null when an event with the same (guildId, auditEntryId) already exists. */
  recordEvent(data: SecurityEventCreate): Promise<SecurityEvent | null>;
  updateEvent(id: string, data: { actionTaken?: string; actionSucceeded?: boolean | null; incidentId?: string | null }): Promise<void>;
  listEvents(guildId: string, limit: number): Promise<SecurityEvent[]>;

  /** Creates an incident together with its role snapshot. Returns null on a dedupe key collision. */
  createIncident(data: IncidentCreate, roles: RoleSnapshotCreate[]): Promise<IncidentWithRoles | null>;
  findRecentIncident(guildId: string, executorId: string, since: Date): Promise<SecurityIncident | null>;
  updateIncident(id: string, data: Partial<Pick<SecurityIncident, 'actionTaken' | 'actionSucceeded' | 'failureReason' | 'eventCount' | 'restoredAt' | 'restoredById'>>): Promise<void>;
  updateSnapshot(incidentId: string, roleId: string, data: Partial<Pick<SecurityIncidentRoleSnapshot, 'removed' | 'failureReason' | 'restored' | 'restoredAt'>>): Promise<void>;
  findRestorableIncident(guildId: string, executorId: string): Promise<IncidentWithRoles | null>;
  getIncident(id: string): Promise<IncidentWithRoles | null>;
  listIncidents(guildId: string, limit: number, executorId?: string): Promise<SecurityIncident[]>;

  purgeBefore(guildId: string, before: Date): Promise<number>;
}

export interface LogChannelRepository {
  list(guildId: string): Promise<LogChannelConfig[]>;
  findByChannel(channelId: string): Promise<LogChannelConfig | null>;
  upsert(guildId: string, kind: string, channelId: string): Promise<LogChannelConfig>;
  updateRecovery(id: string, recoveryCount: number, recoveryWindowStart: Date | null): Promise<void>;
}

export interface GuildRepository {
  ensure(guildId: string): Promise<void>;
  markLeft(guildId: string): Promise<void>;
}

export interface CommandAuditRepository {
  record(entry: { guildId: string; userId: string; command: string; options: string; success: boolean; error: string | null }): Promise<void>;
}

export interface Repositories {
  guilds: GuildRepository;
  tempVoice: TempVoiceRepository;
  guard: GuardRepository;
  logChannels: LogChannelRepository;
  commandAudit: CommandAuditRepository;
}
