import { MessageFlags, type EmbedBuilder, type RepliableInteraction } from 'discord.js';
import { errorEmbed, successEmbed } from '../modules/logging/embeds';

/** Replies or follows up depending on the interaction state; never throws. */
export async function respond(
  interaction: RepliableInteraction,
  embed: EmbedBuilder,
  options: { ephemeral?: boolean } = {},
): Promise<void> {
  const payload = {
    embeds: [embed],
    allowedMentions: { parse: [] as [] },
    ...(options.ephemeral === false ? {} : { flags: MessageFlags.Ephemeral as const }),
  };
  try {
    if (interaction.deferred && !interaction.replied) await interaction.editReply({ embeds: payload.embeds, allowedMentions: payload.allowedMentions });
    else if (interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {
    // The interaction token may have expired; nothing else we can do.
  }
}

export function replyError(interaction: RepliableInteraction, message: string): Promise<void> {
  return respond(interaction, errorEmbed(message));
}

export function replySuccess(interaction: RepliableInteraction, message: string, title?: string): Promise<void> {
  return respond(interaction, successEmbed(message, title));
}

export function replyResult(interaction: RepliableInteraction, result: { ok: boolean; message: string }): Promise<void> {
  return result.ok ? replySuccess(interaction, result.message) : replyError(interaction, result.message);
}
