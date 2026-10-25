import { PermissionFlagsBits, type Guild, type GuildMember } from 'discord.js';
import type { GuardManager, GuardRepository, TrustedExecutor } from '../../database/repositories/types';
import type { ExemptionReason, TrustedType } from '../../types/guard';

interface TrustSnapshot {
  users: Set<string>;
  bots: Set<string>;
  roles: Set<string>;
  managers: Set<string>;
  rows: TrustedExecutor[];
  managerRows: GuardManager[];
}

/** Trusted executors (exempt from sanctions, still logged) and Guard managers. */
export class TrustService {
  private readonly cache = new Map<string, TrustSnapshot>();

  constructor(private readonly repo: GuardRepository) {}

  private async load(guildId: string): Promise<TrustSnapshot> {
    const cached = this.cache.get(guildId);
    if (cached) return cached;
    const [rows, managerRows] = await Promise.all([this.repo.listTrusted(guildId), this.repo.listManagers(guildId)]);
    const snapshot: TrustSnapshot = {
      users: new Set(rows.filter((row) => row.type === 'USER').map((row) => row.targetId)),
      bots: new Set(rows.filter((row) => row.type === 'BOT').map((row) => row.targetId)),
      roles: new Set(rows.filter((row) => row.type === 'ROLE').map((row) => row.targetId)),
      managers: new Set(managerRows.map((row) => row.userId)),
      rows,
      managerRows,
    };
    this.cache.set(guildId, snapshot);
    return snapshot;
  }

  /**
   * Why an executor is exempt from automatic sanctions, or null. The server
   * owner is always exempt. Role-based trust needs the executor's current roles.
   */
  async exemptionFor(guild: Guild, executorId: string): Promise<ExemptionReason | null> {
    if (executorId === guild.ownerId) return 'OWNER';
    const trust = await this.load(guild.id);
    if (trust.users.has(executorId)) return 'TRUSTED_USER';
    if (trust.bots.has(executorId)) return 'TRUSTED_BOT';
    if (trust.roles.size === 0) return null;
    const member = guild.members.cache.get(executorId) ?? (await guild.members.fetch(executorId).catch(() => null));
    if (member && member.roles.cache.some((role) => trust.roles.has(role.id))) return 'TRUSTED_ROLE';
    return null;
  }

  async isTrustedBot(guildId: string, botId: string): Promise<boolean> {
    return (await this.load(guildId)).bots.has(botId);
  }

  /** Synchronous lookup used by detectors; returns false until the guild's trust list is loaded. */
  isTrustedRoleCached(guildId: string, roleId: string): boolean {
    return this.cache.get(guildId)?.roles.has(roleId) ?? false;
  }

  async preload(guildId: string): Promise<void> {
    await this.load(guildId);
  }

  async list(guildId: string): Promise<TrustedExecutor[]> {
    return (await this.load(guildId)).rows;
  }

  async add(guildId: string, targetId: string, type: TrustedType, addedById: string, note: string | null): Promise<boolean> {
    const added = await this.repo.addTrusted(guildId, targetId, type, addedById, note);
    this.cache.delete(guildId);
    return added;
  }

  async remove(guildId: string, targetId: string): Promise<boolean> {
    const removed = await this.repo.removeTrusted(guildId, targetId);
    this.cache.delete(guildId);
    return removed > 0;
  }

  async managers(guildId: string): Promise<GuardManager[]> {
    return (await this.load(guildId)).managerRows;
  }

  async addManager(guildId: string, userId: string, addedById: string): Promise<boolean> {
    const added = await this.repo.addManager(guildId, userId, addedById);
    this.cache.delete(guildId);
    return added;
  }

  async removeManager(guildId: string, userId: string): Promise<boolean> {
    const removed = await this.repo.removeManager(guildId, userId);
    this.cache.delete(guildId);
    return removed;
  }

  /**
   * Guard managers: the server owner, plus administrators the owner explicitly
   * authorised. Ordinary moderators never qualify.
   */
  async isGuardManager(member: GuildMember): Promise<boolean> {
    if (member.id === member.guild.ownerId) return true;
    if (!member.permissions.has(PermissionFlagsBits.Administrator)) return false;
    return (await this.load(member.guild.id)).managers.has(member.id);
  }

  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }
}
