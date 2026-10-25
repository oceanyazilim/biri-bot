import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RepliableInteraction,
} from 'discord.js';
import { MODE_LABELS, MODULE_LABELS } from '../../config/constants';
import type { App } from '../../core/App';
import { GUARD_MODULES, isGuardModule, type GuardModule, type ProtectionMode } from '../../types/guard';
import { replyError } from '../../utils/interactions';

export function guardCommandBuilder(name: string, description: string): SlashCommandBuilder {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
}

export const MODULE_CHOICES = GUARD_MODULES.map((module) => ({ name: MODULE_LABELS[module], value: module }));

export const MODE_CHOICES: Array<{ name: string; value: ProtectionMode }> = [
  { name: 'İzleme — yalnızca kayıt', value: 'MONITOR' },
  { name: 'Uyarı — kayıt + yönetici bildirimi', value: 'ALERT' },
  { name: 'Aktif — eşik aşılınca yönetilebilir rolleri al', value: 'ACTIVE' },
];

export function modeLabel(mode: ProtectionMode): string {
  return MODE_LABELS[mode];
}

export function moduleOption(interaction: ChatInputCommandInteraction<'cached'>): GuardModule | null {
  const value = interaction.options.getString('modul', true);
  return isGuardModule(value) ? value : null;
}

/** Any member with the Administrator permission (read-only Guard commands). */
export async function requireAdministrator(interaction: ChatInputCommandInteraction<'cached'>): Promise<boolean> {
  if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  await replyError(interaction, 'Bu komutu yalnızca **Yönetici** yetkisine sahip üyeler kullanabilir.');
  return false;
}

/** Server owner or an administrator explicitly authorised via /guard-yetkili. */
export async function requireGuardManager(interaction: RepliableInteraction<'cached'>, app: App): Promise<boolean> {
  if (await app.trust.isGuardManager(interaction.member)) return true;
  await replyError(
    interaction,
    'Bu işlem yalnızca **sunucu sahibi** veya sunucu sahibinin `/guard-yetkili` ile yetkilendirdiği yöneticiler tarafından yapılabilir.',
  );
  return false;
}

export async function requireOwner(interaction: ChatInputCommandInteraction<'cached'>): Promise<boolean> {
  if (interaction.user.id === interaction.guild.ownerId) return true;
  await replyError(interaction, 'Bu komutu yalnızca **sunucu sahibi** kullanabilir.');
  return false;
}
