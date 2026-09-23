import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Passw0rd!2026';

async function upsertUser(email: string, name: string, role: 'investigator' | 'supervisor' | 'auditor' | 'admin') {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash },
  });
}

async function main() {
  console.log('Seeding Phase 1 demo data...');

  const investigator = await upsertUser('investigator@ncrb.demo', 'Investigator Rao', 'investigator');
  const supervisor = await upsertUser('supervisor@ncrb.demo', 'Supervisor Iyer', 'supervisor');
  await upsertUser('auditor@ncrb.demo', 'Auditor Singh', 'auditor');
  await upsertUser('admin@ncrb.demo', 'Admin Verma', 'admin');

  // D5: primary demo scenario is "Operation Crosslink" — seed the case shell
  // now; FIR upload + downstream phases populate the rest as they land.
  const existing = await prisma.case.findFirst({ where: { title: 'Operation Crosslink' } });
  if (!existing) {
    const kase = await prisma.case.create({
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
    console.log('Demo case already exists, skipping.');
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
