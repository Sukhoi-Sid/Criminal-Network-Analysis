import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/core/db';
import { hashPassword } from '../src/modules/auth/password';
import { evidenceStoreService } from '../src/modules/evidence-store/evidence.service';
import { documentIntelligenceService } from '../src/modules/document-intelligence/mention.service';

const DEMO_PASSWORD = 'Passw0rd!2026';

async function upsertUser(email: string, name: string, role: 'investigator' | 'supervisor' | 'auditor' | 'admin') {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  console.log('Seeding demo data...');

  const investigator = await upsertUser('investigator@ncrb.demo', 'Investigator Rao', 'investigator');
  const supervisor = await upsertUser('supervisor@ncrb.demo', 'Supervisor Iyer', 'supervisor');
  await upsertUser('auditor@ncrb.demo', 'Auditor Singh', 'auditor');
  await upsertUser('admin@ncrb.demo', 'Admin Verma', 'admin');

  // D5: primary demo scenario is "Operation Crosslink".
  let kase = await prisma.case.findFirst({ where: { title: 'Operation Crosslink' } });
  if (!kase) {
    kase = await prisma.case.create({
      data: {
        caseId: 'REF-2026-CROSSLINK',
        title: 'Operation Crosslink',
        description: 'Primary scripted demo investigation (D5).',
        status: 'open',
        classification: 'confidential',
        jurisdiction: 'Demo Jurisdiction',
        createdById: investigator.id,
        assignments: {
          create: [
            { userId: investigator.id, role: 'investigator' },
            { userId: supervisor.id, role: 'supervisor' },
          ],
        },
        intelligenceState: {
          create: { version: 1, summary: {} },
        },
      },
    });
    console.log(`Created demo case: ${kase.caseId} (${kase.id})`);
  } else {
    console.log('Demo case already exists, skipping creation.');
  }

  // Phase 2 demo: upload + process the synthetic FIR, via the real
  // evidence-store + document-intelligence services (not a separate seed-only
  // code path), so the seeded case demonstrates the actual pipeline.
  const existingDoc = await prisma.document.findFirst({
    where: { caseId: kase.id, filename: 'synthetic-fir-operation-crosslink.txt' },
  });

  if (!existingDoc) {
    const fixturePath = path.join(__dirname, 'fixtures', 'synthetic-fir-operation-crosslink.txt');
    const buffer = await readFile(fixturePath);

    const { document } = await evidenceStoreService.uploadDocument({
      caseId: kase.id,
      filename: 'synthetic-fir-operation-crosslink.txt',
      mimeType: 'text/plain',
      buffer,
      uploadedById: investigator.id,
      actorEmail: 'investigator@ncrb.demo',
    });
    console.log(`Uploaded synthetic FIR as document ${document.id}`);

    const { mentions } = await documentIntelligenceService.processDocument(kase.id, document.id, {
      id: investigator.id,
      email: 'investigator@ncrb.demo',
    });
    console.log(`Extracted ${mentions.length} mentions from the synthetic FIR.`);
  } else {
    console.log('Synthetic FIR already uploaded for this case, skipping.');
  }

  console.log('\nSeed complete. Demo credentials (all use the same password):');
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log('  investigator@ncrb.demo / supervisor@ncrb.demo / auditor@ncrb.demo / admin@ncrb.demo');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
