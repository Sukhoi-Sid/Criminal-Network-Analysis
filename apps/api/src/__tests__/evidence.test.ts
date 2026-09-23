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

describe('Evidence store (Phase 1 skeleton)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  it('uploads a text document and creates a hashed, provenance-backed evidence record', async () => {
    await createTestUser('inv@test.local', 'investigator');
    const token = await loginAs('inv@test.local');

    const created = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Evidence Test Case' });

    const res = await request(app)
      .post(`/api/cases/${created.body.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('Sample FIR content for hashing.'), {
        filename: 'sample-fir.txt',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(201);
    expect(res.body.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const evidenceRecord = await prisma.evidenceRecord.findFirst({
      where: { documentId: res.body.id },
      include: { provenance: true },
    });
    expect(evidenceRecord).not.toBeNull();
    expect(evidenceRecord?.provenance).not.toBeNull();
    expect(evidenceRecord?.contentHash).toBe(res.body.contentHash);
  });

  it('rejects unsupported file types', async () => {
    await createTestUser('inv2@test.local', 'investigator');
    const token = await loginAs('inv2@test.local');

    const created = await request(app)
      .post('/api/cases')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Reject Test Case' });

    const res = await request(app)
      .post(`/api/cases/${created.body.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('binary-ish'), {
        filename: 'image.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
  });

  // SECURITY FIX regression tests: GET /documents/:id and
  // GET /evidence-records/:id are keyed by bare id (no caseId in the
  // route), and previously only checked the EVIDENCE_READ *permission* —
  // any investigator holding that permission could read ANY case's
  // documents/evidence by id. These now assert case access via
  // assertCaseAccess() in evidence.service.ts.
  describe('cross-case IDOR protection', () => {
    async function uploadSampleDocument(token: string, caseId: string) {
      const res = await request(app)
        .post(`/api/cases/${caseId}/documents`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('Confidential FIR content.'), {
          filename: 'fir.txt',
          contentType: 'text/plain',
        });
      expect(res.status).toBe(201);
      return res.body as { id: string };
    }

    it("Investigator A cannot access Investigator B's case document by id", async () => {
      await createTestUser('idorA@test.local', 'investigator');
      await createTestUser('idorB@test.local', 'investigator');
      const tokenA = await loginAs('idorA@test.local');
      const tokenB = await loginAs('idorB@test.local');

      const caseA = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ title: "A's Private Case" });

      const document = await uploadSampleDocument(tokenA, caseA.body.id);

      // B has EVIDENCE_READ (their role grants it) but no assignment on
      // case A — must still be denied.
      const asB = await request(app)
        .get(`/api/documents/${document.id}`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(asB.status).toBe(403);

      const contentAsB = await request(app)
        .get(`/api/cases/${caseA.body.id}/documents`)
        .set('Authorization', `Bearer ${tokenB}`);
      expect(contentAsB.status).toBe(403);

      // Sanity: A can still read their own document.
      const asA = await request(app)
        .get(`/api/documents/${document.id}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(asA.status).toBe(200);
    });

    it("Investigator A cannot access Investigator B's evidence record by id", async () => {
      await createTestUser('idorC@test.local', 'investigator');
      await createTestUser('idorD@test.local', 'investigator');
      const tokenC = await loginAs('idorC@test.local');
      const tokenD = await loginAs('idorD@test.local');

      const caseC = await request(app)
        .post('/api/cases')
        .set('Authorization', `Bearer ${tokenC}`)
        .send({ title: "C's Private Case" });

      const document = await uploadSampleDocument(tokenC, caseC.body.id);
      const evidenceRecord = await prisma.evidenceRecord.findFirstOrThrow({
        where: { documentId: document.id },
      });

      const asD = await request(app)
        .get(`/api/evidence-records/${evidenceRecord.id}`)
        .set('Authorization', `Bearer ${tokenD}`);
      expect(asD.status).toBe(403);

      const asC = await request(app)
        .get(`/api/evidence-records/${evidenceRecord.id}`)
        .set('Authorization', `Bearer ${tokenC}`);
      expect(asC.status).toBe(200);
    });

    it('returns 404 (not 403) for a document id that does not exist at all', async () => {
      await createTestUser('idorE@test.local', 'investigator');
      const token = await loginAs('idorE@test.local');

      const res = await request(app)
        .get('/api/documents/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });
});
