import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { testDatabaseUrl } from './test-env';

async function main() {
  const url = testDatabaseUrl();
  const databaseName = decodeURIComponent(new URL(url).pathname.slice(1));
  const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const rows = await admin.$queryRaw<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname = ${databaseName}`;
    if (!rows.length) {
      // Database names cannot be query parameters; constrain then quote the identifier.
      if (!/^[a-zA-Z0-9_]+_test$/.test(databaseName)) throw new Error('Invalid test database name');
      await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    }
  } finally { await admin.$disconnect(); }
  const prismaPackage = require('prisma/package.json') as { bin: { prisma: string } };
  const cli = path.join(path.dirname(require.resolve('prisma/package.json')), prismaPackage.bin.prisma);
  const result = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], {
    stdio: 'inherit', env: { ...process.env, DATABASE_URL: url },
  });
  if (result.status !== 0) throw new Error('Test database migration failed');
}
main().catch(() => { console.error('Unable to prepare the isolated test database. Check TEST_DATABASE_URL and database creation privileges.'); process.exitCode = 1; });
