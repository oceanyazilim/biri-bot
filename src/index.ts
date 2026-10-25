import { RETENTION_SWEEP_INTERVAL_MS, STALE_SWEEP_INTERVAL_MS } from './config/constants';
import { loadEnv } from './config/env';
import type { App } from './core/App';
import { createApp } from './core/createApp';
import { registerEvents } from './events';
import { deployCommands } from './services/commandDeployer';
import { createLogger } from './utils/logger';

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

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
  const app = createApp(env, logger);

  await app.prisma.$connect();
  logger.info('Veritabanı bağlantısı kuruldu');

  if (env.AUTO_DEPLOY_COMMANDS) {
    await deployCommands({ token: env.DISCORD_TOKEN, clientId: env.DISCORD_CLIENT_ID, guildId: env.DEV_GUILD_ID }, logger).catch((error: unknown) =>
      logger.error({ err: error }, 'Slash komutları otomatik kaydedilemedi; `npm run deploy-commands` deneyin'),
    );
  }

  registerEvents(app);
  app.logDispatcher.start();
  app.health.listen(env.HEALTH_PORT);
  const stopJobs = startBackgroundJobs(app);

  app.client.on('error', (error) => logger.error({ err: error }, 'Discord istemci hatası'));
  app.client.on('shardDisconnect', (event, shardId) => logger.warn({ code: event.code, shardId }, 'Gateway bağlantısı koptu'));
  app.client.on('shardReconnecting', (shardId) => logger.info({ shardId }, 'Gateway yeniden bağlanıyor'));

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

  try {
    await app.client.login(env.DISCORD_TOKEN);
  } catch (error) {
    if (error instanceof Error && /disallowed intents/i.test(error.message)) {
      throw new Error(
        'Discord ayrıcalıklı intent izni vermedi. Developer Portal → Bot → Privileged Gateway Intents bölümünden ' +
          `${env.ENABLE_PREFIX_COMMANDS ? '"Message Content Intent" ' : ''}${env.ENABLE_GUILD_MEMBERS_INTENT ? '"Server Members Intent" ' : ''}` +
          'ayarını açın ya da ilgili ENABLE_* değişkenini false yapın.',
      );
    }
    throw error;
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
