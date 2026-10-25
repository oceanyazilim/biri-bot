import { Events, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';
import type { App } from '../../core/App';
import type { ComponentInteraction } from '../../types/command';
import { replyError } from '../../utils/interactions';
import { defineEvent } from '../types';

const COMPONENT_COOLDOWN_MS = 750;

function serializeOptions(interaction: ChatInputCommandInteraction<'cached'>): string {
  const flatten = (options: readonly { name: string; value?: unknown; options?: readonly unknown[] }[]): Record<string, unknown> =>
    Object.fromEntries(
      options.map((option) => [option.name, option.options ? flatten(option.options as typeof options) : (option.value ?? null)]),
    );
  return JSON.stringify(flatten(interaction.options.data));
}

async function handleCommand(app: App, interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const command = app.commands.get(interaction.commandName);
  if (!command) return replyError(interaction, 'Bu komut artık mevcut değil.');

  const remaining = app.cooldowns.consume(interaction.user.id, `cmd:${command.data.name}`, command.cooldownMs ?? app.env.COMMAND_COOLDOWN_MS);
  if (remaining > 0) return replyError(interaction, `Çok hızlısın! Bu komutu tekrar kullanmak için **${Math.ceil(remaining / 1000)} saniye** bekle.`);

  let error: unknown = null;
  try {
    await command.execute(interaction, app);
  } catch (caught) {
    error = caught;
    // A refusal the command already explained to the user: record it, but no second error message.
    if (!(caught instanceof Error && 'handled' in caught && caught.handled === true)) {
      app.logger.error({ err: caught, command: command.data.name, guildId: interaction.guildId }, 'Komut hatası');
      await replyError(interaction, 'Komut çalıştırılırken beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar dene.');
    }
  }
  app.health.increment('commands');
  await app.repos.commandAudit
    .record({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      command: command.data.name,
      options: serializeOptions(interaction),
      success: error === null,
      error: error instanceof Error ? error.message.slice(0, 500) : error === null ? null : String(error).slice(0, 500),
    })
    .catch((auditError: unknown) => app.logger.warn({ err: auditError }, 'Komut kaydı yazılamadı'));
}

async function handleComponent(app: App, interaction: ComponentInteraction): Promise<void> {
  const [namespace, prefix, ...args] = interaction.customId.split(':');
  if (namespace !== 'biri' || !prefix) return;
  const handler = app.components.get(prefix);
  if (!handler) return replyError(interaction, 'Bu düğme artık geçerli değil.');
  if (app.cooldowns.consume(interaction.user.id, 'component', COMPONENT_COOLDOWN_MS) > 0) {
    return replyError(interaction, 'Çok hızlı tıklıyorsun, lütfen biraz bekle.');
  }
  try {
    await handler.handle(interaction, app, args);
  } catch (error) {
    app.logger.error({ err: error, customId: interaction.customId }, 'Etkileşim hatası');
    await replyError(interaction, 'İşlem sırasında beklenmeyen bir hata oluştu.');
  }
}

export default defineEvent({
  name: Events.InteractionCreate,
  async execute(app, interaction) {
    if (!interaction.inCachedGuild()) {
      if (interaction.isRepliable()) {
        await interaction
          .reply({ content: 'Biri komutları yalnızca sunucularda kullanılabilir.', flags: MessageFlags.Ephemeral })
          .catch(() => undefined);
      }
      return;
    }
    if (interaction.isChatInputCommand()) return handleCommand(app, interaction);
    if (interaction.isAutocomplete()) {
      const command = app.commands.get(interaction.commandName);
      await command?.autocomplete?.(interaction, app).catch((error: unknown) => {
        app.logger.warn({ err: error, command: interaction.commandName }, 'Otomatik tamamlama hatası');
        return interaction.respond([]).catch(() => undefined);
      });
      return;
    }
    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) return handleComponent(app, interaction);
  },
});
