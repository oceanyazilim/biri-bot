import { RETENTION_SWEEP_INTERVAL_MS, STALE_SWEEP_INTERVAL_MS } from './config/constants';
import { loadEnv, type Env } from './config/env';
import type { App } from './core/App';
import { createApp } from './core/createApp';
import { registerEvents } from './events';
import { deployCommands } from './services/commandDeployer';
import { createLogger, type Logger } from './utils/logger';

function startBackgroundJobs(app: App): () => void {
  const staleSweep = setInterval(() => {
    for (const guild of app.client.guilds.cache.values()) {
      app.tempVoice.sweep(guild).catch((error: unknown) => app.logger.warn({ err: error, guildId: guild.id }, 'Oda temizliği başarısız'));
    }
  }, STALE_SWEEP_INTERVAL_MS);
  const retention = setInterval(() => {
    void app.guard.maintenance(app.client.guilds.cache.values());
  }, RETENTION_SWEEP_INTERVAL_MS);
  staleSweep.unref();
  retention.unref();
  return () => {
    clearInterval(staleSweep);
    clearInterval(retention);
  };
}

const isDisallowedIntents = (error: unknown): boolean => error instanceof Error && /disallowed intents/i.test(error.message);

/** Builds the app, connects to the database and logs in. Cleans up after itself when login fails. */
async function boot(env: Env, logger: Logger): Promise<App> {
  const app = createApp(env, logger);
  await app.prisma.$connect();
  registerEvents(app);
  app.client.on('error', (error) => logger.error({ err: error }, 'Discord istemci hatası'));
  app.client.on('shardDisconnect', (event, shardId) => logger.warn({ code: event.code, shardId }, 'Gateway bağlantısı koptu'));
  app.client.on('shardReconnecting', (shardId) => logger.info({ shardId }, 'Gateway yeniden bağlanıyor'));
  try {
    await app.client.login(env.DISCORD_TOKEN);
    return app;
  } catch (error) {
    await app.client.destroy().catch(() => undefined);
    await app.prisma.$disconnect().catch(() => undefined);
    throw error;
  }
}

/**
 * Logs in; when Discord refuses the Message Content intent, starts again
 * without the features that need it, so the rest of Biri keeps running.
 */
async function bootWithFallback(env: Env, logger: Logger): Promise<App> {
  try {
    return await boot(env, logger);
  } catch (error) {
    if (!isDisallowedIntents(error)) throw error;
    if (env.ENABLE_PREFIX_COMMANDS || env.ENABLE_MESSAGE_LOGS) {
      logger.warn(
        'Discord "Message Content Intent" iznini vermedi. Prefix komutları (.yargi, .unyargı) ve mesaj logları KAPALI olarak başlatılıyor. ' +
          'Açmak için: Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent.',
      );
      try {
        return await boot({ ...env, ENABLE_PREFIX_COMMANDS: false, ENABLE_MESSAGE_LOGS: false }, logger);
      } catch (retryError) {
        if (!isDisallowedIntents(retryError)) throw retryError;
      }
    }
    throw new Error(
      'Discord ayrıcalıklı intent izni vermedi. Developer Portal → Bot → Privileged Gateway Intents bölümünden ' +
        `${env.ENABLE_GUILD_MEMBERS_INTENT ? '"Server Members Intent" ' : ''}ayarını açın ya da ENABLE_GUILD_MEMBERS_INTENT=false yapın.`,
    );
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  if (env.AUTO_DEPLOY_COMMANDS) {
    await deployCommands({ token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId: env.DEV_GUILD_ID }, logger).catch((error: unknown) =>
      logger.error({ err: error }, 'Slash komutları otomatik kaydedilemedi; `npm run deploy-commands` deneyin'),
    );
  }

  const app = await bootWithFallback(env, logger);
  logger.info('Veritabanı ve Discord bağlantısı kuruldu');
  app.logDispatcher.start();
  app.health.listen(env.HEALTH_PORT);
  const stopJobs = startBackgroundJobs(app);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Kapatılıyor…');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    stopJobs();
    app.tempVoice.shutdown();
    app.logChannels.shutdown();
    await app.logDispatcher.stop().catch(() => undefined);
    await app.health.close().catch(() => undefined);
    await app.client.destroy().catch(() => undefined);
    await app.prisma.$disconnect().catch(() => undefined);
    logger.info('Biri kapatıldı');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Yakalanmamış promise reddi'));
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Yakalanmamış hata');
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
