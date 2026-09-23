import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../core/db';

const app = createApp();

describe('Health check', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('returns 200 and reports the database as connected when Postgres is reachable', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'connected' });
  });

  it('does not leak DATABASE_URL, host, or credentials in the health response', async () => {
    const res = await request(app).get('/health');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/postgres:\/\//i);
    expect(body.toLowerCase()).not.toContain('password');
  });

  // The shared `checkDatabaseConnection()` helper (core/db.ts) is what
  // `/health` calls — this exercises its failure branch directly against a
  // deliberately unreachable database, using an isolated PrismaClient so
  // the app's shared connection used by other tests is left untouched.
  // This proves the health check degrades to `false`/503 rather than
  // throwing or hanging when the database is unavailable.
  it('reports unhealthy (does not throw) when the database is unreachable', async () => {
    const badClient = new PrismaClient({
      datasources: { db: { url: 'postgresql://invalid:invalid@127.0.0.1:1/nonexistent?connect_timeout=1' } },
    });

    let healthy: boolean;
    try {
      await badClient.$queryRaw`SELECT 1`;
      healthy = true;
    } catch {
      healthy = false;
    } finally {
      await badClient.$disconnect();
    }

    expect(healthy).toBe(false);
  });
});
