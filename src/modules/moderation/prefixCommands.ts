import { PermissionFlagsBits, type Message } from 'discord.js';
import { forgetBans } from '../../commands/moderation/unban';
import type { App } from '../../core/App';
import { clip } from '../../utils/format';
import { errorEmbed, successEmbed } from '../logging/embeds';
import type { ModerationAction } from './ModerationService';
import { parsePrefixCommand, parseUserId } from './prefixParser';

const PREFIX_COOLDOWN_MS = 2_000;

interface PrefixCommand {
  action: ModerationAction;
  permission: bigint;
  usage: string;
  title: string;
}

/** Keys are the folded names produced by the parser (`yargı` → `yargi`). */
export const PREFIX_COMMANDS: Record<string, PrefixCommand> = {
  yargi: { action: 'BAN', permission: PermissionFlagsBits.BanMembers, usage: 'yargi <ID | @kullanıcı> [sebep]', title: '⚖️ Yargılandı' },
  unyargi: { action: 'UNBAN', permission: PermissionFlagsBits.BanMembers, usage: 'unyargı <ID | @kullanıcı> [sebep]', title: '✅ Yargı Kaldırıldı' },
};

/**
 * Handles `.yargi` / `.unyargı`. Other prefixed messages, and members without
 * the permission, are ignored silently so the bot cannot be made to spam replies.
 */
export async function handlePrefixMessage(app: App, message: Message<true>): Promise<void> {
  const prefix = app.env.PREFIX;
  const parsed = parsePrefixCommand(message.content, prefix);
  if (!parsed) return;
  const command = PREFIX_COMMANDS[parsed.name];
  if (!command) return;
  const moderator = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!moderator?.permissions.has(command.permission)) return;

  const reply = (embed: ReturnType<typeof errorEmbed>) =>
    message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false }, failIfNotExists: false }).catch(() => undefined);

  const targetId = parseUserId(parsed.args[0]);
  if (!targetId) {
    await reply(errorEmbed(`Kullanım: \`${prefix}${command.usage}\`\nSebep yazmak zorunlu değildir.`, '❔ Eksik veya geçersiz kullanıcı'));
    return;
  }
  if (app.cooldowns.consume(message.author.id, `prefix:${parsed.name}`, PREFIX_COOLDOWN_MS) > 0) {
    await reply(errorEmbed('Çok hızlısın, lütfen birkaç saniye bekle.'));
    return;
  }
  const reason = parsed.args.slice(1).join(' ').trim();
  const label = `${prefix}${parsed.name}`;

  let success = false;
  let errorText: string | null = null;
  try {
    forgetBans(message.guildId);
    const result = await app.moderation.execute({
      action: command.action,
      guild: message.guild,
      moderator,
      targetId,
      reason: reason ? clip(reason, 400) : null,
      invocationId: message.id,
      command: label,
    });
    success = result.ok;
    if (!result.ok) errorText = result.message;
    await reply(result.ok ? successEmbed(result.message, command.title) : errorEmbed(result.message));
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error);
    app.logger.error({ err: error, guildId: message.guildId, command: label }, 'Prefix komutu hatası');
    await reply(errorEmbed('Komut çalıştırılırken beklenmeyen bir hata oluştu.'));
  }

  app.health.increment('commands');
  await app.repos.commandAudit
    .record({
      guildId: message.guildId,
      userId: message.author.id,
      command: label,
      options: JSON.stringify({ kullanici: targetId, sebep: reason || null }),
      success,
      error: errorText ? errorText.slice(0, 500) : null,
    })
    .catch((auditError: unknown) => app.logger.warn({ err: auditError }, 'Komut kaydı yazılamadı'));
}
