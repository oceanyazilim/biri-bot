import { PermissionFlagsBits, type AutocompleteInteraction, type Guild } from 'discord.js';
import type { SlashCommand } from '../../types/command';
import { BoundedTtlMap } from '../../utils/collections';
import { replyError } from '../../utils/interactions';
import { moderationCommandBuilder, runModeration } from './shared';

interface BanEntry {
  id: string;
  label: string;
}

/** Ban lists are cached briefly so typing in the autocomplete box does not refetch on every key. */
const banCache = new BoundedTtlMap<string, Promise<BanEntry[]>>(500, 30_000);

/** Call after the ban list changed. */
export function forgetBans(guildId: string): void {
  banCache.delete(guildId);
}

function bansOf(guild: Guild): Promise<BanEntry[]> {
  const cached = banCache.get(guild.id);
  if (cached) return cached;
  const request = guild.bans
    .fetch({ limit: 1000 })
    .then((bans) => [...bans.values()].map((ban) => ({ id: ban.user.id, label: `${ban.user.tag}${ban.reason ? ` — ${ban.reason}` : ''}` })))
    .catch(() => [] as BanEntry[]);
  banCache.set(guild.id, request);
  return request;
}

/** Suggests banned users matching what the moderator typed (name, tag, reason or id). */
export async function suggestBans(interaction: AutocompleteInteraction<'cached'>): Promise<void> {
  const query = interaction.options.getFocused().toLocaleLowerCase('tr-TR');
  const bans = await bansOf(interaction.guild);
  const matches = bans
    .filter((ban) => !query || ban.id.includes(query) || ban.label.toLocaleLowerCase('tr-TR').includes(query))
    .slice(0, 25)
    .map((ban) => ({ name: `${ban.label} (${ban.id})`.slice(0, 100), value: ban.id }));
  await interaction.respond(matches);
}

const command: SlashCommand = {
  category: 'moderation',
  data: moderationCommandBuilder('unban', 'Bir kullanıcının yasağını kaldırır', PermissionFlagsBits.BanMembers)
    .addStringOption((option) =>
      option.setName('kullanici').setDescription('Yasaklı kullanıcı (yazmaya başlayın, liste açılır) veya ID').setRequired(true).setAutocomplete(true),
    )
    .addStringOption((option) => option.setName('sebep').setDescription('Yasağı kaldırma sebebi').setMaxLength(400)),
  async execute(interaction, app) {
    const raw = interaction.options.getString('kullanici', true).trim();
    const id = /^<@!?(\d{17,20})>$/.exec(raw)?.[1] ?? /^(\d{17,20})$/.exec(raw)?.[1];
    if (!id) return replyError(interaction, 'Listeden bir kullanıcı seçin veya geçerli bir kullanıcı ID’si yazın.');
    forgetBans(interaction.guildId);
    await runModeration(interaction, app, { action: 'UNBAN', targetId: id, reason: interaction.options.getString('sebep') }, '✅ Yasak Kaldırıldı');
  },
  autocomplete: suggestBans,
};

export default command;
