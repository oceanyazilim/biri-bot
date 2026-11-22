import { MessageFlags } from 'discord.js';
import { COLORS } from '../config/constants';
import { brandEmbed } from '../modules/logging/embeds';
import { RoomManager } from '../modules/tempVoice/RoomManager';
import type { ComponentHandler } from '../types/command';
import { userMention } from '../utils/format';
import { replyError } from '../utils/interactions';

/**
 * İzin Ver / Reddet under the locked-room warning. Only the room owner decides;
 * the administrator override does not apply, otherwise staff could admit themselves.
 */
export const entryRequestHandler: ComponentHandler = {
  prefix: 'entry',
  async handle(interaction, app, [action, channelId, userId]) {
    if (!interaction.isButton() || !action || !channelId || !userId) return;
    const context = app.rooms.resolve(interaction.member, channelId);
    if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
    if (context.viaAdmin) return replyError(interaction, 'Bu kararı yalnızca oda sahibi verebilir.');
    const target = interaction.guild.members.cache.get(userId) ?? (await interaction.guild.members.fetch(userId).catch(() => null));
    if (!target) return replyError(interaction, 'Kullanıcı artık sunucuda değil.');

    if (action === 'deny') {
      await interaction.update({
        content: '',
        embeds: [brandEmbed(COLORS.muted).setDescription(`${userMention(context.actor.id)}, ${userMention(target.id)} kullanıcısının giriş isteğini reddetti.`)],
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (action !== 'allow') return;

    await interaction.deferUpdate();
    const allowed = await app.rooms.allow(context, target);
    if (!allowed.ok && !allowed.message.includes('zaten')) {
      await interaction.followUp({ embeds: [brandEmbed(COLORS.critical).setDescription(allowed.message)], flags: MessageFlags.Ephemeral });
      return;
    }
    // Bring them in right away when they are still in voice (usually their own new room).
    const pulled = target.voice.channelId && target.voice.channelId !== channelId ? await app.rooms.pull(context, target) : null;
    const suffix = pulled?.ok ? ' ve odaya çekildi' : '';
    await interaction.editReply({
      content: '',
      embeds: [brandEmbed(COLORS.success).setDescription(`${userMention(context.actor.id)}, ${userMention(target.id)} kullanıcısına izin verdi${suffix}.`)],
      components: [],
      allowedMentions: { parse: [] },
    });
  },
};
