import { MessageFlags } from 'discord.js';
import { brandEmbed } from '../../modules/logging/embeds';
import type { SlashCommand } from '../../types/command';
import { clip, discordTimestamp, roleMention, userMention } from '../../utils/format';
import { guardCommandBuilder, requireAdministrator } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-guvenilir-liste', 'Güvenilir kullanıcı, bot ve rolleri listeler'),
  async execute(interaction, app) {
    if (!(await requireAdministrator(interaction))) return;
    const [rows, managers] = await Promise.all([app.trust.list(interaction.guildId), app.trust.managers(interaction.guildId)]);
    const line = (row: (typeof rows)[number]) =>
      `${row.type === 'ROLE' ? roleMention(row.targetId) : userMention(row.targetId)} — ekleyen ${userMention(row.addedById)} ${discordTimestamp(row.createdAt, 'R')}${row.note ? `\n  ↳ ${row.note}` : ''}`;
    const section = (type: string) => rows.filter((row) => row.type === type).map(line).join('\n') || 'Yok';

    const embed = brandEmbed()
      .setTitle('🤝 Biri Guard • Güvenilir Liste')
      .setDescription(`👑 Sunucu sahibi (${userMention(interaction.guild.ownerId)}) her zaman muaftır.`)
      .addFields(
        { name: '👤 Kullanıcılar', value: clip(section('USER')) },
        { name: '🤖 Botlar', value: clip(section('BOT')) },
        { name: '🎭 Roller', value: clip(section('ROLE')) },
        { name: '🛡️ Guard Yöneticileri', value: clip(managers.map((m) => userMention(m.userId)).join(', ') || 'Yok (yalnızca sunucu sahibi)') },
      );
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};

export default command;
