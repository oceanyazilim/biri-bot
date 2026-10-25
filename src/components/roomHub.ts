import { MessageFlags } from 'discord.js';
import { RoomManager, type RoomActionResult } from '../modules/tempVoice/RoomManager';
import {
  buildCloseConfirmation,
  buildSettingsModal,
  buildTransferMenu,
  buildUserPicker,
  isUserOperation,
  roomInfoEmbed,
} from '../modules/tempVoice/panel';
import type { ComponentHandler } from '../types/command';
import { replyError, replyResult } from '../utils/interactions';

/**
 * Buttons of the persistent control panel. They carry no room id: the room is
 * resolved from the clicking member on every click (their current room, or the
 * room they own), with the same ownership checks as slash commands.
 */
export const roomHubHandler: ComponentHandler = {
  prefix: 'hub',
  async handle(interaction, app, [action]) {
    if (!interaction.isButton() || !action) return;
    const context = app.rooms.resolve(interaction.member);
    if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
    const rooms = app.rooms;
    const channelId = context.channel.id;

    const run = async (task: () => Promise<RoomActionResult>) => {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await replyResult(interaction, await task());
    };

    switch (action) {
      case 'lock':
        return run(() => rooms.lock(context));
      case 'unlock':
        return run(() => rooms.unlock(context));
      case 'hide':
        return run(() => rooms.hide(context));
      case 'show':
        return run(() => rooms.show(context));
      case 'info': {
        const details = await rooms.details(context.channel.guild, context.room, context.channel);
        await interaction.reply({
          embeds: [roomInfoEmbed(context.room, context.channel, details)],
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        });
        return;
      }
      case 'settings':
        // A modal must be the first response to the interaction.
        await interaction.showModal(buildSettingsModal(channelId, context.channel.name, context.channel.userLimit));
        return;
      case 'transfer':
        await interaction.reply({ ...buildTransferMenu(channelId), flags: MessageFlags.Ephemeral });
        return;
      case 'close':
        await interaction.reply({ ...buildCloseConfirmation(channelId), flags: MessageFlags.Ephemeral });
        return;
      default:
        if (isUserOperation(action)) {
          await interaction.reply({ ...buildUserPicker(action, channelId), flags: MessageFlags.Ephemeral });
          return;
        }
        return replyError(interaction, 'Bilinmeyen işlem.');
    }
  },
};
