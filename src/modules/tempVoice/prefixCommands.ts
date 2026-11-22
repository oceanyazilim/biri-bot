import type { Message } from 'discord.js';
import type { App } from '../../core/App';
import { errorEmbed, successEmbed } from '../logging/embeds';
import { parseUserId } from '../moderation/prefixParser';
import { RoomManager } from './RoomManager';

const PULL_COOLDOWN_MS = 3_000;

/** Folded command names (see parsePrefixCommand) that mean `sese-cek`. */
export const PULL_COMMAND_NAMES: ReadonlySet<string> = new Set(['sese-cek', 'sese-çek', 'sesecek', 'seseçek']);

/** `.sese-cek <@kullanıcı | ID>`: the room owner pulls a member from another voice channel into their room. */
export async function handlePullPrefix(app: App, message: Message<true>, args: string[]): Promise<void> {
  const prefix = app.env.PREFIX;
  const reply = (embed: ReturnType<typeof errorEmbed>) =>
    message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false }, failIfNotExists: false }).catch(() => undefined);

  const targetId = parseUserId(args[0]);
  if (!targetId) {
    await reply(errorEmbed(`Kullanım: \`${prefix}sese-cek <@kullanıcı | ID>\`\nKullanıcı başka bir ses kanalında olmalı.`, 'Eksik veya geçersiz kullanıcı'));
    return;
  }
  if (app.cooldowns.consume(message.author.id, 'prefix:sese-cek', PULL_COOLDOWN_MS) > 0) {
    await reply(errorEmbed('Çok hızlısın, lütfen birkaç saniye bekle.'));
    return;
  }
  const actor = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!actor) return;
  if (!target) {
    await reply(errorEmbed('Bu kullanıcı sunucuda bulunamadı.'));
    return;
  }
  const context = app.rooms.resolveOwned(actor);
  const result = RoomManager.isContext(context) ? await app.rooms.pull(context, target) : context;
  await reply(result.ok ? successEmbed(result.message, 'Odaya Çekildi') : errorEmbed(result.message));
  app.health.increment('commands');
  await app.repos.commandAudit
    .record({
      guildId: message.guildId,
      userId: message.author.id,
      command: `${prefix}sese-cek`,
      options: JSON.stringify({ kullanici: targetId }),
      success: result.ok,
      error: result.ok ? null : result.message.slice(0, 500),
    })
    .catch((error: unknown) => app.logger.warn({ err: error }, 'Komut kaydı yazılamadı'));
}
