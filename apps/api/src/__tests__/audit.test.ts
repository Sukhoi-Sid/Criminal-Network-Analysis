import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../core/db';
import { createTestUser, resetDb, TEST_PASSWORD } from './helpers';

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  return res.body.token as string;
}

describe('Audit query authorization', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  // Only `auditor` holds Permission.AUDIT_READ in the frozen
  // packages/shared ROLE_PERMISSIONS contract. investigator/supervisor/admin
  // must all be denied — this was previously broken (admin and supervisor
  // were granted access via a separate `requireRole` check that ignored the
  // permission table).
  it('allows an auditor to query audit logs', async () => {
    await createTestUser('auditorX@test.local', 'auditor');
    const token = await loginAs('auditorX@test.local');

    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it.each(['investigator', 'supervisor', 'admin'] as const)(
    'denies %s access to audit logs',
    async (role) => {
      await createTestUser(`auditDenied-${role}@test.local`, role);
      const token = await loginAs(`auditDenied-${role}@test.local`);

      const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    },
  );

  it('denies unauthenticated access to audit logs', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });

  // AUDIT_READ event generation + no-recursion check: reading the audit log
  // itself produces exactly one new `audit_read` event (recorded after the
  // query already ran, via a single INSERT with no re-entrant call back
  // into the query path) — it must not spiral into repeated/duplicate
  // events or appear in its own result page.
  it('records exactly one AUDIT_READ event per query, with no recursive logging', async () => {
    await createTestUser('auditorY@test.local', 'auditor');
    const token = await loginAs('auditorY@test.local');

    const before = await prisma.auditEvent.count({ where: { action: 'audit_read' } });

    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);

    const after = await prisma.auditEvent.count({ where: { action: 'audit_read' } });
    expect(after - before).toBe(1);

    // The event recorded for this request must not appear inside its own
    // response body (it was created after the query executed).
    const ids = res.body.items.map((e: { action: string }) => e.action);
    const auditReadCountInResponse = ids.filter((a: string) => a === 'audit_read').length;
    expect(auditReadCountInResponse).toBe(0);

    // A second query should add exactly one more — not a multiplying count —
    // proving there's no feedback loop where reading audit logs triggers
    // additional audit-read events beyond the one for that request.
    await request(app).get('/api/audit').set('Authorization', `Bearer ${token}`);
    const afterSecond = await prisma.auditEvent.count({ where: { action: 'audit_read' } });
    expect(afterSecond - after).toBe(1);
  });

  it('scopes results by caseId filter when provided', async () => {
    await createTestUser('auditorZ@test.local', 'auditor');
    await createTestUser('invZ@test.local', 'investigator');
    const auditorToken = await loginAs('auditorZ@test.local');
    const invToken = await loginAs('invZ@test.local');

    const caseA = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ title: 'Audit Scope Case A' });
    const caseB = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ title: 'Audit Scope Case B' });

    const res = await request(app)
      .get('/api/audit')
      .query({ caseId: caseA.body.id })
      .set('Authorization', `Bearer ${auditorToken}`);

    expect(res.status).toBe(200);
    const caseIds = new Set(res.body.items.map((e: { caseId: string | null }) => e.caseId));
    expect(caseIds.has(caseA.body.id)).toBe(true);
    expect(caseIds.has(caseB.body.id)).toBe(false);
  });
});
