import type { Message } from 'discord.js';
import type { App } from '../../core/App';
import { clip } from '../../utils/format';
import { errorEmbed, successEmbed } from '../logging/embeds';
import type { ModerationAction } from './ModerationService';
import { parsePrefixCommand, parseUserId } from './prefixParser';

const PREFIX_COOLDOWN_MS = 2_000;

const COMMANDS: Record<string, { action: ModerationAction; usage: string; title: string }> = {
  ban: { action: 'BAN', usage: 'ban <@kullanıcı | ID> [sebep]', title: '🔨 Yasaklandı' },
  kick: { action: 'KICK', usage: 'kick <@kullanıcı | ID> [sebep]', title: '👢 Atıldı' },
  unban: { action: 'UNBAN', usage: 'unban <ID> [sebep]', title: '✅ Yasak Kaldırıldı' },
};

/** Handles `.ban` / `.kick` messages. Unknown prefixed messages are ignored silently. */
export async function handlePrefixMessage(app: App, message: Message<true>): Promise<void> {
  const parsed = parsePrefixCommand(message.content, app.env.PREFIX);
  if (!parsed) return;
  const command = COMMANDS[parsed.name];
  if (!command) return;

  const reply = (embed: ReturnType<typeof errorEmbed>) =>
    message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false }, failIfNotExists: false }).catch(() => undefined);

  if (app.cooldowns.consume(message.author.id, `prefix:${parsed.name}`, PREFIX_COOLDOWN_MS) > 0) {
    await reply(errorEmbed('Çok hızlısın, lütfen birkaç saniye bekle.'));
    return;
  }
  const targetId = parseUserId(parsed.args[0]);
  if (!targetId) {
    await reply(errorEmbed(`Kullanım: \`${app.env.PREFIX}${command.usage}\``));
    return;
  }
  const moderator = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!moderator) return;
  const reason = parsed.args.slice(1).join(' ').trim();

  let success = false;
  let errorText: string | null = null;
  try {
    const result = await app.moderation.execute({
      action: command.action,
      guild: message.guild,
      moderator,
      targetId,
      reason: reason ? clip(reason, 400) : null,
      invocationId: message.id,
    });
    success = result.ok;
    if (!result.ok) errorText = result.message;
    await reply(result.ok ? successEmbed(result.message, command.title) : errorEmbed(result.message));
  } catch (error) {
    errorText = error instanceof Error ? error.message : String(error);
    app.logger.error({ err: error, guildId: message.guildId }, 'Prefix komutu hatası');
    await reply(errorEmbed('Komut çalıştırılırken beklenmeyen bir hata oluştu.'));
  }

  await app.repos.commandAudit
    .record({
      guildId: message.guildId,
      userId: message.author.id,
      command: `${app.env.PREFIX}${parsed.name}`,
      options: JSON.stringify({ targetId, reason: reason || null }),
      success,
      error: errorText ? errorText.slice(0, 500) : null,
    })
    .catch(() => undefined);
}
