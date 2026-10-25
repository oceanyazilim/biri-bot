import type {
  CommandAuditRepository,
  CreateRoomInput,
  GuardConfig,
  GuardConfigUpdate,
  GuardManager,
  GuardModuleConfig,
  GuardRepository,
  GuildRepository,
  IncidentCreate,
  IncidentWithRoles,
  LogChannelConfig,
  LogChannelRepository,
  ModuleConfigCreate,
  ModuleConfigUpdate,
  Repositories,
  RoleSnapshotCreate,
  RoomAllowedMember,
  RoomMemberRestriction,
  RoomUpdate,
  SecurityEvent,
  SecurityEventCreate,
  SecurityIncident,
  SecurityIncidentRoleSnapshot,
  TempVoiceConfig,
  TempVoiceConfigInput,
  TempVoiceRepository,
  TempVoiceRoom,
  TrustedExecutor,
} from '../../src/database/repositories/types';

let sequence = 0;
const nextId = () => `id${++sequence}`;

/** In-memory TempVoiceRepository mirroring the Prisma implementation's semantics. */
export class MemoryTempVoiceRepository implements TempVoiceRepository {
  configs = new Map<string, TempVoiceConfig>();
  rooms = new Map<string, TempVoiceRoom>();
  restrictions: RoomMemberRestriction[] = [];
  allowed: RoomAllowedMember[] = [];

  async getConfig(guildId: string) {
    return this.configs.get(guildId) ?? null;
  }
  async listConfigs() {
    return [...this.configs.values()].filter((c) => c.enabled);
  }
  async upsertConfig(guildId: string, input: TempVoiceConfigInput) {
    const now = new Date();
    const existing = this.configs.get(guildId);
    const config: TempVoiceConfig = { id: existing?.id ?? nextId(), guildId, enabled: true, createdAt: existing?.createdAt ?? now, updatedAt: now, ...input };
    this.configs.set(guildId, config);
    return config;
  }
  async setConfigEnabled(guildId: string, enabled: boolean) {
    const config = this.configs.get(guildId);
    if (config) this.configs.set(guildId, { ...config, enabled });
  }
  async findRoomByChannel(channelId: string) {
    return this.rooms.get(channelId) ?? null;
  }
  async findRoomsByOwner(guildId: string, ownerId: string) {
    return [...this.rooms.values()].filter((r) => r.guildId === guildId && r.ownerId === ownerId);
  }
  async listRooms(guildId: string) {
    return [...this.rooms.values()].filter((r) => r.guildId === guildId);
  }
  async createRoomIfUnderLimit(input: CreateRoomInput, maxRooms: number) {
    const owned = [...this.rooms.values()].filter((r) => r.guildId === input.guildId && r.ownerId === input.ownerId).length;
    if (owned >= maxRooms) return null;
    const now = new Date();
    const room: TempVoiceRoom = { id: nextId(), locked: false, hidden: false, ownerLeftAt: null, createdAt: now, updatedAt: now, ...input };
    this.rooms.set(input.channelId, room);
    return room;
  }
  async updateRoom(channelId: string, data: RoomUpdate) {
    const room = this.rooms.get(channelId);
    if (!room) return null;
    const updated = { ...room, ...data, updatedAt: new Date() };
    this.rooms.set(channelId, updated);
    return updated;
  }
  async deleteRoom(channelId: string) {
    const room = this.rooms.get(channelId);
    if (!room) return false;
    this.rooms.delete(channelId);
    this.restrictions = this.restrictions.filter((r) => r.roomId !== room.id);
    this.allowed = this.allowed.filter((r) => r.roomId !== room.id);
    return true;
  }
  async transferOwnership(channelId: string, fromOwnerId: string, toOwnerId: string) {
    const room = this.rooms.get(channelId);
    if (!room || room.ownerId !== fromOwnerId) return false;
    this.rooms.set(channelId, { ...room, ownerId: toOwnerId, ownerLeftAt: null });
    return true;
  }
  async listRestrictions(roomId: string) {
    return this.restrictions.filter((r) => r.roomId === roomId);
  }
  async addRestriction(roomId: string, userId: string, createdById: string) {
    if (this.restrictions.some((r) => r.roomId === roomId && r.userId === userId)) return false;
    this.restrictions.push({ id: nextId(), roomId, userId, createdById, createdAt: new Date() });
    return true;
  }
  async removeRestriction(roomId: string, userId: string) {
    const before = this.restrictions.length;
    this.restrictions = this.restrictions.filter((r) => !(r.roomId === roomId && r.userId === userId));
    return this.restrictions.length < before;
  }
  async listAllowed(roomId: string) {
    return this.allowed.filter((r) => r.roomId === roomId);
  }
  async addAllowed(roomId: string, userId: string, createdById: string) {
    if (this.allowed.some((r) => r.roomId === roomId && r.userId === userId)) return false;
    this.allowed.push({ id: nextId(), roomId, userId, createdById, createdAt: new Date() });
    return true;
  }
  async removeAllowed(roomId: string, userId: string) {
    const before = this.allowed.length;
    this.allowed = this.allowed.filter((r) => !(r.roomId === roomId && r.userId === userId));
    return this.allowed.length < before;
  }
}

/** In-memory GuardRepository with the same uniqueness rules as the database. */
export class MemoryGuardRepository implements GuardRepository {
  configs = new Map<string, GuardConfig>();
  modules: GuardModuleConfig[] = [];
  trusted: TrustedExecutor[] = [];
  managers: GuardManager[] = [];
  events: SecurityEvent[] = [];
  incidents: SecurityIncident[] = [];
  snapshots: SecurityIncidentRoleSnapshot[] = [];
  /** Set to make every write throw, simulating a database outage. */
  failWrites = false;

  private guardWrite() {
    if (this.failWrites) throw new Error('veritabanı erişilemiyor');
  }

  async getConfig(guildId: string) {
    return this.configs.get(guildId) ?? null;
  }
  async upsertConfig(guildId: string, update: GuardConfigUpdate) {
    this.guardWrite();
    const now = new Date();
    const existing = this.configs.get(guildId);
    const config: GuardConfig = {
      id: existing?.id ?? nextId(),
      guildId,
      enabled: false,
      mode: 'ALERT',
      activatedById: null,
      activatedAt: null,
      incidentCooldownSec: 300,
      logRetentionDays: 90,
      notifyOwner: true,
      notifyRoleIds: '',
      createdAt: existing?.createdAt ?? now,
      ...existing,
      ...(update as Partial<GuardConfig>),
      updatedAt: now,
    };
    this.configs.set(guildId, config);
    return config;
  }
  async listModules(guildId: string) {
    return this.modules.filter((m) => m.guildId === guildId);
  }
  async upsertModule(guildId: string, module: string, create: ModuleConfigCreate, update: ModuleConfigUpdate) {
    this.guardWrite();
    const index = this.modules.findIndex((m) => m.guildId === guildId && m.module === module);
    if (index >= 0) {
      const updated = { ...this.modules[index]!, ...update, updatedAt: new Date() };
      this.modules[index] = updated;
      return updated;
    }
    const row: GuardModuleConfig = { id: nextId(), guildId, module, ...create, ...update, updatedAt: new Date() };
    this.modules.push(row);
    return row;
  }
  async listTrusted(guildId: string) {
    return this.trusted.filter((t) => t.guildId === guildId);
  }
  async addTrusted(guildId: string, targetId: string, type: string, addedById: string, note: string | null) {
    if (this.trusted.some((t) => t.guildId === guildId && t.targetId === targetId && t.type === type)) return false;
    this.trusted.push({ id: nextId(), guildId, targetId, type, addedById, note, createdAt: new Date() });
    return true;
  }
  async removeTrusted(guildId: string, targetId: string) {
    const before = this.trusted.length;
    this.trusted = this.trusted.filter((t) => !(t.guildId === guildId && t.targetId === targetId));
    return before - this.trusted.length;
  }
  async listManagers(guildId: string) {
    return this.managers.filter((m) => m.guildId === guildId);
  }
  async addManager(guildId: string, userId: string, addedById: string) {
    if (this.managers.some((m) => m.guildId === guildId && m.userId === userId)) return false;
    this.managers.push({ id: nextId(), guildId, userId, addedById, createdAt: new Date() });
    return true;
  }
  async removeManager(guildId: string, userId: string) {
    const before = this.managers.length;
    this.managers = this.managers.filter((m) => !(m.guildId === guildId && m.userId === userId));
    return this.managers.length < before;
  }
  async recordEvent(data: SecurityEventCreate) {
    this.guardWrite();
    if (data.auditEntryId && this.events.some((e) => e.guildId === data.guildId && e.auditEntryId === data.auditEntryId)) return null;
    const event: SecurityEvent = { id: nextId(), incidentId: null, createdAt: new Date(), ...data };
    this.events.push(event);
    return event;
  }
  async updateEvent(id: string, data: { actionTaken?: string; actionSucceeded?: boolean | null; incidentId?: string | null }) {
    this.guardWrite();
    const event = this.events.find((e) => e.id === id);
    if (event) Object.assign(event, data);
  }
  async listEvents(guildId: string, limit: number) {
    return this.events.filter((e) => e.guildId === guildId).slice(-limit).reverse();
  }
  async createIncident(data: IncidentCreate, roles: RoleSnapshotCreate[]): Promise<IncidentWithRoles | null> {
    this.guardWrite();
    if (this.incidents.some((i) => i.dedupeKey === data.dedupeKey)) return null;
    const now = new Date();
    const incident: SecurityIncident = { id: nextId(), restoredAt: null, restoredById: null, createdAt: now, updatedAt: now, ...data };
    this.incidents.push(incident);
    const snapshots = roles.map((role) => ({
      id: nextId(),
      incidentId: incident.id,
      removed: false,
      failureReason: null,
      restored: false,
      restoredAt: null,
      ...role,
    }));
    this.snapshots.push(...snapshots);
    return { ...incident, roles: snapshots };
  }
  async findRecentIncident(guildId: string, executorId: string, since: Date) {
    return (
      this.incidents
        .filter((i) => i.guildId === guildId && i.executorId === executorId && i.createdAt >= since)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
    );
  }
  async updateIncident(id: string, data: Partial<SecurityIncident>) {
    this.guardWrite();
    const incident = this.incidents.find((i) => i.id === id);
    if (incident) Object.assign(incident, data, { updatedAt: new Date() });
  }
  async updateSnapshot(incidentId: string, roleId: string, data: Partial<SecurityIncidentRoleSnapshot>) {
    this.guardWrite();
    for (const snapshot of this.snapshots) if (snapshot.incidentId === incidentId && snapshot.roleId === roleId) Object.assign(snapshot, data);
  }
  private withRoles(incident: SecurityIncident): IncidentWithRoles {
    return { ...incident, roles: this.snapshots.filter((s) => s.incidentId === incident.id).sort((a, b) => b.position - a.position) };
  }
  async findRestorableIncident(guildId: string, executorId: string) {
    const incident = this.incidents
      .filter((i) => i.guildId === guildId && i.executorId === executorId && !i.restoredAt)
      .filter((i) => this.snapshots.some((s) => s.incidentId === i.id && s.removed && !s.restored))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return incident ? this.withRoles(incident) : null;
  }
  async getIncident(id: string) {
    const incident = this.incidents.find((i) => i.id === id);
    return incident ? this.withRoles(incident) : null;
  }
  async listIncidents(guildId: string, limit: number, executorId?: string) {
    return this.incidents.filter((i) => i.guildId === guildId && (!executorId || i.executorId === executorId)).slice(-limit).reverse();
  }
  async purgeBefore(guildId: string, before: Date) {
    const count = this.events.length;
    this.events = this.events.filter((e) => !(e.guildId === guildId && e.occurredAt < before));
    return count - this.events.length;
  }
}

export class MemoryLogChannelRepository implements LogChannelRepository {
  rows: LogChannelConfig[] = [];
  async list(guildId: string) {
    return this.rows.filter((r) => r.guildId === guildId);
  }
  async findByChannel(channelId: string) {
    return this.rows.find((r) => r.channelId === channelId) ?? null;
  }
  async upsert(guildId: string, kind: string, channelId: string) {
    const existing = this.rows.find((r) => r.guildId === guildId && r.kind === kind);
    if (existing) {
      existing.channelId = channelId;
      return existing;
    }
    const now = new Date();
    const row: LogChannelConfig = { id: nextId(), guildId, kind, channelId, recoveryCount: 0, recoveryWindowStart: null, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
  async updateRecovery(id: string, recoveryCount: number, recoveryWindowStart: Date | null) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { recoveryCount, recoveryWindowStart });
  }
}

export function createMemoryRepositories(): Repositories & {
  tempVoice: MemoryTempVoiceRepository;
  guard: MemoryGuardRepository;
  logChannels: MemoryLogChannelRepository;
} {
  const guilds: GuildRepository = { ensure: async () => undefined, markLeft: async () => undefined };
  const commandAudit: CommandAuditRepository = { record: async () => undefined };
  return {
    guilds,
    tempVoice: new MemoryTempVoiceRepository(),
    guard: new MemoryGuardRepository(),
    logChannels: new MemoryLogChannelRepository(),
    commandAudit,
  };
}
