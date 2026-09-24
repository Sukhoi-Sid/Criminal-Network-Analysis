import { unlink } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../core/db';
import { createTestUser, resetDb, TEST_PASSWORD, buildTestPdf } from './helpers';

const app = createApp();

async function loginAs(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  return res.body.token as string;
}

async function createCase(token: string, title: string) {
  const res = await request(app).post('/api/cases').set('Authorization', `Bearer ${token}`).send({ title });
  return res.body as { id: string };
}

async function uploadTxt(token: string, caseId: string, filename: string, content: string) {
  const res = await request(app)
    .post(`/api/cases/${caseId}/documents`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', Buffer.from(content, 'utf-8'), { filename, contentType: 'text/plain' });
  expect(res.status).toBe(201);
  return res.body as { id: string };
}

const SAMPLE_FIR = `FIR No: FIR-2026/00417
Complainant: Rahul Sharma
Accused: Vikram Malhotra
The caller's contact number was 9876543210, also reachable at +91 9123456780.
I transferred Rs. 85,000 to account no. 123456789012 as instructed on 12 March 2026.
Witness: Anita Verma confirms this. Vehicle MP09AB1234 was seen near Gandhi Nagar Colony.
Please contact Shastri Nagar Police Station for further details.`;

describe('Document intelligence (Phase 2)', () => {
  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await resetDb();
    await prisma.$disconnect();
  });

  describe('ingestion + extraction', () => {
    it('processes a TXT document and extracts multiple mention types with provenance', async () => {
      await createTestUser('inv@test.local', 'investigator');
      const token = await loginAs('inv@test.local');
      const kase = await createCase(token, 'FIR Extraction Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      const res = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.reused).toBe(false);
      expect(res.body.document.processingStatus).toBe('completed');
      expect(res.body.document.processedAt).not.toBeNull();

      const mentions = res.body.mentions as Array<Record<string, unknown>>;
      const types = new Set(mentions.map((m) => m.mentionType));

      expect(types.has('phone')).toBe(true);
      expect(types.has('person')).toBe(true);
      expect(types.has('vehicle')).toBe(true);
      expect(types.has('date')).toBe(true);
      expect(types.has('case_identifier')).toBe(true);
      expect(types.has('organization')).toBe(true);
      expect(types.has('location')).toBe(true);

      // provenance: every mention traces back to this exact document/case,
      // with a confidence score and a preserved source span.
      for (const m of mentions) {
        expect(m.documentId).toBe(document.id);
        expect(m.caseId).toBe(kase.id);
        expect(m.pageNumber).toBe(1);
        expect(typeof m.confidence).toBe('number');
        expect(m.confidence as number).toBeGreaterThan(0);
        expect(m.confidence as number).toBeLessThanOrEqual(1);
        expect(typeof m.startOffset).toBe('number');
        expect(typeof m.endOffset).toBe('number');
        expect((m.endOffset as number) > (m.startOffset as number)).toBe(true);
        expect(SAMPLE_FIR.slice(m.startOffset as number, m.endOffset as number)).toBe(m.text);
      }

      const phoneMention = mentions.find((m) => m.mentionType === 'phone');
      expect(phoneMention?.normalizedText).toBe('9876543210');

      const vehicleMention = mentions.find((m) => m.mentionType === 'vehicle');
      expect(vehicleMention?.normalizedText).toBe('MP09AB1234');
    });

    it('ingests a real PDF and preserves page number provenance', async () => {
      await createTestUser('pdfinv@test.local', 'investigator');
      const token = await loginAs('pdfinv@test.local');
      const kase = await createCase(token, 'PDF Extraction Case');

      const pdfBuffer = await buildTestPdf('Complainant: Sanjay Gupta contact 9988776655');

      const uploadRes = await request(app)
        .post(`/api/cases/${kase.id}/documents`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', pdfBuffer, { filename: 'fir.pdf', contentType: 'application/pdf' });
      expect(uploadRes.status).toBe(201);

      const processRes = await request(app)
        .post(`/api/cases/${kase.id}/documents/${uploadRes.body.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(processRes.status).toBe(201);
      expect(processRes.body.document.processingStatus).toBe('completed');
      const mentions = processRes.body.mentions as Array<Record<string, unknown>>;
      expect(mentions.length).toBeGreaterThan(0);
      expect(mentions.every((m) => m.pageNumber === 1)).toBe(true);
      expect(mentions.some((m) => m.mentionType === 'phone')).toBe(true);
    });

    it('document starts in PENDING status immediately after upload', async () => {
      await createTestUser('pending@test.local', 'investigator');
      const token = await loginAs('pending@test.local');
      const kase = await createCase(token, 'Pending Status Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', 'Complainant: Jane Doe.');

      const res = await request(app).get(`/api/documents/${document.id}`).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.processingStatus).toBe('pending');
      expect(res.body.processedAt).toBeNull();
    });

    it('produces no mentions (but still completes) for text with no extractable entities', async () => {
      await createTestUser('empty@test.local', 'investigator');
      const token = await loginAs('empty@test.local');
      const kase = await createCase(token, 'Empty Extraction Case');
      const document = await uploadTxt(token, kase.id, 'blank.txt', 'no extractable entities in this sentence');

      const res = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.document.processingStatus).toBe('completed');
      expect(res.body.mentions).toEqual([]);
    });
  });

  describe('idempotency / reprocessing', () => {
    it('returns cached mentions (reused: true) on a second call without force', async () => {
      await createTestUser('idem@test.local', 'investigator');
      const token = await loginAs('idem@test.local');
      const kase = await createCase(token, 'Idempotency Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      const first = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(first.status).toBe(201);
      const firstCount = first.body.mentions.length;

      const second = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(second.status).toBe(200);
      expect(second.body.reused).toBe(true);
      expect(second.body.mentions.length).toBe(firstCount);

      const dbCount = await prisma.mention.count({ where: { documentId: document.id } });
      expect(dbCount).toBe(firstCount);
    });

    it('force reprocessing replaces mentions without duplicating them', async () => {
      await createTestUser('force@test.local', 'investigator');
      const token = await loginAs('force@test.local');
      const kase = await createCase(token, 'Force Reprocess Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      const first = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      const firstCount = first.body.mentions.length;

      const forced = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({ force: true });

      expect(forced.status).toBe(201);
      expect(forced.body.reused).toBe(false);
      expect(forced.body.mentions.length).toBe(firstCount);

      const dbCount = await prisma.mention.count({ where: { documentId: document.id } });
      expect(dbCount).toBe(firstCount); // not doubled
    });

    it('rejects a second process request while one is already in-flight-marked PROCESSING', async () => {
      await createTestUser('inflight@test.local', 'investigator');
      const token = await loginAs('inflight@test.local');
      const kase = await createCase(token, 'In-flight Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      await prisma.document.update({ where: { id: document.id }, data: { processingStatus: 'processing' } });

      const res = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('failure handling', () => {
    it('marks the document FAILED with a sanitized error if extraction throws', async () => {
      await createTestUser('fail@test.local', 'investigator');
      const token = await loginAs('fail@test.local');
      const kase = await createCase(token, 'Failure Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      const dbDoc = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      await unlink(dbDoc.blobPath); // simulate the blob going missing on disk

      const res = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(res.status).toBe(500);
      // Sanitized — never leaks the filesystem path from the ENOENT error.
      expect(JSON.stringify(res.body)).not.toContain(dbDoc.blobPath);

      const updated = await prisma.document.findUniqueOrThrow({ where: { id: document.id } });
      expect(updated.processingStatus).toBe('failed');
      expect(updated.processingError).not.toBeNull();
      expect(updated.processingError).not.toContain(dbDoc.blobPath);
    });
  });

  describe('authorization / IDOR', () => {
    it('an unauthorized investigator cannot trigger processing on another case', async () => {
      await createTestUser('ownerA@test.local', 'investigator');
      await createTestUser('outsiderA@test.local', 'investigator');
      const ownerToken = await loginAs('ownerA@test.local');
      const outsiderToken = await loginAs('outsiderA@test.local');

      const kase = await createCase(ownerToken, "Owner's Case");
      const document = await uploadTxt(ownerToken, kase.id, 'fir.txt', SAMPLE_FIR);

      const res = await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({});
      expect(res.status).toBe(403);
    });

    it('an unauthorized investigator cannot list mentions for another case', async () => {
      await createTestUser('ownerB@test.local', 'investigator');
      await createTestUser('outsiderB@test.local', 'investigator');
      const ownerToken = await loginAs('ownerB@test.local');
      const outsiderToken = await loginAs('outsiderB@test.local');

      const kase = await createCase(ownerToken, "Owner's Case B");
      const document = await uploadTxt(ownerToken, kase.id, 'fir.txt', SAMPLE_FIR);
      await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({});

      const res = await request(app)
        .get(`/api/cases/${kase.id}/documents/${document.id}/mentions`)
        .set('Authorization', `Bearer ${outsiderToken}`);
      expect(res.status).toBe(403);
    });

    it('rejects a mismatched caseId/documentId pair (cross-case IDOR) with 404', async () => {
      await createTestUser('ownerC@test.local', 'investigator');
      const token = await loginAs('ownerC@test.local');

      // Same user, authorized on BOTH cases — the vulnerability class this
      // guards against is pairing a caseId you're authorized on with a
      // documentId from a *different* case, not just cross-user access.
      const caseA = await createCase(token, 'Case A');
      const caseB = await createCase(token, 'Case B');
      const documentInA = await uploadTxt(token, caseA.id, 'fir.txt', SAMPLE_FIR);

      const res = await request(app)
        .post(`/api/cases/${caseB.id}/documents/${documentInA.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(res.status).toBe(404);

      const mentionsRes = await request(app)
        .get(`/api/cases/${caseB.id}/documents/${documentInA.id}/mentions`)
        .set('Authorization', `Bearer ${token}`);
      expect(mentionsRes.status).toBe(404);
    });
  });

  describe('audit + case intelligence state', () => {
    it('logs a document_process audit event on success', async () => {
      await createTestUser('audit1@test.local', 'investigator');
      const token = await loginAs('audit1@test.local');
      const kase = await createCase(token, 'Audit Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      const events = await prisma.auditEvent.findMany({
        where: { action: 'document_process', resourceId: document.id },
      });
      expect(events.length).toBe(1);
      expect((events[0].metadata as Record<string, unknown>).status).toBe('completed');
    });

    it('updates CaseIntelligenceState with mention counts after extraction', async () => {
      await createTestUser('cis@test.local', 'investigator');
      const token = await loginAs('cis@test.local');
      const kase = await createCase(token, 'CIS Update Case');
      const document = await uploadTxt(token, kase.id, 'fir.txt', SAMPLE_FIR);

      const beforeState = await prisma.caseIntelligenceState.findUniqueOrThrow({ where: { caseId: kase.id } });
      expect(beforeState.version).toBe(1);

      await request(app)
        .post(`/api/cases/${kase.id}/documents/${document.id}/process`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      // Event handling is synchronous (in-process, awaited publish), so the
      // state should already reflect the update by the time the HTTP
      // response above has returned.
      const afterState = await prisma.caseIntelligenceState.findUniqueOrThrow({ where: { caseId: kase.id } });
      expect(afterState.version).toBe(2);
      const summary = afterState.summary as Record<string, unknown>;
      const documents = summary.documents as Record<string, { mentionsTotal: number }>;
      expect(documents[document.id]).toBeDefined();
      expect(documents[document.id].mentionsTotal).toBeGreaterThan(0);
    });
  });
});
