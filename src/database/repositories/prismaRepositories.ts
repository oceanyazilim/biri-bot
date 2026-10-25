import { Prisma, type PrismaClient } from '@prisma/client';
import { withRetry } from '../../utils/async';
import { isUniqueViolation } from '../../utils/discordErrors';
import type {
  CommandAuditRepository,
  CreateRoomInput,
  GuardConfigUpdate,
  GuardRepository,
  GuildRepository,
  IncidentCreate,
  LogChannelRepository,
  ModuleConfigCreate,
  ModuleConfigUpdate,
  Repositories,
  RoleSnapshotCreate,
  RoomUpdate,
  SecurityEventCreate,
  TempVoiceConfigInput,
  TempVoiceRepository,
} from './types';

/** Serializable transactions may abort under contention; those are safe to retry. */
function isTransactionConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2034';
}

async function ensureGuild(db: Prisma.TransactionClient | PrismaClient, guildId: string): Promise<void> {
  await db.guildConfig.upsert({
    where: { guildId },
    create: { guildId },
    update: { leftAt: null },
  });
}

class PrismaGuildRepository implements GuildRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ensure(guildId: string): Promise<void> {
    await ensureGuild(this.prisma, guildId);
  }

  async markLeft(guildId: string): Promise<void> {
    await this.prisma.guildConfig.updateMany({ where: { guildId }, data: { leftAt: new Date() } });
  }
}

class PrismaTempVoiceRepository implements TempVoiceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  getConfig(guildId: string) {
    return this.prisma.tempVoiceConfig.findUnique({ where: { guildId } });
  }

  listConfigs() {
    return this.prisma.tempVoiceConfig.findMany({ where: { enabled: true } });
  }

  async upsertConfig(guildId: string, input: TempVoiceConfigInput) {
    await ensureGuild(this.prisma, guildId);
    return this.prisma.tempVoiceConfig.upsert({
      where: { guildId },
      create: { guildId, enabled: true, ...input },
      update: { enabled: true, ...input },
    });
  }

  async setConfigEnabled(guildId: string, enabled: boolean): Promise<void> {
    await this.prisma.tempVoiceConfig.updateMany({ where: { guildId }, data: { enabled } });
  }

  async setPanel(guildId: string, panelChannelId: string | null, panelMessageId: string | null): Promise<void> {
    await this.prisma.tempVoiceConfig.updateMany({ where: { guildId }, data: { panelChannelId, panelMessageId } });
  }

  findRoomByChannel(channelId: string) {
    return this.prisma.tempVoiceRoom.findUnique({ where: { channelId } });
  }

  findRoomsByOwner(guildId: string, ownerId: string) {
    return this.prisma.tempVoiceRoom.findMany({ where: { guildId, ownerId }, orderBy: { createdAt: 'asc' } });
  }

  listRooms(guildId: string) {
    return this.prisma.tempVoiceRoom.findMany({ where: { guildId } });
  }

  createRoomIfUnderLimit(input: CreateRoomInput, maxRooms: number) {
    return withRetry(
      () =>
        this.prisma.$transaction(
          async (tx) => {
            const owned = await tx.tempVoiceRoom.count({ where: { guildId: input.guildId, ownerId: input.ownerId } });
            if (owned >= maxRooms) return null;
            return tx.tempVoiceRoom.create({ data: input });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      { attempts: 4, baseDelayMs: 50, shouldRetry: isTransactionConflict },
    );
  }

  async updateRoom(channelId: string, data: RoomUpdate) {
    try {
      return await this.prisma.tempVoiceRoom.update({ where: { channelId }, data });
    } catch (error) {
      if ((error as { code?: unknown }).code === 'P2025') return null;
      throw error;
    }
  }

  async deleteRoom(channelId: string): Promise<boolean> {
    const result = await this.prisma.tempVoiceRoom.deleteMany({ where: { channelId } });
    return result.count > 0;
  }

  async transferOwnership(channelId: string, fromOwnerId: string, toOwnerId: string): Promise<boolean> {
    const result = await this.prisma.tempVoiceRoom.updateMany({
      where: { channelId, ownerId: fromOwnerId },
      data: { ownerId: toOwnerId, ownerLeftAt: null },
    });
    return result.count === 1;
  }

  listRestrictions(roomId: string) {
    return this.prisma.roomMemberRestriction.findMany({ where: { roomId } });
  }

  async addRestriction(roomId: string, userId: string, createdById: string): Promise<boolean> {
    try {
      await this.prisma.roomMemberRestriction.create({ data: { roomId, userId, createdById } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async removeRestriction(roomId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.roomMemberRestriction.deleteMany({ where: { roomId, userId } });
    return result.count > 0;
  }

  listAllowed(roomId: string) {
    return this.prisma.roomAllowedMember.findMany({ where: { roomId } });
  }

  async addAllowed(roomId: string, userId: string, createdById: string): Promise<boolean> {
    try {
      await this.prisma.roomAllowedMember.create({ data: { roomId, userId, createdById } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async removeAllowed(roomId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.roomAllowedMember.deleteMany({ where: { roomId, userId } });
    return result.count > 0;
  }
}

class PrismaGuardRepository implements GuardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  getConfig(guildId: string) {
    return this.prisma.guardConfig.findUnique({ where: { guildId } });
  }

  async upsertConfig(guildId: string, update: GuardConfigUpdate) {
    await ensureGuild(this.prisma, guildId);
    return this.prisma.guardConfig.upsert({
      where: { guildId },
      create: { guildId, ...update },
      update,
    });
  }

  listModules(guildId: string) {
    return this.prisma.guardModuleConfig.findMany({ where: { guildId } });
  }

  async upsertModule(guildId: string, module: string, create: ModuleConfigCreate, update: ModuleConfigUpdate) {
    await ensureGuild(this.prisma, guildId);
    return this.prisma.guardModuleConfig.upsert({
      where: { guildId_module: { guildId, module } },
      create: { guildId, module, ...create, ...update },
      update,
    });
  }

  listTrusted(guildId: string) {
    return this.prisma.trustedExecutor.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
  }

  async addTrusted(guildId: string, targetId: string, type: string, addedById: string, note: string | null): Promise<boolean> {
    await ensureGuild(this.prisma, guildId);
    try {
      await this.prisma.trustedExecutor.create({ data: { guildId, targetId, type, addedById, note } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async removeTrusted(guildId: string, targetId: string): Promise<number> {
    const result = await this.prisma.trustedExecutor.deleteMany({ where: { guildId, targetId } });
    return result.count;
  }

  listManagers(guildId: string) {
    return this.prisma.guardManager.findMany({ where: { guildId }, orderBy: { createdAt: 'asc' } });
  }

  async addManager(guildId: string, userId: string, addedById: string): Promise<boolean> {
    await ensureGuild(this.prisma, guildId);
    try {
      await this.prisma.guardManager.create({ data: { guildId, userId, addedById } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async removeManager(guildId: string, userId: string): Promise<boolean> {
    const result = await this.prisma.guardManager.deleteMany({ where: { guildId, userId } });
    return result.count > 0;
  }

  async recordEvent(data: SecurityEventCreate) {
    try {
      return await this.prisma.securityEvent.create({ data });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async updateEvent(id: string, data: { actionTaken?: string; actionSucceeded?: boolean | null; incidentId?: string | null }) {
    await this.prisma.securityEvent.update({ where: { id }, data });
  }

  listEvents(guildId: string, limit: number) {
    return this.prisma.securityEvent.findMany({ where: { guildId }, orderBy: { occurredAt: 'desc' }, take: limit });
  }

  async createIncident(data: IncidentCreate, roles: RoleSnapshotCreate[]) {
    try {
      return await this.prisma.securityIncident.create({
        data: { ...data, roles: { create: roles } },
        include: { roles: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  findRecentIncident(guildId: string, executorId: string, since: Date) {
    return this.prisma.securityIncident.findFirst({
      where: { guildId, executorId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateIncident(id: string, data: Parameters<GuardRepository['updateIncident']>[1]) {
    await this.prisma.securityIncident.update({ where: { id }, data });
  }

  async updateSnapshot(incidentId: string, roleId: string, data: Parameters<GuardRepository['updateSnapshot']>[2]) {
    await this.prisma.securityIncidentRoleSnapshot.updateMany({ where: { incidentId, roleId }, data });
  }

  findRestorableIncident(guildId: string, executorId: string) {
    return this.prisma.securityIncident.findFirst({
      where: { guildId, executorId, restoredAt: null, roles: { some: { removed: true, restored: false } } },
      orderBy: { createdAt: 'desc' },
      include: { roles: { orderBy: { position: 'desc' } } },
    });
  }

  getIncident(id: string) {
    return this.prisma.securityIncident.findUnique({ where: { id }, include: { roles: { orderBy: { position: 'desc' } } } });
  }

  listIncidents(guildId: string, limit: number, executorId?: string) {
    return this.prisma.securityIncident.findMany({
      where: { guildId, ...(executorId ? { executorId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async purgeBefore(guildId: string, before: Date): Promise<number> {
    const [events, incidents] = await this.prisma.$transaction([
      this.prisma.securityEvent.deleteMany({ where: { guildId, occurredAt: { lt: before } } }),
      // Keep incidents that still hold unrestored role snapshots: they are needed for /guard-iade.
      this.prisma.securityIncident.deleteMany({
        where: { guildId, createdAt: { lt: before }, NOT: { roles: { some: { removed: true, restored: false } } } },
      }),
    ]);
    return events.count + incidents.count;
  }
}

class PrismaLogChannelRepository implements LogChannelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  list(guildId: string) {
    return this.prisma.logChannelConfig.findMany({ where: { guildId } });
  }

  findByChannel(channelId: string) {
    return this.prisma.logChannelConfig.findFirst({ where: { channelId } });
  }

  async upsert(guildId: string, kind: string, channelId: string) {
    await ensureGuild(this.prisma, guildId);
    return this.prisma.logChannelConfig.upsert({
      where: { guildId_kind: { guildId, kind } },
      create: { guildId, kind, channelId },
      update: { channelId },
    });
  }

  async updateRecovery(id: string, recoveryCount: number, recoveryWindowStart: Date | null): Promise<void> {
    await this.prisma.logChannelConfig.update({ where: { id }, data: { recoveryCount, recoveryWindowStart } });
  }
}

class PrismaCommandAuditRepository implements CommandAuditRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: Parameters<CommandAuditRepository['record']>[0]): Promise<void> {
    await this.prisma.commandAuditLog.create({ data: entry });
  }
}

export function createPrismaRepositories(prisma: PrismaClient): Repositories {
  return {
    guilds: new PrismaGuildRepository(prisma),
    tempVoice: new PrismaTempVoiceRepository(prisma),
    guard: new PrismaGuardRepository(prisma),
    logChannels: new PrismaLogChannelRepository(prisma),
    commandAudit: new PrismaCommandAuditRepository(prisma),
  };
}
