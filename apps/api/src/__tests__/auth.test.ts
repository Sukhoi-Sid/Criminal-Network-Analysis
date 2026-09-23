import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../core/db';
import { createTestUser, resetDb, TEST_PASSWORD } from './helpers';

const app = createApp();

describe('Auth', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it('logs in with correct credentials and returns a token + user', async () => {
    await createTestUser('investigator@test.local', 'investigator');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'investigator@test.local', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.user.email).toBe('investigator@test.local');
    expect(res.body.user.role).toBe('investigator');
  });

  it('rejects an unknown email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: 'whatever' });

    expect(res.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    await createTestUser('investigator2@test.local', 'investigator');

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'investigator2@test.local', password: 'wrong-password' });

    expect(res.status).toBe(401);
  });

  it('records login_failed audit events for bad credentials', async () => {
    await createTestUser('investigator3@test.local', 'investigator');
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'investigator3@test.local', password: 'wrong-password' });

    const events = await prisma.auditEvent.findMany({ where: { action: 'login_failed' } });
    expect(events.length).toBe(1);
  });

  it('returns the current user for /me with a valid token', async () => {
    await createTestUser('investigator4@test.local', 'investigator');
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'investigator4@test.local', password: TEST_PASSWORD });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('investigator4@test.local');
  });

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
