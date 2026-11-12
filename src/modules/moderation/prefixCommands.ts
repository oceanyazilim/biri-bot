import type { Message } from 'discord.js';
import { forgetBans } from '../../commands/moderation/unban';
import type { App } from '../../core/App';
import { clip } from '../../utils/format';
import { errorEmbed, successEmbed, warningEmbed } from '../logging/embeds';
import type { ModerationAction } from './ModerationService';
import { parsePrefixCommand, parseUserId } from './prefixParser';

const PREFIX_COOLDOWN_MS = 2_000;
/** Unlisted users are warned at most this often, so the warning cannot be used to spam a channel. */
const DENIED_WARNING_COOLDOWN_MS = 10_000;

export const NOT_ALLOWED_MESSAGE = 'Size bu yetki tanınmadı, lütfen denemeyiniz.';

interface PrefixCommand {
  action: ModerationAction;
  usage: string;
  title: string;
}

/** Keys are the folded names produced by the parser (`yargı` → `yargi`). */
export const PREFIX_COMMANDS: Record<string, PrefixCommand> = {
  yargi: { action: 'BAN', usage: 'yargi <ID | @kullanıcı> [sebep]', title: '⚖️ Yargılandı' },
  unyargi: { action: 'UNBAN', usage: 'unyargı <ID | @kullanıcı> [sebep]', title: '✅ Yargı Kaldırıldı' },
};

/**
 * Handles `.yargi` / `.unyargı`. Only users listed in YARGI_ALLOWED_USER_IDS may
 * use them; anyone else gets a (rate-limited) warning. Listed users still need
 * the Ban Members permission, which ModerationService checks. Other prefixed
 * messages are ignored silently.
 */
export async function handlePrefixMessage(app: App, message: Message<true>): Promise<void> {
  const prefix = app.env.PREFIX;
  const parsed = parsePrefixCommand(message.content, prefix);
  if (!parsed) return;
  const command = PREFIX_COMMANDS[parsed.name];
  if (!command) return;
  const label = `${prefix}${parsed.name}`;

  const reply = (embed: ReturnType<typeof errorEmbed>) =>
    message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false }, failIfNotExists: false }).catch(() => undefined);
  const audit = (success: boolean, options: Record<string, unknown>, errorText: string | null) =>
    app.repos.commandAudit
      .record({
        guildId: message.guildId,
        userId: message.author.id,
        command: label,
        options: JSON.stringify(options),
        success,
        error: errorText ? errorText.slice(0, 500) : null,
      })
      .catch((auditError: unknown) => app.logger.warn({ err: auditError }, 'Komut kaydı yazılamadı'));

  if (!app.env.YARGI_ALLOWED_USER_IDS.includes(message.author.id)) {
    if (app.cooldowns.consume(message.author.id, 'prefix:denied', DENIED_WARNING_COOLDOWN_MS) > 0) return;
    await reply(warningEmbed(NOT_ALLOWED_MESSAGE, '⛔ Yetkisiz İşlem'));
    await audit(false, { kullanici: parsed.args[0] ?? null }, 'Yargı yetki listesinde değil');
    return;
  }
  const moderator = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!moderator) return;

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
  await audit(success, { kullanici: targetId, sebep: reason || null }, errorText);
}
