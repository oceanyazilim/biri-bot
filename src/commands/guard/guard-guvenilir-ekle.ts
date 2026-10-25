import type { SlashCommand } from '../../types/command';
import type { TrustedType } from '../../types/guard';
import { roleMention, userMention } from '../../utils/format';
import { replyError, replySuccess } from '../../utils/interactions';
import { guardCommandBuilder, requireGuardManager } from './shared';

const command: SlashCommand = {
  category: 'guard',
  data: guardCommandBuilder('guard-guvenilir-ekle', 'Otomatik yaptırımlardan muaf tutulacak kullanıcı, bot veya rol ekler')
    .addUserOption((option) => option.setName('kullanici').setDescription('Güvenilir kullanıcı veya bot'))
    .addRoleOption((option) => option.setName('rol').setDescription('Güvenilir rol'))
    .addStringOption((option) => option.setName('not').setDescription('Neden güvenilir? (isteğe bağlı)').setMaxLength(200)),
  async execute(interaction, app) {
    if (!(await requireGuardManager(interaction, app))) return;
    const user = interaction.options.getUser('kullanici');
    const role = interaction.options.getRole('rol');
    const note = interaction.options.getString('not');
    if ((user ? 1 : 0) + (role ? 1 : 0) !== 1) return replyError(interaction, 'Bir kullanıcı **veya** bir rol seçmelisin (ikisi birden değil).');

    const isOwner = interaction.user.id === interaction.guild.ownerId;
    let targetId: string;
    let type: TrustedType;
    let label: string;

    if (user) {
      // Self-exemption would let a compromised admin nuke without consequences.
      if (!isOwner && user.id === interaction.user.id) return replyError(interaction, 'Kendini güvenilir listeye ekleyemezsin. Bunu yalnızca sunucu sahibi yapabilir.');
      if (user.id === interaction.client.user.id) return replyError(interaction, 'Biri zaten kendi işlemlerini yaptırımdan muaf tutar.');
      targetId = user.id;
      type = user.bot ? 'BOT' : 'USER';
      label = `${user.bot ? '🤖 Bot' : '👤 Kullanıcı'} ${userMention(user.id)}`;
    } else {
      const chosen = role!;
      if (chosen.id === interaction.guildId) return replyError(interaction, '@everyone rolü güvenilir olarak eklenemez.');
      if (!isOwner && interaction.member.roles.cache.has(chosen.id)) {
        return replyError(interaction, 'Sahip olduğun bir rolü güvenilir listeye ekleyemezsin. Bunu yalnızca sunucu sahibi yapabilir.');
      }
      targetId = chosen.id;
      type = 'ROLE';
      label = `🎭 Rol ${roleMention(chosen.id)}`;
    }

    const added = await app.trust.add(interaction.guildId, targetId, type, interaction.user.id, note);
    if (!added) return replyError(interaction, `${label} zaten güvenilir listede.`);
    await app.reporter.recordConfigChange(interaction.guild, interaction.user.id, `Güvenilir listeye eklendi: ${label}`, { targetId, type });
    await replySuccess(
      interaction,
      `${label} güvenilir listeye eklendi.\nYaptığı önemli işlemler kaydedilmeye devam eder ancak otomatik yaptırım uygulanmaz.`,
      '🤝 Güvenilir Eklendi',
    );
  },
};

export default command;
