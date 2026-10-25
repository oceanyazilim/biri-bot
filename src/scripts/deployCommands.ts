import 'dotenv/config';
import { z } from 'zod';
import { deployCommands } from '../services/commandDeployer';
import { createLogger } from '../utils/logger';

/** Standalone command registration: `npm run deploy-commands`. Needs only the Discord credentials. */
const env = z
  .object({
    DISCORD_TOKEN: z.string().min(50, 'DISCORD_TOKEN eksik veya geçersiz'),
    DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/, 'DISCORD_CLIENT_ID geçersiz'),
    DEV_GUILD_ID: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.trim() : undefined)),
  })
  .safeParse(process.env);

const logger = createLogger('info', process.env.NODE_ENV !== 'production');

if (!env.success) {
  logger.fatal(env.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  process.exit(1);
}

deployCommands({ token: env.data.DISCORD_TOKEN, clientId: env.data.DISCORD_CLIENT_ID, guildId: env.data.DEV_GUILD_ID }, logger)
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'Komutlar kaydedilemedi');
    process.exit(1);
  });
