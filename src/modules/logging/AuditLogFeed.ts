import type { EmbedBuilder, Guild } from 'discord.js';
import type { LogChannelKind } from '../../config/constants';
import type { Logger } from '../../utils/logger';
import type { AuditEntryLike } from '../guard/detectors/types';
import { formatAuditEntry } from './auditFormatter';

export interface LogSink {
  enqueue(guildId: string, kind: LogChannelKind, embed: EmbedBuilder): void;
}

export interface LogAvailability {
  isConfigured(guildId: string): Promise<boolean>;
}

/**
 * Writes every administrative action from the audit log to the matching log
 * channel. Independent of Guard: logs flow even when Guard is off or a module
 * is disabled. Biri's own actions are skipped (they are logged by the feature
 * that performed them, e.g. temp rooms → ses-log, `.ban` → üye-log).
 */
export class AuditLogFeed {
  constructor(
    private readonly sink: LogSink,
    private readonly logs: LogAvailability,
    private readonly logger: Logger,
  ) {}

  async handle(guild: Guild, entry: AuditEntryLike & { target?: unknown }): Promise<boolean> {
    if (entry.executorId && entry.executorId === guild.client.user?.id) return false;
    try {
      if (!(await this.logs.isConfigured(guild.id))) return false;
      const item = formatAuditEntry(entry, {
        guildId: guild.id,
        channelName: (id) => guild.channels.cache.get(id)?.name ?? null,
        roleName: (id) => guild.roles.cache.get(id)?.name ?? null,
      });
      if (!item) return false;
      this.sink.enqueue(guild.id, item.kind, item.embed);
      return true;
    } catch (error) {
      this.logger.warn({ err: error, guildId: guild.id, action: entry.action }, 'Denetim kaydı loglanamadı');
      return false;
    }
  }
}
