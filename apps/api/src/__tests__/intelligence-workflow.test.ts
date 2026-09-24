import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { beforeEach, afterEach, afterAll, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../core/db';
import { eventBus } from '../core/domain-events';
import { auditService } from '../modules/audit/audit.service';
import { sourceAdapters } from '../modules/data-exchange/adapters';
import { Permission, ROLE_PERMISSIONS, UserRole } from '@sih/shared';
import { createTestUser, resetDb, TEST_PASSWORD, buildTestPdf } from './helpers';

const app = createApp();
let inv: string, sup: string, outsider: string, admin: string, auditor: string;
let caseId: string, documentId: string, supervisorId: string, outsiderId: string;
const base = () => `/api/cases/${caseId}/intelligence`;
const post = (url: string, token = inv, body: object = {}) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(body);
const get = (url: string, token = inv) => request(app).get(url).set('Authorization', `Bearer ${token}`);

async function login(email: string, role: 'investigator' | 'supervisor' | 'admin' | 'auditor') {
  const user = await createTestUser(email, role);
  const res = await request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });
  return { token: res.body.token as string, user };
}
async function fixture(kind = 'theft') {
  const text = await readFile(path.join(__dirname, '../../prisma/fixtures', `synthetic-fir-${kind}.txt`));
  const upload = await request(app).post(`/api/cases/${caseId}/documents`).set('Authorization', `Bearer ${inv}`)
    .attach('file', text, { filename: kind + '.txt', contentType: 'text/plain' });
  expect(upload.status).toBe(201);
  documentId = upload.body.id;
  expect((await post(`/api/cases/${caseId}/documents/${documentId}/process`)).status).toBe(201);
}
async function generate() {
  const result = await post(`${base()}/analyze`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.gaps as Array<{ id: string; sourceId: string; status: string; origins: unknown[] }>;
}
async function draft() {
  const gaps = await generate();
  const gap = gaps.find(g => g.sourceId === 'mock-vehicle')!;
  expect((await post(`${base()}/gaps/${gap.id}/review`, inv, { decision: 'select', note: 'Incident target and window verified.' })).status).toBe(200);
  const result = await post(`${base()}/requests`, inv, { gapId: gap.id });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body as { id: string; gapId: string; status: string };
}
async function authorized() {
  const r = await draft();
  expect((await post(`${base()}/requests/${r.id}/submit`)).body.status).toBe('PENDING_AUTHORIZATION');
  const approval = await post(`${base()}/requests/${r.id}/authorize`, sup, { approved: true, reason: 'Scoped demo requirement verified.' });
  expect(approval.status, JSON.stringify(approval.body)).toBe(200);
  expect(approval.body.status).toBe('AUTHORIZED');
  return r;
}

describe('Phase 3 real HTTP + PostgreSQL workflow', () => {
  beforeEach(async () => {
    await resetDb();
    inv = (await login('inv@phase3.test','investigator')).token;
    const supervisor = await login('sup@phase3.test','supervisor'); sup = supervisor.token; supervisorId = supervisor.user.id;
    const other = await login('other@phase3.test','supervisor'); outsider = other.token; outsiderId = other.user.id;
    admin = (await login('admin@phase3.test','admin')).token;
    auditor = (await login('auditor@phase3.test','auditor')).token;
    const kase = await post('/api/cases', inv, { title: 'Synthetic investigation' });
    caseId = kase.body.id;
    await prisma.caseAssignment.create({ data: { caseId, userId: supervisorId, role: 'supervisor' } });
    await fixture();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await resetDb(); await prisma.$disconnect(); });

  it('persists case-specific gaps and deduplicates simultaneous analysis', async () => {
    const responses = await Promise.all([post(`${base()}/analyze`), post(`${base()}/analyze`)]);
    expect(responses.map(r => r.status)).toEqual([200,200]);
    const first = responses[0].body;
    expect(first.context.caseType).toBe('THEFT');
    expect(first.gaps).toHaveLength(3);
    expect(await prisma.caseContextAnalysis.count()).toBe(1);
    expect(await prisma.intelligenceGap.count()).toBe(3);
    expect(first.gaps.map((g: { sourceId: string }) => g.sourceId)).not.toContain('mock-financial');
    const detail = await get(`${base()}/gaps/${first.gaps[0].id}`);
    expect(detail.body.requiredData).toBeTruthy();
    expect(detail.body.targetEntity).toBeTruthy();
    expect(detail.body.purpose).toBeTruthy();
    expect(detail.body.explanation).toContain('Rule');
    expect(detail.body.origins.some((o: { documentId: string; mentionId: string }) => o.documentId === documentId && o.mentionId)).toBe(true);
    expect((await get(`${base()}/context`)).body.contextHash).toBe(first.context.contextHash);
    expect((await get(`${base()}/gaps`)).body.total).toBe(3);
  });

  it('requires review and forbids user-supplied scope or status', async () => {
    const gap = (await generate())[0];
    expect((await post(`${base()}/requests`, inv, { gapId: gap.id })).status).toBe(400);
    expect((await post(`${base()}/gaps/${gap.id}/review`, inv, { decision: 'dismiss', note: 'Not needed.' })).body.status).toBe('DISMISSED');
    expect((await post(`${base()}/requests`, inv, { gapId: gap.id })).status).toBe(400);
    expect((await post(`${base()}/gaps/${gap.id}/review`, inv, { decision: 'select', note: '' })).status).toBe(400);
    expect((await post(`${base()}/gaps/${gap.id}/review`, inv, { decision: 'select', note: 'Verified.' })).status).toBe(200);
    expect((await post(`${base()}/requests`, inv, { gapId: gap.id, status: 'AUTHORIZED' })).status).toBe(400);
    expect((await post(`${base()}/requests`, inv, { gapId: gap.id, scope: { targetEntity: 'different person' } })).status).toBe(400);
  });

  it('completes the authorized lifecycle with provenance, audit and domain events', async () => {
    const events = vi.spyOn(eventBus, 'publish');
    const r = await authorized();
    const received = await post(`${base()}/requests/${r.id}/dispatch`);
    expect(received.status, JSON.stringify(received.body)).toBe(200);
    expect(received.body.status).toBe('RECEIVED');
    const result = await get(`${base()}/requests/${r.id}/response`);
    expect(result.body.payload.synthetic).toBe(true);
    expect(result.body.payload.caseId).toBe(caseId);
    expect(result.body.payload.requestId).toBe(r.id);
    expect(result.body.payload.sourceId).toBe('mock-vehicle');
    expect(result.body.evidenceRecord.reliabilityTier).toBe('tier4_unverified');
    const provenance = result.body.evidenceRecord.provenance;
    expect(provenance.originSource).toBe('mock-vehicle');
    expect(provenance.parentEvidenceId).toBeTruthy();
    expect(provenance.transformationChain[0].authorizationId).toBe(received.body.authorization.id);
    expect(provenance.transformationChain[0].origins.some((o: { documentId: string }) => o.documentId === documentId)).toBe(true);
    const completed = await post(`${base()}/requests/${r.id}/complete`);
    expect(completed.body.status).toBe('COMPLETED');
    expect(completed.body.transitions.map((t: { toStatus: string }) => t.toStatus)).toEqual(['DRAFT','SUBMITTED','PENDING_AUTHORIZATION','AUTHORIZED','DISPATCHED','RECEIVED','COMPLETED']);
    expect((await get(`${base()}/gaps/${r.gapId}`)).body.status).toBe('RESOLVED');
    const audits = await prisma.auditEvent.findMany({ where: { resourceId: r.id, action: { in: ['intelligence_transition','intelligence_request_create'] } } });
    expect(audits).toHaveLength(7);
    expect(audits.every(a => a.actorId && a.caseId === caseId)).toBe(true);
    expect(events.mock.calls.map(([e]) => e.type)).toEqual(expect.arrayContaining(['IntelligenceGapGenerated','IntelligenceRequestCreated','IntelligenceRequestSubmitted','IntelligenceRequestAuthorized','IntelligenceRequestDispatched','IntelligenceDataReceived','IntelligenceRequestCompleted']));
    expect((await get(`${base()}/requests`)).body.total).toBe(1);
  });

  it('enforces authentication, live RBAC, assignment ABAC and indistinguishable missing-case errors', async () => {
    expect((await request(app).post(`${base()}/analyze`).send({})).status).toBe(401);
    for (const token of [admin,auditor]) {
      expect((await post(`${base()}/analyze`, token)).status).toBe(403);
      expect((await get(`${base()}/gaps`, token)).status).toBe(403);
    }
    const forbidden = await get(`${base()}/gaps`, outsider);
    const missing = await get(`/api/cases/${randomUUID()}/intelligence/gaps`, outsider);
    expect(forbidden.status).toBe(404);
    expect(missing.body).toEqual(forbidden.body);
    await prisma.user.update({ where: { id: supervisorId }, data: { role: 'auditor' } });
    expect((await get(`${base()}/requests`, sup)).status).toBe(403); // old JWT role cannot retain access
    expect(await prisma.auditEvent.count({ where: { action: 'access_denied' } })).toBeGreaterThanOrEqual(7);
  });

  it('rejects cross-case gap/request IDs in reads and mutations', async () => {
    const r = await draft();
    const other = await post('/api/cases', inv, { title: 'Unrelated case' });
    const otherBase = `/api/cases/${other.body.id}/intelligence`;
    for (const suffix of [`gaps/${r.gapId}`,`requests/${r.id}`,`requests/${r.id}/response`]) expect((await get(`${otherBase}/${suffix}`)).status).toBe(404);
    expect((await post(`${otherBase}/requests`, inv, { gapId: r.gapId })).status).toBe(404);
    expect((await post(`${otherBase}/gaps/${r.gapId}/review`, inv, { decision: 'select', note: 'wrong case' })).status).toBe(404);
    for (const operation of ['submit','dispatch','complete']) expect((await post(`${otherBase}/requests/${r.id}/${operation}`)).status).toBe(404);
    expect((await get(`${otherBase}/requests`)).body.items).toEqual([]);
  });

  it('blocks unauthorized dispatch, self-approval, and supervisor role without supervisor assignment', async () => {
    const r = await draft();
    expect((await post(`${base()}/requests/${r.id}/dispatch`)).status).toBe(400);
    expect((await post(`${base()}/requests/${r.id}/complete`)).status).toBe(400);
    await post(`${base()}/requests/${r.id}/submit`);
    expect((await post(`${base()}/requests/${r.id}/authorize`, inv, { approved: true, reason: 'self' })).status).toBe(403);
    expect((await post(`${base()}/requests/${r.id}/authorize`, outsider, { approved: true, reason: 'outside' })).status).toBe(404);
    await prisma.caseAssignment.create({ data: { caseId, userId: outsiderId, role: 'investigator' } });
    expect((await post(`${base()}/requests/${r.id}/authorize`, outsider, { approved: true, reason: 'wrong assignment' })).status).toBe(403);
    // A supervisor who created/reviewed another request cannot approve it either.
    const gap = (await generate()).find(g => g.sourceId === 'mock-criminal-history')!;
    await post(`${base()}/gaps/${gap.id}/review`, sup, { decision: 'select', note: 'Reviewed by supervisor' });
    const own = await post(`${base()}/requests`, sup, { gapId: gap.id });
    await post(`${base()}/requests/${own.body.id}/submit`, sup);
    expect((await post(`${base()}/requests/${own.body.id}/authorize`, sup, { approved: true, reason: 'self' })).status).toBe(403);
    expect(await prisma.intelligenceResponse.count()).toBe(0);
  });

  it('keeps rejection terminal and prevents conflicting decisions', async () => {
    const r = await draft(); await post(`${base()}/requests/${r.id}/submit`);
    const rejected = await post(`${base()}/requests/${r.id}/authorize`, sup, { approved: false, reason: 'Insufficient scope.' });
    expect(rejected.body.status).toBe('REJECTED');
    expect((await post(`${base()}/requests/${r.id}/authorize`, sup, { approved: false, reason: 'Insufficient scope.' })).status).toBe(200);
    expect((await post(`${base()}/requests/${r.id}/authorize`, sup, { approved: true, reason: 'Changed mind.' })).status).toBe(400);
    expect((await post(`${base()}/requests/${r.id}/dispatch`)).status).toBe(400);
    expect(await prisma.intelligenceAuthorization.count()).toBe(1);
  });

  it('deduplicates concurrent creation, submission, dispatch and completion', async () => {
    const r = await draft();
    const creates = await Promise.all([post(`${base()}/requests`, inv, { gapId: r.gapId }),post(`${base()}/requests`, inv, { gapId: r.gapId })]);
    expect(creates.map(c => c.body.id)).toEqual([r.id,r.id]);
    const submits = await Promise.all([post(`${base()}/requests/${r.id}/submit`),post(`${base()}/requests/${r.id}/submit`)]);
    expect(submits.map(s => s.status)).toEqual([200,200]);
    await post(`${base()}/requests/${r.id}/authorize`, sup, { approved: true, reason: 'Verified.' });
    const dispatches = await Promise.all([post(`${base()}/requests/${r.id}/dispatch`),post(`${base()}/requests/${r.id}/dispatch`)]);
    expect(dispatches.map(d => d.status)).toEqual([200,200]);
    expect(dispatches[0].body.response.id).toBe(dispatches[1].body.response.id);
    await Promise.all([post(`${base()}/requests/${r.id}/complete`),post(`${base()}/requests/${r.id}/complete`)]);
    expect(await prisma.intelligenceRequest.count()).toBe(1);
    expect(await prisma.intelligenceResponse.count()).toBe(1);
    expect(await prisma.evidenceRecord.count({ where: { sourceType: 'external_package' } })).toBe(1);
    expect(await prisma.intelligenceTransition.count()).toBe(7);
  });

  it('records a sanitized adapter failure and retries without duplicate receipts', async () => {
    const r = await authorized();
    const adapter = sourceAdapters.get('mock-vehicle')!;
    vi.spyOn(adapter, 'fetchResponse').mockRejectedValueOnce(new Error('SECRET adapter detail'));
    const failed = await post(`${base()}/requests/${r.id}/dispatch`);
    expect(failed.body.status).toBe('FAILED');
    expect(JSON.stringify(failed.body)).not.toContain('SECRET');
    expect(await prisma.intelligenceResponse.count()).toBe(0);
    const retried = await post(`${base()}/requests/${r.id}/dispatch`);
    expect(retried.body.status).toBe('RECEIVED');
    expect(retried.body.failureReason).toBeNull();
    expect(await prisma.intelligenceResponse.count()).toBe(1);
  });

  it('rejects a mismatched source callback payload', async () => {
    const r = await authorized();
    const adapter = sourceAdapters.get('mock-vehicle')!;
    const original = adapter.fetchResponse.bind(adapter);
    vi.spyOn(adapter, 'fetchResponse').mockImplementationOnce(async receipt => ({ ...await original(receipt), caseId: randomUUID() }));
    expect((await post(`${base()}/requests/${r.id}/dispatch`)).body.status).toBe('FAILED');
    expect(await prisma.intelligenceResponse.count()).toBe(0);
  });

  it('rolls back request state when transactional audit fails', async () => {
    const r = await draft();
    vi.spyOn(auditService, 'emit').mockRejectedValueOnce(new Error('Audit unavailable'));
    expect((await post(`${base()}/requests/${r.id}/submit`)).status).toBe(500);
    expect((await prisma.intelligenceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('DRAFT');
    expect(await prisma.intelligenceTransition.count()).toBe(1);
  });

  it('preserves provenance and deduplication when Phase 2 force-replaces mentions', async () => {
    const r = await authorized();
    const before = (await get(`${base()}/requests/${r.id}`)).body.scope;
    await post(`/api/cases/${caseId}/documents/${documentId}/process`, inv, { force: true });
    expect((await generate()).length).toBe(3);
    expect((await get(`${base()}/requests/${r.id}`)).body.scope).toEqual(before);
    const origins = await prisma.intelligenceGapOrigin.findMany({ where: { gapId: r.gapId } });
    expect(origins.every(o => o.mentionId === null)).toBe(true);
    expect(origins.every(o => o.documentId === documentId && o.snapshot)).toBe(true);
    expect((await post(`${base()}/requests/${r.id}/dispatch`)).body.status).toBe('RECEIVED');
  });

  it('invalidates review when case context changes and refuses old request scope', async () => {
    const r = await authorized();
    await prisma.case.update({ where: { id: caseId }, data: { contextSummary: 'New material context for review.' } });
    expect((await post(`${base()}/requests/${r.id}/dispatch`)).status).toBe(400);
    expect(await prisma.intelligenceResponse.count()).toBe(0);
    const gaps = await generate();
    expect((await post(`${base()}/requests/${r.id}/dispatch`)).status).toBe(400);
    const replacement = gaps.find(g => g.sourceId === 'mock-vehicle' && g.status === 'OPEN')!;
    expect(replacement.id).not.toBe(r.gapId);
    await post(`${base()}/gaps/${replacement.id}/review`, inv, { decision: 'select', note: 'Changed context reviewed.' });
    const fresh = await post(`${base()}/requests`, inv, { gapId: replacement.id });
    expect(fresh.body.id).not.toBe(r.id);
    expect(fresh.body.status).toBe('DRAFT');
  });

  it('enforces source-specific permissions in lists, details and dispatch', async () => {
    const r = await authorized();
    const original = ROLE_PERMISSIONS[UserRole.INVESTIGATOR];
    ROLE_PERMISSIONS[UserRole.INVESTIGATOR] = original.filter(p => p !== Permission.SOURCE_VEHICLE);
    try {
      const analyzed = await post(`${base()}/analyze`);
      expect(analyzed.body.gaps.some((g: { sourceId: string }) => g.sourceId === 'mock-vehicle')).toBe(false);
      expect((await get(`${base()}/gaps`)).body.items.some((g: { sourceId: string }) => g.sourceId === 'mock-vehicle')).toBe(false);
      expect((await get(`${base()}/requests`)).body.items).toEqual([]);
      expect((await get(`${base()}/requests/${r.id}`)).status).toBe(403);
      expect((await post(`${base()}/requests/${r.id}/dispatch`)).status).toBe(403);
      expect(await prisma.intelligenceResponse.count()).toBe(0);
    } finally { ROLE_PERMISSIONS[UserRole.INVESTIGATOR] = original; }
  });

  it('retains and replays an event after a subscriber failure without duplicating state', async () => {
    const r = await draft();
    const publish = vi.spyOn(eventBus, 'publish').mockRejectedValueOnce(new Error('Transient subscriber failure'));
    expect((await post(`${base()}/requests/${r.id}/submit`)).body.status).toBe('PENDING_AUTHORIZATION');
    expect(await prisma.intelligenceTransition.count({ where: { publishedAt: null } })).toBe(2);
    publish.mockRestore();
    expect((await post(`${base()}/requests/${r.id}/submit`)).body.status).toBe('PENDING_AUTHORIZATION');
    expect(await prisma.intelligenceTransition.count({ where: { publishedAt: null } })).toBe(0);
    expect(await prisma.intelligenceTransition.count()).toBe(3);
  });

  it('supports actual multiline PDF context using the same Phase 2 processor', async () => {
    const other = await post('/api/cases', inv, { title: 'PDF context case' }); caseId = other.body.id;
    const text = await readFile(path.join(__dirname, '../../prisma/fixtures/synthetic-fir-theft.txt'), 'utf8');
    const upload = await request(app).post(`/api/cases/${caseId}/documents`).set('Authorization', `Bearer ${inv}`)
      .attach('file', await buildTestPdf(text), { filename: 'theft.pdf', contentType: 'application/pdf' });
    expect((await post(`/api/cases/${caseId}/documents/${upload.body.id}/process`)).status).toBe(201);
    const gaps = await generate();
    expect(gaps.map(g => g.sourceId).sort()).toEqual(['mock-criminal-history','mock-location','mock-vehicle']);
  });

  it('backfills legacy Phase 2 page cache using existing processors without replacing mentions', async () => {
    const { Prisma } = await import('@prisma/client');
    const before = await prisma.mention.findMany({ where: { documentId } });
    await prisma.document.update({ where: { id: documentId }, data: { extractedPages: Prisma.DbNull } });
    expect(await generate()).toHaveLength(3);
    expect(await prisma.mention.findMany({ where: { documentId } })).toEqual(before);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: documentId } })).extractedPages).not.toBeNull();
  });

  it('detects returned-package tampering and never exposes blob paths', async () => {
    const r = await authorized(); await post(`${base()}/requests/${r.id}/dispatch`);
    const doc = await prisma.document.findFirstOrThrow({ where: { caseId, sourceType: 'external_package' } });
    await writeFile(doc.blobPath, 'tampered');
    const response = await get(`${base()}/requests/${r.id}/response`);
    expect(response.status).toBe(500);
    expect(response.body.error).toContain('integrity');
    expect(JSON.stringify(response.body)).not.toContain(doc.blobPath);
  });

  it('runs the scam fixture through Phase 2 and exchanges only its three relevant sources', async () => {
    const other = await post('/api/cases', inv, { title: 'Synthetic scam demo' }); caseId = other.body.id;
    await prisma.caseAssignment.create({ data: { caseId, userId: supervisorId, role: 'supervisor' } });
    await fixture('online-scam');
    const gaps = await generate();
    expect(gaps.map(g => g.sourceId).sort()).toEqual(['mock-cdr','mock-cyber','mock-financial']);
    for (const gap of gaps) {
      await post(`${base()}/gaps/${gap.id}/review`, inv, { decision: 'select', note: 'Verify reported fraud.' });
      const r = await post(`${base()}/requests`, inv, { gapId: gap.id });
      await post(`${base()}/requests/${r.body.id}/submit`);
      await post(`${base()}/requests/${r.body.id}/authorize`, sup, { approved: true, reason: 'Scoped.' });
      const received = await post(`${base()}/requests/${r.body.id}/dispatch`);
      expect(received.body.status).toBe('RECEIVED');
      expect(received.body.source.id).toBe(gap.sourceId);
    }
  });
});
