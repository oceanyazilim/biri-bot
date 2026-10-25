import { Events } from 'discord.js';
import { COLORS } from '../../config/constants';
import { brandEmbed } from '../../modules/logging/embeds';
import { userMention } from '../../utils/format';
import { defineEvent } from '../types';

export const guildBanAdd = defineEvent({
  name: Events.GuildBanAdd,
  async execute(app, ban) {
    await app.guard.onBanAdd(ban);
  },
});

/** Requires the Server Members intent (ENABLE_GUILD_MEMBERS_INTENT=true). */
export const guildMemberRemove = defineEvent({
  name: Events.GuildMemberRemove,
  async execute(app, member) {
    await app.guard.onMemberRemove(member);
  },
});

/** Requires the Server Members intent. Bot additions are attributed through the BotAdd audit entry. */
export const guildMemberAdd = defineEvent({
  name: Events.GuildMemberAdd,
  async execute(app, member) {
    if (!member.user.bot) return;
    const trusted = await app.trust.isTrustedBot(member.guild.id, member.id).catch(() => false);
    app.logDispatcher.enqueue(
      member.guild.id,
      'MEMBER',
      brandEmbed(trusted ? COLORS.info : COLORS.warning)
        .setTitle(trusted ? '🤖 Güvenilir Bot Katıldı' : '🤖 Bilinmeyen Bot Katıldı')
        .setDescription(`${userMention(member.id)} (\`${member.user.tag}\`) sunucuya eklendi.`),
    );
  },
});
