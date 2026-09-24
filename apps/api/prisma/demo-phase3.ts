import { UserRole } from '@sih/shared';
import { prisma } from '../src/core/db';
import { registerCaseIntelligenceStateSubscriber } from '../src/modules/case-platform/intelligence-state.subscriber';
import { intelligenceService } from '../src/modules/intelligence-requirements/intelligence.service';
import { seedPhase3Demo } from './phase3-demo';

async function main() {
  registerCaseIntelligenceStateSubscriber();
  const investigator = await prisma.user.findUniqueOrThrow({ where: { email: 'investigator@ncrb.demo' } });
  const supervisor = await prisma.user.findUniqueOrThrow({ where: { email: 'supervisor@ncrb.demo' } });
  const inv = { id: investigator.id, email: investigator.email, role: UserRole.INVESTIGATOR };
  const sup = { id: supervisor.id, email: supervisor.email, role: UserRole.SUPERVISOR };
  const scenarios = await seedPhase3Demo(inv, sup);
  const report = [];
  for (const scenario of scenarios) {
    const requests = [];
    for (const gap of scenario.gaps) {
      if (gap.status === 'STALE') continue;
      if (gap.status === 'OPEN') await intelligenceService.review(scenario.case.id, gap.id, inv, 'select', 'Synthetic demo: target, purpose and incident window checked.');
      let r = await intelligenceService.createRequest(scenario.case.id, gap.id, inv);
      if (r.status === 'DRAFT') r = await intelligenceService.submit(scenario.case.id, r.id, inv);
      if (r.status === 'PENDING_AUTHORIZATION') r = await intelligenceService.authorize(scenario.case.id, r.id, sup, true, 'Synthetic demo: independent supervisor approves the scoped requirement.');
      if (r.status === 'AUTHORIZED' || r.status === 'FAILED') r = await intelligenceService.dispatch(scenario.case.id, r.id, inv);
      if (r.status === 'RECEIVED') r = await intelligenceService.complete(scenario.case.id, r.id, inv);
      if (r.status !== 'COMPLETED') throw new Error('Demo workflow did not complete');
      const response = await intelligenceService.response(scenario.case.id, r.id, inv);
      requests.push({ id: r.id, source: r.sourceId, status: r.status, evidenceRecordId: response.evidenceRecordId });
    }
    report.push({ caseId: scenario.case.id, caseReference: scenario.case.caseId, expectedSources: scenario.expectedSources, requests });
  }
  console.log(JSON.stringify({ synthetic: true, scenarios: report }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
