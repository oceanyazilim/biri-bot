import { PrismaClient } from '@prisma/client';
import type { Logger } from '../utils/logger';

export function createPrismaClient(logger: Logger): PrismaClient {
  const prisma = new PrismaClient({
    log: [
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
  });
  prisma.$on('warn', (event) => logger.warn({ target: event.target }, `Prisma: ${event.message}`));
  prisma.$on('error', (event) => logger.error({ target: event.target }, `Prisma: ${event.message}`));
  return prisma;
}

export async function checkDatabase(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
