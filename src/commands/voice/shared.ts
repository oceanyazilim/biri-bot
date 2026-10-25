import { InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from 'discord.js';
import type { App } from '../../core/App';
import { RoomManager, type RoomActionResult, type RoomContext } from '../../modules/tempVoice/RoomManager';
import type { SlashCommand } from '../../types/command';
import { replyError, replyResult } from '../../utils/interactions';

export function voiceCommandBuilder(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild);
}

/** Resolves the caller's room and runs a room action, replying ephemerally with the result. */
export async function runRoomAction(
  interaction: ChatInputCommandInteraction<'cached'>,
  app: App,
  action: (ctx: RoomContext) => Promise<RoomActionResult>,
): Promise<void> {
  const context = app.rooms.resolve(interaction.member);
  if (!RoomManager.isContext(context)) return replyError(interaction, context.message);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await action(context);
  await replyResult(interaction, result);
}

/** Fetches the member chosen in the `kullanici` option. */
export async function targetMember(interaction: ChatInputCommandInteraction<'cached'>): Promise<GuildMember | null> {
  const user = interaction.options.getUser('kullanici', true);
  return interaction.options.getMember('kullanici') ?? (await interaction.guild.members.fetch(user.id).catch(() => null));
}

type MemberAction = (rooms: RoomManager, ctx: RoomContext, target: GuildMember) => Promise<RoomActionResult>;

/** Builds a `/komut @kullanici` style room command. */
export function memberRoomCommand(name: string, description: string, optionDescription: string, action: MemberAction): SlashCommand {
  return {
    category: 'voice',
    data: voiceCommandBuilder(name, description).addUserOption((option) =>
      option.setName('kullanici').setDescription(optionDescription).setRequired(true),
    ),
    async execute(interaction, app) {
      const target = await targetMember(interaction);
      if (!target) return replyError(interaction, 'Seçilen kullanıcı bu sunucuda bulunamadı.');
      await runRoomAction(interaction, app, (ctx) => action(app.rooms, ctx, target));
    },
  };
}

/** Builds an option-less room command. */
export function simpleRoomCommand(name: string, description: string, action: (rooms: RoomManager, ctx: RoomContext) => Promise<RoomActionResult>): SlashCommand {
  return {
    category: 'voice',
    data: voiceCommandBuilder(name, description),
    async execute(interaction, app) {
      await runRoomAction(interaction, app, (ctx) => action(app.rooms, ctx));
    },
  };
}
