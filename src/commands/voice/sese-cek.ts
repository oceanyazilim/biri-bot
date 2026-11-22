import { MessageFlags } from 'discord.js';
import { RoomManager } from '../../modules/tempVoice/RoomManager';
import type { SlashCommand } from '../../types/command';
import { replyError, replyResult } from '../../utils/interactions';
import { targetMember, voiceCommandBuilder } from './shared';

const command: SlashCommand = {
  category: 'voice',
  data: voiceCommandBuilder('sese-cek', 'Başka bir ses kanalındaki kullanıcıyı odana çeker (oda kilitliyken de çalışır)').addUserOption((option) =>
    option.setName('kullanici').setDescription('Odana çekilecek kullanıcı').setRequired(true),
  ),
  async execute(interaction, app) {
    const target = await targetMember(interaction);
    if (!target) return replyError(interaction, 'Seçilen kullanıcı bu sunucuda bulunamadı.');
    const context = app.rooms.resolveOwned(interaction.member);
    if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await replyResult(interaction, await app.rooms.pull(context, target));
  },
};

export default command;
