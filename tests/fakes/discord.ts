/**
 * Minimal, behaviour-faithful fakes of the discord.js objects Biri touches.
 * They model the rules that matter for the tests: role hierarchy, managed
 * roles, permission checks, voice connections and channel lifecycles.
 */
import { ChannelType, Collection, OverwriteType, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { vi } from 'vitest';

let snowflake = 100_000_000_000_000_000n;
export const nextSnowflake = (): string => (++snowflake).toString();

export const BOT_ID = '999999999999999999';

export class FakePermissions {
  constructor(public bitfield: bigint) {}
  has(flag: bigint): boolean {
    if ((this.bitfield & PermissionFlagsBits.Administrator) !== 0n) return true;
    return (this.bitfield & flag) === flag;
  }
}

export class DiscordError extends Error {
  constructor(
    public code: number,
    message = 'Missing Permissions',
  ) {
    super(message);
  }
}

export class FakeRole {
  id: string;
  name: string;
  position: number;
  managed: boolean;
  permissions: FakePermissions;
  constructor(public guild: FakeGuild, opts: { id?: string; name: string; position: number; permissions?: bigint; managed?: boolean }) {
    this.id = opts.id ?? nextSnowflake();
    this.name = opts.name;
    this.position = opts.position;
    this.managed = opts.managed ?? false;
    this.permissions = new FakePermissions(opts.permissions ?? 0n);
  }
}

class FakeMemberRoles {
  cache = new Collection<string, FakeRole>();
  constructor(private readonly member: FakeMember) {}

  get highest(): FakeRole {
    let top = this.member.guild.roles.everyone;
    for (const role of this.cache.values()) if (role.position > top.position) top = role;
    return top;
  }

  /** Mirrors Discord: changing a managed role or one at/above the bot's top role is rejected. */
  private assertManageable(roleId: string): void {
    const guild = this.member.guild;
    if (guild.rolesApiDown) throw new DiscordError(500, 'Internal Server Error');
    const me = guild.members.me;
    const role = guild.roles.cache.get(roleId);
    if (!role) throw new DiscordError(RESTJSONErrorCodes.UnknownRole, 'Unknown Role');
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || role.managed || role.position >= me.roles.highest.position) {
      throw new DiscordError(RESTJSONErrorCodes.MissingPermissions);
    }
  }

  set = vi.fn(async (ids: string[]) => {
    const target = new Set(ids);
    for (const id of new Set([...this.cache.keys(), ...ids])) {
      if (this.cache.has(id) !== target.has(id)) this.assertManageable(id);
    }
    this.cache = new Collection(ids.map((id) => [id, this.member.guild.roles.cache.get(id)!]));
    return this.member;
  });

  remove = vi.fn(async (id: string) => {
    this.assertManageable(id);
    this.cache.delete(id);
    return this.member;
  });

  add = vi.fn(async (ids: string | string[]) => {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) this.assertManageable(id);
    for (const id of list) this.cache.set(id, this.member.guild.roles.cache.get(id)!);
    return this.member;
  });

  /** Test helper: assigns roles without hierarchy checks. */
  give(...roles: FakeRole[]): void {
    for (const role of roles) this.cache.set(role.id, role);
  }
}

class FakeVoice {
  channelId: string | null = null;
  constructor(private readonly member: FakeMember) {}

  get channel(): FakeVoiceChannel | null {
    return this.channelId ? ((this.member.guild.channels.cache.get(this.channelId) as FakeVoiceChannel | undefined) ?? null) : null;
  }

  setChannel = vi.fn(async (channel: FakeVoiceChannel | null) => {
    this.member.guild.moveMember(this.member, channel?.id ?? null);
    return this.member;
  });

  disconnect = vi.fn(async () => this.setChannel(null));
}

export class FakeMember {
  id: string;
  user: { id: string; bot: boolean; tag: string; username: string };
  displayName: string;
  roles: FakeMemberRoles;
  voice: FakeVoice;
  /** Explicit extra permissions (beyond roles), e.g. for quick admin setups. */
  extraPermissions = 0n;
  kick = vi.fn();
  ban = vi.fn();
  send = vi.fn(async () => undefined);

  constructor(public guild: FakeGuild, opts: { id?: string; name: string; bot?: boolean; permissions?: bigint }) {
    this.id = opts.id ?? nextSnowflake();
    this.user = { id: this.id, bot: opts.bot ?? false, tag: `${opts.name}#0`, username: opts.name };
    this.displayName = opts.name;
    this.extraPermissions = opts.permissions ?? 0n;
    this.roles = new FakeMemberRoles(this);
    this.voice = new FakeVoice(this);
  }

  get client() {
    return this.guild.client;
  }

  get permissions(): FakePermissions {
    if (this.id === this.guild.ownerId) return new FakePermissions(PermissionFlagsBits.Administrator);
    let bits = this.guild.roles.everyone.permissions.bitfield | this.extraPermissions;
    for (const role of this.roles.cache.values()) bits |= role.permissions.bitfield;
    return new FakePermissions(bits);
  }
}

interface FakeOverwrite {
  id: string;
  type: OverwriteType;
  allow: { bitfield: bigint };
  deny: { bitfield: bigint };
}

function toFakeOverwrites(list: Array<{ id: string; type: OverwriteType; allow?: unknown; deny?: unknown }> = []): Collection<string, FakeOverwrite> {
  const bits = (value: unknown): bigint => {
    if (typeof value === 'bigint') return value;
    if (value && typeof value === 'object' && 'bitfield' in value) return (value as { bitfield: bigint }).bitfield;
    if (Array.isArray(value)) return value.reduce((acc: bigint, flag: bigint) => acc | flag, 0n);
    return 0n;
  };
  return new Collection(list.map((o) => [o.id, { id: o.id, type: o.type, allow: { bitfield: bits(o.allow) }, deny: { bitfield: bits(o.deny) } }]));
}

abstract class FakeGuildChannel {
  id: string;
  name: string;
  parentId: string | null;
  abstract type: ChannelType;
  permissionOverwrites: {
    cache: Collection<string, FakeOverwrite>;
    set: ReturnType<typeof vi.fn>;
  };
  delete = vi.fn(async () => {
    if (this.guild.failChannelDelete) throw new DiscordError(RESTJSONErrorCodes.MissingPermissions);
    this.guild.channels.cache.delete(this.id);
    return this;
  });

  constructor(public guild: FakeGuild, opts: { id?: string; name: string; parentId?: string | null; overwrites?: Parameters<typeof toFakeOverwrites>[0] }) {
    this.id = opts.id ?? nextSnowflake();
    this.name = opts.name;
    this.parentId = opts.parentId ?? null;
    const overwrites = { cache: toFakeOverwrites(opts.overwrites), set: vi.fn() };
    overwrites.set = vi.fn(async (list: Parameters<typeof toFakeOverwrites>[0]) => {
      overwrites.cache = toFakeOverwrites(list);
      return this;
    });
    this.permissionOverwrites = overwrites;
  }

  get client() {
    return this.guild.client;
  }
  get parent() {
    return this.parentId ? (this.guild.channels.cache.get(this.parentId) ?? null) : null;
  }
  isDMBased() {
    return false;
  }
  isVoiceBased() {
    return false;
  }
  isTextBased() {
    return false;
  }
  setParent = vi.fn(async (parentId: string) => {
    this.parentId = parentId;
    return this;
  });
  permissionsFor(member: FakeMember) {
    return member.permissions;
  }
}

export class FakeCategory extends FakeGuildChannel {
  type = ChannelType.GuildCategory as const;
  get children() {
    return { cache: this.guild.channels.cache.filter((c) => c.parentId === this.id) };
  }
}

export class FakeTextChannel extends FakeGuildChannel {
  type = ChannelType.GuildText as const;
  send = vi.fn(async () => undefined);
  override isTextBased() {
    return true;
  }
}

export class FakeVoiceChannel extends FakeGuildChannel {
  type = ChannelType.GuildVoice as const;
  userLimit = 0;
  members = new Collection<string, FakeMember>();
  send = vi.fn(async () => undefined);
  setName = vi.fn(async (name: string) => {
    this.name = name;
    return this;
  });
  setUserLimit = vi.fn(async (limit: number) => {
    this.userLimit = limit;
    return this;
  });
  override isVoiceBased() {
    return true;
  }
  override isTextBased() {
    return true;
  }
}

export type AnyFakeChannel = FakeCategory | FakeTextChannel | FakeVoiceChannel;

export interface FakeAuditEntry {
  id: string;
  action: number;
  executorId: string | null;
  targetId: string | null;
  createdTimestamp: number;
  changes: Array<{ key: string; old?: unknown; new?: unknown }>;
  extra?: unknown;
  reason?: string | null;
}

export class FakeGuild {
  id = nextSnowflake();
  name = 'Test Sunucusu';
  ownerId: string;
  client = { user: { id: BOT_ID } };
  failChannelCreate = false;
  failChannelDelete = false;
  rolesApiDown = false;
  auditLog: FakeAuditEntry[] = [];

  roles: { cache: Collection<string, FakeRole>; everyone: FakeRole };
  members: {
    cache: Collection<string, FakeMember>;
    me: FakeMember;
    fetch: ReturnType<typeof vi.fn>;
  };
  channels: {
    cache: Collection<string, AnyFakeChannel>;
    create: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn>;
  };

  fetchOwner = vi.fn(async () => this.members.cache.get(this.ownerId));
  bannedIds = new Set<string>();
  bans = {
    create: vi.fn(async (userId: string, _options?: { reason?: string }) => {
      const member = this.members.cache.get(userId);
      if (member && member.roles.highest.position >= this.members.me.roles.highest.position) {
        throw new DiscordError(RESTJSONErrorCodes.MissingPermissions);
      }
      this.bannedIds.add(userId);
      this.members.cache.delete(userId);
      return userId;
    }),
    remove: vi.fn(async (userId: string, _reason?: string) => {
      if (!this.bannedIds.delete(userId)) throw new DiscordError(RESTJSONErrorCodes.UnknownBan, 'Unknown Ban');
      return null;
    }),
  };
  fetchAuditLogs = vi.fn(async ({ type, limit }: { type: number; limit: number }) => ({
    entries: new Collection(
      this.auditLog
        .filter((entry) => entry.action === type)
        .slice(-limit)
        .map((entry) => [entry.id, entry]),
    ),
  }));

  /** Role the bot's member holds; its position bounds what Biri can manage. */
  botRole: FakeRole;

  constructor(opts: { botPermissions?: bigint; botRolePosition?: number } = {}) {
    const everyone = new FakeRole(this, { id: this.id, name: '@everyone', position: 0, permissions: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect });
    this.roles = { cache: new Collection([[everyone.id, everyone]]), everyone };

    const owner = new FakeMember(this, { name: 'Sahip' });
    this.ownerId = owner.id;
    const me = new FakeMember(this, { id: BOT_ID, name: 'Biri', bot: true });
    this.members = {
      cache: new Collection([
        [owner.id, owner],
        [me.id, me],
      ]),
      me,
      fetch: vi.fn(async (id: string) => {
        const member = this.members.cache.get(id);
        if (!member) throw new DiscordError(RESTJSONErrorCodes.UnknownMember, 'Unknown Member');
        return member;
      }),
    };
    this.botRole = this.addRole({
      name: 'Biri',
      position: opts.botRolePosition ?? 50,
      permissions:
        opts.botPermissions ??
        PermissionFlagsBits.ManageChannels |
          PermissionFlagsBits.ManageRoles |
          PermissionFlagsBits.MoveMembers |
          PermissionFlagsBits.ViewChannel |
          PermissionFlagsBits.Connect |
          PermissionFlagsBits.SendMessages |
          PermissionFlagsBits.EmbedLinks |
          PermissionFlagsBits.ViewAuditLog |
          PermissionFlagsBits.BanMembers |
          PermissionFlagsBits.KickMembers,
      managed: true,
    });
    me.roles.give(this.botRole);

    this.channels = {
      cache: new Collection(),
      create: vi.fn(async (opts: { name: string; type: ChannelType; parent?: string | null; userLimit?: number; permissionOverwrites?: never[] }) => {
        if (this.failChannelCreate) throw new DiscordError(RESTJSONErrorCodes.MissingPermissions);
        const base = { name: opts.name, parentId: opts.parent ?? null, overwrites: opts.permissionOverwrites };
        let channel: AnyFakeChannel;
        if (opts.type === ChannelType.GuildCategory) channel = new FakeCategory(this, base);
        else if (opts.type === ChannelType.GuildVoice) {
          channel = new FakeVoiceChannel(this, base);
          channel.userLimit = opts.userLimit ?? 0;
        } else channel = new FakeTextChannel(this, base);
        this.channels.cache.set(channel.id, channel);
        return channel;
      }),
      fetch: vi.fn(async (id: string) => {
        const channel = this.channels.cache.get(id);
        if (!channel) throw new DiscordError(RESTJSONErrorCodes.UnknownChannel, 'Unknown Channel');
        return channel;
      }),
    };
  }

  addRole(opts: { name: string; position: number; permissions?: bigint; managed?: boolean }): FakeRole {
    const role = new FakeRole(this, opts);
    this.roles.cache.set(role.id, role);
    return role;
  }

  addMember(opts: { name: string; bot?: boolean; permissions?: bigint; roles?: FakeRole[] }): FakeMember {
    const member = new FakeMember(this, opts);
    member.roles.give(...(opts.roles ?? []));
    this.members.cache.set(member.id, member);
    return member;
  }

  addCategory(name: string, overwrites?: Parameters<typeof toFakeOverwrites>[0]): FakeCategory {
    const category = new FakeCategory(this, { name, overwrites });
    this.channels.cache.set(category.id, category);
    return category;
  }

  addVoiceChannel(name: string, parentId: string | null = null): FakeVoiceChannel {
    const channel = new FakeVoiceChannel(this, { name, parentId });
    this.channels.cache.set(channel.id, channel);
    return channel;
  }

  addTextChannel(name: string, parentId: string | null = null): FakeTextChannel {
    const channel = new FakeTextChannel(this, { name, parentId });
    this.channels.cache.set(channel.id, channel);
    return channel;
  }

  /** Moves a member between voice channels and returns the before/after voice states. */
  moveMember(member: FakeMember, channelId: string | null) {
    const oldState = { channelId: member.voice.channelId, member, guild: this };
    const previous = member.voice.channel;
    previous?.members.delete(member.id);
    member.voice.channelId = channelId;
    if (channelId) (this.channels.cache.get(channelId) as FakeVoiceChannel).members.set(member.id, member);
    const newState = { channelId, member, guild: this };
    return { oldState, newState };
  }

  /** Records an audit entry as Discord would. */
  audit(entry: Omit<FakeAuditEntry, 'id' | 'createdTimestamp' | 'changes'> & Partial<Pick<FakeAuditEntry, 'id' | 'createdTimestamp' | 'changes'>>): FakeAuditEntry {
    const full: FakeAuditEntry = { id: nextSnowflake(), createdTimestamp: Date.now(), changes: [], ...entry };
    this.auditLog.push(full);
    return full;
  }
}

/** Casts a fake to the discord.js type expected by production code. */
export function asDiscord<T>(fake: unknown): T {
  return fake as T;
}
