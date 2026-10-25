import type {
  Collection,
  Guild,
  GuildMember,
  GuildTextBasedChannel,
  Message,
  PartialGuildMember,
  PartialMessage,
  ReadonlyCollection,
  Snowflake,
  VoiceState,
} from 'discord.js';
import { COLORS } from '../../config/constants';
import { clip, discordTimestamp } from '../../utils/format';
import type { Logger } from '../../utils/logger';
import type { LogAvailability, LogSink } from './AuditLogFeed';
import { brandEmbed } from './embeds';

const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;

const who = (id: string, tag?: string | null) => `<@${id}>${tag ? ` \`${tag}\`` : ''} (\`${id}\`)`;

/**
 * Logs activity that has no audit log entry: voice joins/leaves/moves,
 * members joining or leaving, and deleted or edited messages.
 */
export class ActivityLogger {
  constructor(
    private readonly sink: LogSink,
    private readonly logs: LogAvailability,
    private readonly logger: Logger,
  ) {}

  private async ready(guildId: string): Promise<boolean> {
    try {
      return await this.logs.isConfigured(guildId);
    } catch (error) {
      this.logger.warn({ err: error, guildId }, 'Log yapılandırması okunamadı');
      return false;
    }
  }

  /**
   * Voice joins, leaves and switches. The temp-room creator channel is treated
   * as invisible: "creator → new room" is logged as a single join.
   */
  async voice(oldState: VoiceState, newState: VoiceState, creatorChannelId: string | null): Promise<void> {
    const member = newState.member ?? oldState.member;
    if (!member || member.user.bot) return;
    const from = oldState.channelId === creatorChannelId ? null : oldState.channelId;
    const to = newState.channelId === creatorChannelId ? null : newState.channelId;
    if (from === to) return;
    if (!(await this.ready(newState.guild.id))) return;

    const base = `**Üye:** ${who(member.id, member.user.tag)}`;
    let embed;
    if (!from && to) {
      embed = brandEmbed(COLORS.success).setTitle('📥 Ses Kanalına Katıldı').setDescription(`${base}\n**Kanal:** <#${to}>`);
    } else if (from && !to) {
      embed = brandEmbed(COLORS.muted).setTitle('📤 Ses Kanalından Ayrıldı').setDescription(`${base}\n**Kanal:** <#${from}>`);
    } else {
      embed = brandEmbed(COLORS.info).setTitle('🔀 Ses Kanalı Değiştirdi').setDescription(`${base}\n**Kanal:** <#${from}> → <#${to}>`);
    }
    this.sink.enqueue(newState.guild.id, 'VOICE', embed);
  }

  async memberJoin(member: GuildMember): Promise<void> {
    if (!(await this.ready(member.guild.id))) return;
    const created = member.user.createdAt;
    const isNew = Date.now() - created.getTime() < NEW_ACCOUNT_MS;
    const embed = brandEmbed(member.user.bot ? COLORS.warning : COLORS.success)
      .setTitle(member.user.bot ? '🤖 Bot Sunucuya Katıldı' : '📥 Üye Katıldı')
      .setThumbnail(member.user.displayAvatarURL())
      .setDescription(
        `**Üye:** ${who(member.id, member.user.tag)}\n` +
          `**Hesap oluşturma:** ${discordTimestamp(created, 'f')} (${discordTimestamp(created, 'R')})\n` +
          `**Üye sayısı:** ${member.guild.memberCount}` +
          (isNew && !member.user.bot ? '\n⚠️ **Yeni hesap** (7 günden yeni)' : ''),
      );
    this.sink.enqueue(member.guild.id, 'MEMBER', embed);
  }

  async memberLeave(member: GuildMember | PartialGuildMember): Promise<void> {
    if (!(await this.ready(member.guild.id))) return;
    const roles = member.roles?.cache
      ? [...member.roles.cache.values()].filter((role) => role.id !== member.guild.id).map((role) => `<@&${role.id}>`)
      : [];
    const embed = brandEmbed(COLORS.muted)
      .setTitle('📤 Üye Ayrıldı')
      .setDescription(
        `**Üye:** ${who(member.id, member.user?.tag)}\n` +
          (member.joinedAt ? `**Katılma:** ${discordTimestamp(member.joinedAt, 'f')} (${discordTimestamp(member.joinedAt, 'R')})\n` : '') +
          `**Üye sayısı:** ${member.guild.memberCount}`,
      );
    if (roles.length > 0) embed.addFields({ name: `Rolleri (${roles.length})`, value: clip(roles.join(' ')) });
    embed.setFooter({ text: 'Biri • Atılma/yasaklama ise üye-log’da ayrıca görünür' });
    this.sink.enqueue(member.guild.id, 'MEMBER', embed);
  }

  async messageDelete(message: Message | PartialMessage): Promise<void> {
    if (!message.guildId || message.author?.bot || message.webhookId) return;
    if (!(await this.ready(message.guildId))) return;
    const embed = brandEmbed(COLORS.critical)
      .setTitle('🗑️ Mesaj Silindi')
      .setDescription(
        `**Yazan:** ${message.author ? who(message.author.id, message.author.tag) : '*Bilinmiyor (önbellekte yok)*'}\n` +
          `**Kanal:** <#${message.channelId}>\n` +
          `**Gönderilme:** ${discordTimestamp(message.createdAt, 'f')}`,
      );
    if (message.partial || message.content === null) {
      embed.addFields({ name: 'İçerik', value: '*Mesaj bot başlamadan önce gönderildiği için içerik bilinmiyor.*' });
    } else if (message.content) {
      embed.addFields({ name: 'İçerik', value: clip(message.content) });
    }
    const attachments = message.attachments?.map((file) => file.name) ?? [];
    if (attachments.length > 0) embed.addFields({ name: `Ekler (${attachments.length})`, value: clip(attachments.join(', ')) });
    embed.setFooter({ text: `Biri • Mesaj ${message.id}` });
    this.sink.enqueue(message.guildId, 'MESSAGE', embed);
  }

  async messageUpdate(oldMessage: Message | PartialMessage, newMessage: Message | PartialMessage): Promise<void> {
    if (!newMessage.guildId || newMessage.author?.bot || newMessage.webhookId) return;
    // Link previews and embed loads also fire updates; only real text edits matter.
    if (oldMessage.content === newMessage.content) return;
    if (!(await this.ready(newMessage.guildId))) return;
    const embed = brandEmbed(COLORS.warning)
      .setTitle('✏️ Mesaj Düzenlendi')
      .setDescription(
        `**Yazan:** ${newMessage.author ? who(newMessage.author.id, newMessage.author.tag) : '*Bilinmiyor*'}\n` +
          `**Kanal:** <#${newMessage.channelId}>\n` +
          `[Mesaja git](${newMessage.url})`,
      )
      .addFields(
        { name: 'Önce', value: oldMessage.partial || oldMessage.content === null ? '*Önbellekte yok*' : clip(oldMessage.content || '*Boş*') },
        { name: 'Sonra', value: clip(newMessage.content || '*Boş*') },
      )
      .setFooter({ text: `Biri • Mesaj ${newMessage.id}` });
    this.sink.enqueue(newMessage.guildId, 'MESSAGE', embed);
  }

  async messageBulkDelete(
    messages: ReadonlyCollection<Snowflake, Message | PartialMessage> | Collection<Snowflake, Message | PartialMessage>,
    channel: GuildTextBasedChannel,
  ): Promise<void> {
    const guild: Guild = channel.guild;
    if (!(await this.ready(guild.id))) return;
    const authors = new Map<string, number>();
    for (const message of messages.values()) {
      if (message.author) authors.set(message.author.id, (authors.get(message.author.id) ?? 0) + 1);
    }
    const embed = brandEmbed(COLORS.critical)
      .setTitle('🧹 Toplu Mesaj Silindi')
      .setDescription(`**Kanal:** <#${channel.id}>\n**Silinen mesaj:** ${messages.size}`);
    if (authors.size > 0) {
      const top = [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, count]) => `<@${id}> — ${count}`);
      embed.addFields({ name: 'Mesaj Sahipleri', value: clip(top.join('\n')) });
    }
    this.sink.enqueue(guild.id, 'MESSAGE', embed);
  }
}
