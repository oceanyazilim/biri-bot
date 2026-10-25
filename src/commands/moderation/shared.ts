import { InteractionContextType, MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { App } from '../../core/App';
import { errorEmbed, successEmbed } from '../../modules/logging/embeds';
import type { ModerationRequest } from '../../modules/moderation/ModerationService';
import { clip } from '../../utils/format';

export function moderationCommandBuilder(name: string, description: string, permission: bigint): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    // Hidden from members without the permission; ModerationService re-checks it anyway.
    .setDefaultMemberPermissions(permission);
}

/** Runs a moderation action and replies privately with the outcome. */
export async function runModeration(
  interaction: ChatInputCommandInteraction<'cached'>,
  app: App,
  request: Omit<ModerationRequest, 'guild' | 'moderator' | 'invocationId'>,
  successTitle: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await app.moderation.execute({
    ...request,
    reason: request.reason ? clip(request.reason, 400) : null,
    guild: interaction.guild,
    moderator: interaction.member,
    invocationId: interaction.id,
  });
  await interaction.editReply({
    embeds: [result.ok ? successEmbed(result.message, successTitle) : errorEmbed(result.message)],
    allowedMentions: { parse: [] },
  });
  if (!result.ok) throw new ModerationRefused(result.message);
}

/** Marks the command as unsuccessful in the command audit log without showing a second error. */
export class ModerationRefused extends Error {
  readonly handled = true;
}
