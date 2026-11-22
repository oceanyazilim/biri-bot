import 'dotenv/config';
import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Geçerli bir Discord ID olmalı');

const optionalSnowflake = z
  .string()
  .optional()
  .transform((value) => (value && value.trim().length > 0 ? value.trim() : undefined))
  .pipe(snowflake.optional());

const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .default('false')
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DISCORD_TOKEN: z.string().min(50, 'DISCORD_TOKEN eksik veya geçersiz'),
  DISCORD_CLIENT_ID: snowflake,
  /** When set, slash commands are deployed to this guild only (instant updates while developing). */
  DEV_GUILD_ID: optionalSnowflake,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL eksik'),

  /** Registers slash commands on every startup (bulk overwrite, idempotent). */
  AUTO_DEPLOY_COMMANDS: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((value) => value === 'true' || value === '1' || value === 'yes'),

  /**
   * `.yargi` / `.unyargı` prefix commands, on by default. They need the privileged
   * Message Content intent; when Discord refuses it, Biri starts without them.
   */
  ENABLE_PREFIX_COMMANDS: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((value) => value === 'true' || value === '1' || value === 'yes'),
  /**
   * Comma-separated user ids allowed to use `.yargi` / `.unyargı`. Everyone else is
   * told they have not been granted it. Empty = nobody. Slash commands are unaffected.
   */
  YARGI_ALLOWED_USER_IDS: z
    .string()
    .default('736930531534700634,887788724988026890,399295370921902080')
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .pipe(z.array(snowflake)),
  /** Must not be `/`, which Discord reserves for slash commands. */
  PREFIX: z
    .string()
    .trim()
    .min(1)
    .max(5)
    .refine((value) => !value.startsWith('/') && !/\s/.test(value), "PREFIX '/' ile başlayamaz ve boşluk içeremez")
    .default('.'),
  /**
   * Deletes images, GIFs, files and links from the chat channel MEDIA_CLEANUP_DELAY_SEC
   * after they were posted. Needs the Message Content intent, like prefix commands.
   */
  ENABLE_MEDIA_CLEANUP: z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default('true')
    .transform((value) => value === 'true' || value === '1' || value === 'yes'),
  /** Comma-separated channel ids. Empty = every text channel named like "chat" / "sohbet". */
  MEDIA_CLEANUP_CHANNEL_IDS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0),
    )
    .pipe(z.array(snowflake)),
  MEDIA_CLEANUP_DELAY_SEC: z.coerce.number().int().min(5).max(3600).default(60),
  /** Logs deleted/edited messages. Requires the privileged Message Content intent. */
  ENABLE_MESSAGE_LOGS: booleanFlag,

  /** Enables the privileged Server Members intent (member join/leave logs, kick fallback attribution). */
  ENABLE_GUILD_MEMBERS_INTENT: booleanFlag,

  /** Port for the HTTP health endpoint. 0 disables it. */
  HEALTH_PORT: z.coerce.number().int().min(0).max(65535).default(0),

  /** How long a gateway event waits for its matching audit log entry before falling back to a fetch. */
  AUDIT_CORRELATION_WINDOW_MS: z.coerce.number().int().min(500).max(30_000).default(2_500),
  /** Max entries requested from the audit log API in fallback fetches. */
  AUDIT_FETCH_LIMIT: z.coerce.number().int().min(1).max(100).default(25),

  COMMAND_COOLDOWN_MS: z.coerce.number().int().min(0).max(60_000).default(3_000),
  LOG_FLUSH_INTERVAL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
  /** Concurrent temp-room creations per guild. */
  ROOM_CREATION_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(kök)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Ortam değişkenleri geçersiz:\n${issues}\n.env.example dosyasına bakın.`);
  }
  return parsed.data;
}
