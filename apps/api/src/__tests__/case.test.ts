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

describe('Case platform', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it('lets an investigator create a case and auto-assigns them', async () => {
    await createTestUser('inv@test.local', 'investigator');
    const token = await loginAs('inv@test.local');

    const res = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Test Case One' });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Test Case One');
    expect(res.body.caseId).toMatch(/^REF-\d{4}-/);

    const state = await prisma.caseIntelligenceState.findUnique({ where: { caseId: res.body.id } });
    expect(state).not.toBeNull();
    expect(state?.version).toBe(1);
  });

  it('only shows an investigator their assigned cases', async () => {
    const inv1 = await createTestUser('inv1@test.local', 'investigator');
    await createTestUser('inv2@test.local', 'investigator');
    const token1 = await loginAs('inv1@test.local');
    const token2 = await loginAs('inv2@test.local');

    await request(app).post('/api/cases').set('Authorization', `Bearer ${token1}`).send({ title: 'Inv1 Case' });

    const listAsInv1 = await request(app).get('/api/cases').set('Authorization', `Bearer ${token1}`);
    const listAsInv2 = await request(app).get('/api/cases').set('Authorization', `Bearer ${token2}`);

    expect(listAsInv1.body.items.length).toBe(1);
    expect(listAsInv2.body.items.length).toBe(0);
    void inv1;
  });

  // SECURITY FIX regression test: supervisors previously got blanket access
  // to every case in the system regardless of assignment (see
  // modules/auth/policies.ts). Access is now assignment-scoped for every
  // role, so a supervisor with no assignment on a case must not see it.
  it('does NOT let an unassigned supervisor see another team\'s case (scoped access)', async () => {
    await createTestUser('inv3@test.local', 'investigator');
    await createTestUser('sup1@test.local', 'supervisor');
    const invToken = await loginAs('inv3@test.local');
    const supToken = await loginAs('sup1@test.local');

    const created = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ title: 'Some Case' });

    const listAsSup = await request(app).get('/api/cases').set('Authorization', `Bearer ${supToken}`);
    expect(listAsSup.body.items.length).toBe(0);

    const getAsSup = await request(app)
      .get(`/api/cases/${created.body.id}`)
      .set('Authorization', `Bearer ${supToken}`);
    expect(getAsSup.status).toBe(403);
  });

  it('lets a supervisor access a case once explicitly assigned, but not other cases', async () => {
    await createTestUser('inv3b@test.local', 'investigator');
    const supervisorCreator = await createTestUser('sup2b@test.local', 'supervisor');
    const supervisor2 = await createTestUser('sup3b@test.local', 'supervisor');
    const invToken = await loginAs('inv3b@test.local');
    const supCreatorToken = await loginAs('sup2b@test.local');
    const sup2Token = await loginAs('sup3b@test.local');

    // An unrelated case sup2 has nothing to do with.
    const otherCase = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${invToken}`)
      .send({ title: 'Unrelated Case' });

    // supervisorCreator's own case, to which they then assign supervisor2.
    const ownCase = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${supCreatorToken}`)
      .send({ title: 'Team Case' });

    await request(app)
      .post(`/api/cases/${ownCase.body.id}/assignments`)
      .set('Authorization', `Bearer ${supCreatorToken}`)
      .send({ userId: supervisor2.id, role: 'supervisor' });

    const accessOwn = await request(app)
      .get(`/api/cases/${ownCase.body.id}`)
      .set('Authorization', `Bearer ${sup2Token}`);
    expect(accessOwn.status).toBe(200);

    const accessOther = await request(app)
      .get(`/api/cases/${otherCase.body.id}`)
      .set('Authorization', `Bearer ${sup2Token}`);
    expect(accessOther.status).toBe(403);

    void supervisorCreator;
  });

  // Admin holds only USER_MANAGE in the frozen ROLE_PERMISSIONS contract —
  // no case content permissions — so it must not get case access by default.
  it('does not give admin default case-content access', async () => {
    await createTestUser('inv3c@test.local', 'investigator');
    await createTestUser('admin1@test.local', 'admin');
    const invToken = await loginAs('inv3c@test.local');
    const adminToken = await loginAs('admin1@test.local');

    await request(app).post('/api/cases').set('Authorization', `Bearer ${invToken}`).send({ title: 'Admin Test Case' });

    const listAsAdmin = await request(app).get('/api/cases').set('Authorization', `Bearer ${adminToken}`);
    expect(listAsAdmin.status).toBe(403);

    const createAsAdmin = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Admin Should Not Create This' });
    expect(createAsAdmin.status).toBe(403);
  });

  // Auditor holds only AUDIT_READ — no case content permissions either.
  it('does not give auditor unrestricted case-content access', async () => {
    await createTestUser('auditor1@test.local', 'auditor');
    const auditorToken = await loginAs('auditor1@test.local');

    const listAsAuditor = await request(app).get('/api/cases').set('Authorization', `Bearer ${auditorToken}`);
    expect(listAsAuditor.status).toBe(403);
  });

  it('denies a non-assigned investigator access to a specific case', async () => {
    await createTestUser('inv4@test.local', 'investigator');
    await createTestUser('inv5@test.local', 'investigator');
    const token4 = await loginAs('inv4@test.local');
    const token5 = await loginAs('inv5@test.local');

    const created = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${token4}`)
      .send({ title: 'Private Case' });

    const res = await request(app)
      .get(`/api/cases/${created.body.id}`)
      .set('Authorization', `Bearer ${token5}`);

    expect(res.status).toBe(403);
  });

  it('lets a supervisor assign an investigator to a case', async () => {
    const investigator = await createTestUser('inv6@test.local', 'investigator');
    await createTestUser('sup2@test.local', 'supervisor');
    const supToken = await loginAs('sup2@test.local');

    const created = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${supToken}`)
      .send({ title: 'Assign Test Case' });

    const res = await request(app)
      .post(`/api/cases/${created.body.id}/assignments`)
      .set('Authorization', `Bearer ${supToken}`)
      .send({ userId: investigator.id, role: 'investigator' });

    expect(res.status).toBe(201);

    const assignment = await prisma.caseAssignment.findUnique({
      where: { caseId_userId: { caseId: created.body.id, userId: investigator.id } },
    });
    expect(assignment).not.toBeNull();
  });

  it('rejects case creation without a bearer token', async () => {
    const res = await request(app).post('/api/cases').send({ title: 'No Auth' });
    expect(res.status).toBe(401);
  });

  it('rejects an empty title with 400', async () => {
    await createTestUser('inv7@test.local', 'investigator');
    const token = await loginAs('inv7@test.local');

    const res = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: '' });

    expect(res.status).toBe(400);
  });
});
