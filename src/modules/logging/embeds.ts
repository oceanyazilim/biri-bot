import { EmbedBuilder } from 'discord.js';
import { BOT_NAME, COLORS } from '../../config/constants';

export function brandEmbed(color: number = COLORS.primary): EmbedBuilder {
  return new EmbedBuilder().setColor(color).setFooter({ text: BOT_NAME }).setTimestamp(new Date());
}

export function successEmbed(description: string, title = '✅ İşlem Başarılı'): EmbedBuilder {
  return brandEmbed(COLORS.success).setTitle(title).setDescription(description);
}

export function errorEmbed(description: string, title = '❌ İşlem Başarısız'): EmbedBuilder {
  return brandEmbed(COLORS.critical).setTitle(title).setDescription(description);
}

export function warningEmbed(description: string, title = '⚠️ Uyarı'): EmbedBuilder {
  return brandEmbed(COLORS.warning).setTitle(title).setDescription(description);
}

export function infoEmbed(description: string, title?: string): EmbedBuilder {
  const embed = brandEmbed(COLORS.primary).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}
