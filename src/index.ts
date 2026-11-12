import { RETENTION_SWEEP_INTERVAL_MS, STALE_SWEEP_INTERVAL_MS } from './config/constants';
import { loadEnv, type Env } from './config/env';
import type { App } from './core/App';
import { createApp } from './core/createApp';
import { registerEvents } from './events';
import { deployCommands } from './services/commandDeployer';
import { fetchPrivilegedIntents, fitToPrivilegedIntents } from './services/privilegedIntents';
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
 * Logs in with only the privileged intents enabled in the Developer Portal.
 * If Discord still refuses (the portal could not be read, or a switch changed
 * meanwhile), starts once more without any privileged intent so that temp
 * rooms, Guard and slash commands keep running.
 */
async function bootWithFallback(configured: Env, logger: Logger): Promise<App> {
  let env = configured;
  const available = await fetchPrivilegedIntents(configured.DISCORD_TOKEN);
  if (available) {
    const fitted = fitToPrivilegedIntents(configured, available);
    for (const warning of fitted.warnings) logger.warn(warning);
    env = fitted.env;
  } else {
    logger.warn('Discord uygulama ayarları okunamadı; intent kontrolü bağlantı sırasında yapılacak.');
  }

  try {
    return await boot(env, logger);
  } catch (error) {
    if (!isDisallowedIntents(error)) throw error;
    const bare = { ...env, ENABLE_PREFIX_COMMANDS: false, ENABLE_MESSAGE_LOGS: false, ENABLE_GUILD_MEMBERS_INTENT: false };
    logger.warn(
      'Discord ayrıcalıklı intent iznini vermedi (4014). Biri; prefix komutları, mesaj logları ve üye logları KAPALI olarak başlatılıyor. ' +
        'Developer Portal → Bot → Privileged Gateway Intents bölümünden "Message Content Intent" ve gerekirse "Server Members Intent" açın.',
    );
    return boot(bare, logger);
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
