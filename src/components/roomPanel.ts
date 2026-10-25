import { MessageFlags, type GuildMember } from 'discord.js';
import { COLORS } from '../config/constants';
import type { App } from '../core/App';
import { brandEmbed } from '../modules/logging/embeds';
import { RoomManager, type RoomActionResult, type RoomContext } from '../modules/tempVoice/RoomManager';
import {
  buildCloseConfirmation,
  buildRoomPanel,
  buildSettingsModal,
  buildTransferMenu,
  buildUserManagement,
  isUserOperation,
  type UserOperation,
} from '../modules/tempVoice/panel';
import { validateCustomRoomName } from '../modules/tempVoice/roomNaming';
import type { ComponentHandler, ComponentInteraction } from '../types/command';
import { replyError, replyResult } from '../utils/interactions';

async function selectedMember(interaction: ComponentInteraction): Promise<GuildMember | null> {
  if (!interaction.isUserSelectMenu()) return null;
  const userId = interaction.values[0];
  if (!userId) return null;
  return interaction.members.get(userId) ?? (await interaction.guild.members.fetch(userId).catch(() => null));
}

function runUserOperation(rooms: RoomManager, operation: UserOperation, ctx: RoomContext, target: GuildMember): Promise<RoomActionResult> {
  switch (operation) {
    case 'kick':
      return rooms.disconnect(ctx, target);
    case 'block':
      return rooms.block(ctx, target);
    case 'unblock':
      return rooms.unblock(ctx, target);
    case 'allow':
      return rooms.allow(ctx, target);
    case 'disallow':
      return rooms.disallow(ctx, target);
  }
}

async function refreshPanel(interaction: ComponentInteraction, app: App, ctx: RoomContext, result: RoomActionResult): Promise<void> {
  if (!result.ok || !interaction.isButton()) return replyResult(interaction, result);
  const room = app.tempVoice.getRoom(ctx.channel.id) ?? ctx.room;
  const details = await app.rooms.details(ctx.channel.guild, room, ctx.channel);
  await interaction.update({ ...buildRoomPanel(room, ctx.channel, details), allowedMentions: { parse: [] } });
  await interaction.followUp({ embeds: [brandEmbed(COLORS.success).setDescription(result.message)], flags: MessageFlags.Ephemeral });
}

/**
 * Control panel interactions. Authorization is re-checked on every click:
 * the panel may be forwarded, stale, or the room may have changed owner.
 */
export const roomPanelHandler: ComponentHandler = {
  prefix: 'room',
  async handle(interaction, app, args) {
    const [action, ...rest] = args;
    const channelId = rest[rest.length - 1];
    if (!action || !channelId) return;

    const context = app.rooms.resolve(interaction.member, channelId);
    if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
    const rooms = app.rooms;

    switch (action) {
      case 'lock':
        return refreshPanel(interaction, app, context, await (context.room.locked ? rooms.unlock(context) : rooms.lock(context)));
      case 'hide':
        return refreshPanel(interaction, app, context, await (context.room.hidden ? rooms.show(context) : rooms.hide(context)));
      case 'users':
        await interaction.reply({ ...buildUserManagement(channelId), flags: MessageFlags.Ephemeral });
        return;
      case 'transfer':
        await interaction.reply({ ...buildTransferMenu(channelId), flags: MessageFlags.Ephemeral });
        return;
      case 'close':
        await interaction.reply({ ...buildCloseConfirmation(channelId), flags: MessageFlags.Ephemeral });
        return;
      case 'settings':
        if (!interaction.isButton()) return;
        await interaction.showModal(buildSettingsModal(channelId, context.channel.name, context.channel.userLimit));
        return;
      case 'closeNo':
        if (interaction.isButton()) await interaction.update({ embeds: [brandEmbed(COLORS.muted).setDescription('Oda kapatma iptal edildi.')], components: [] });
        return;
      case 'closeYes': {
        if (!interaction.isButton()) return;
        await interaction.deferUpdate();
        const result = await rooms.close(context);
        await interaction.editReply({
          embeds: [brandEmbed(result.ok ? COLORS.success : COLORS.critical).setDescription(result.message)],
          components: [],
        });
        return;
      }
      case 'user': {
        const operation = rest[0];
        if (!operation || !isUserOperation(operation)) return;
        const target = await selectedMember(interaction);
        if (!target) return replyError(interaction, 'Seçilen kullanıcı sunucuda bulunamadı.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return replyResult(interaction, await runUserOperation(rooms, operation, context, target));
      }
      case 'transferSelect': {
        const target = await selectedMember(interaction);
        if (!target) return replyError(interaction, 'Seçilen kullanıcı sunucuda bulunamadı.');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return replyResult(interaction, await rooms.transfer(context, target));
      }
      case 'settingsModal': {
        if (!interaction.isModalSubmit()) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const messages: string[] = [];
        let ok = true;
        const name = interaction.fields.getTextInputValue('name').trim();
        const normalized = name ? validateCustomRoomName(name) : null;
        if (normalized && (!normalized.ok || normalized.name !== context.channel.name)) {
          const result = await rooms.rename(context, name);
          ok &&= result.ok;
          messages.push(result.message);
        }
        const limitRaw = interaction.fields.getTextInputValue('limit').trim();
        if (limitRaw !== '' && Number(limitRaw) !== context.channel.userLimit) {
          const limit = Number(limitRaw);
          const result = await rooms.setLimit(context, Number.isInteger(limit) ? limit : -1);
          ok &&= result.ok;
          messages.push(result.message);
        }
        return replyResult(interaction, { ok, message: messages.join('\n') || 'Herhangi bir değişiklik yapılmadı.' });
      }
      default:
        return replyError(interaction, 'Bilinmeyen işlem.');
    }
  },
};
