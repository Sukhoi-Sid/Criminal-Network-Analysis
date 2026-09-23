import { PrismaClient } from '@prisma/client';
import { env } from './env';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse a single client across tsx watch reloads / test imports instead of
// opening a new pool each time.
export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

/**
 * Single owner of "is the database actually reachable" — used by the
 * `/health` endpoint. Never throws; callers get a plain boolean so a DB
 * outage can be reported as an unhealthy response rather than an
 * unhandled error. Never surfaces the underlying error (connection
 * string, host, credentials) to callers — only logs it server-side.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[health] database connectivity check failed:', err);
    return false;
  }
}
