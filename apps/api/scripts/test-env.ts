import 'dotenv/config';

export function testDatabaseUrl(): string {
  const configured = process.env.TEST_DATABASE_URL;
  const url = new URL(configured ?? process.env.DATABASE_URL ?? 'postgresql://sih:sih_dev_password@localhost:5433/sih_criminal');
  if (!configured) url.pathname = url.pathname.replace(/\/$/, '') + '_test';
  if (!url.pathname.endsWith('_test')) throw new Error('Test database name must end in _test; tests clear application tables.');
  return url.toString();
}
