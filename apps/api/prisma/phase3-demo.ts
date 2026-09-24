import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { UserRole } from '@sih/shared';
import { prisma } from '../src/core/db';
import { evidenceStoreService } from '../src/modules/evidence-store/evidence.service';
import { documentIntelligenceService } from '../src/modules/document-intelligence/mention.service';
import { intelligenceService, type IntelligenceActor } from '../src/modules/intelligence-requirements/intelligence.service';

export async function seedPhase3Demo(investigator: { id: string; email: string }, supervisor: { id: string }) {
  const actor: IntelligenceActor = { ...investigator, role: UserRole.INVESTIGATOR };
  const cases = [];
  for (const scenario of [
    { ref: 'REF-2026-DEMO-THEFT', title: 'Synthetic vehicle theft', fixture: 'theft', expected: ['mock-criminal-history','mock-location','mock-vehicle'] },
    { ref: 'REF-2026-DEMO-SCAM', title: 'Synthetic online payment fraud', fixture: 'online-scam', expected: ['mock-cdr','mock-cyber','mock-financial'] },
  ]) {
    const kase = await prisma.case.upsert({ where: { caseId: scenario.ref }, update: {}, create: {
      caseId: scenario.ref, title: scenario.title, description: 'Fictional Phase 3 demonstration; no real intelligence sources.',
      classification: 'restricted', jurisdiction: 'Demo Jurisdiction', createdById: investigator.id,
      intelligenceState: { create: { summary: {} } },
    } });
    for (const user of [{ id: investigator.id, role: 'investigator' as const }, { id: supervisor.id, role: 'supervisor' as const }]) {
      await prisma.caseAssignment.upsert({ where: { caseId_userId: { caseId: kase.id, userId: user.id } },
        update: {}, create: { caseId: kase.id, userId: user.id, role: user.role } });
    }
    const filename = `synthetic-fir-${scenario.fixture}.txt`;
    let document = await prisma.document.findFirst({ where: { caseId: kase.id, filename } });
    if (!document) {
      document = (await evidenceStoreService.uploadDocument({ caseId: kase.id, filename, mimeType: 'text/plain',
        buffer: await readFile(path.join(__dirname, 'fixtures', filename)), uploadedById: investigator.id, actorEmail: investigator.email })).document;
    }
    await documentIntelligenceService.processDocument(kase.id, document.id, actor);
    const result = await intelligenceService.analyze(kase.id, actor);
    const actual = result.gaps.filter(g => g.status !== 'STALE').map(g => g.sourceId).sort();
    if (JSON.stringify(actual) !== JSON.stringify(scenario.expected)) throw new Error(`Unexpected source selection for ${scenario.ref}`);
    cases.push({ case: kase, gaps: result.gaps, expectedSources: scenario.expected });
  }
  return cases;
}
