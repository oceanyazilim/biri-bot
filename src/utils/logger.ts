import pino, { type Logger } from 'pino';

export type { Logger };

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    name: 'biri',
    level,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ['token', '*.token', 'DISCORD_TOKEN', 'DATABASE_URL', '*.DATABASE_URL'],
      censor: '[gizli]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'name' },
          },
        }
      : {}),
  });
}

/** A logger that discards everything; used by tests. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
