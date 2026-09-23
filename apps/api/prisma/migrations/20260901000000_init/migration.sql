-- Phase 1 baseline migration.
-- Hand-authored to match apps/api/prisma/schema.prisma exactly, because this
-- sandbox has no network/DB access to run `prisma migrate dev` and let the
-- engine generate it. Before relying on this in a real environment, run:
--   npx prisma migrate diff \
--     --from-migrations ./prisma/migrations \
--     --to-schema-datamodel ./prisma/schema.prisma \
--     --shadow-database-url "$DATABASE_URL" --script
-- to confirm there is zero drift from what the schema now declares. If
-- `prisma migrate dev` reports drift the first time you run it against a
-- real dev database, let it generate the corrective migration rather than
-- editing this file by hand.

-- ─── Enums ──────────────────────────────────────────────────────────────

CREATE TYPE "UserRole" AS ENUM ('investigator', 'supervisor', 'auditor', 'admin');

CREATE TYPE "CaseStatus" AS ENUM ('open', 'active', 'on_hold', 'closed');

CREATE TYPE "CaseClassification" AS ENUM ('restricted', 'confidential', 'secret');

CREATE TYPE "CaseAssignmentRole" AS ENUM ('investigator', 'supervisor');

CREATE TYPE "AuditAction" AS ENUM (
  'login',
  'logout',
  'login_failed',
  'case_create',
  'case_read',
  'case_update',
  'case_assign',
  'evidence_document_create',
  'evidence_document_read',
  'user_create',
  'user_update',
  'audit_read',
  'access_denied'
);

CREATE TYPE "AuditResourceType" AS ENUM ('user', 'case', 'document', 'evidence', 'audit', 'session');

CREATE TYPE "EvidenceSourceType" AS ENUM ('fir_upload', 'report_upload', 'attachment', 'external_package');

CREATE TYPE "ReliabilityTier" AS ENUM (
  'tier1_authoritative',
  'tier2_operational',
  'tier3_derived',
  'tier4_unverified'
);

-- ─── users ──────────────────────────────────────────────────────────────

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- ─── cases ──────────────────────────────────────────────────────────────

CREATE TABLE "cases" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" "CaseStatus" NOT NULL DEFAULT 'open',
  "classification" "CaseClassification" NOT NULL DEFAULT 'restricted',
  "jurisdiction" TEXT,
  "contextSummary" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cases_caseId_key" ON "cases"("caseId");
CREATE INDEX "cases_createdById_idx" ON "cases"("createdById");

-- ─── case_assignments ───────────────────────────────────────────────────

CREATE TABLE "case_assignments" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "CaseAssignmentRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_assignments_caseId_userId_key" ON "case_assignments"("caseId", "userId");
CREATE INDEX "case_assignments_userId_idx" ON "case_assignments"("userId");

-- ─── case_intelligence_states ───────────────────────────────────────────

CREATE TABLE "case_intelligence_states" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "summary" JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_intelligence_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_intelligence_states_caseId_key" ON "case_intelligence_states"("caseId");

-- ─── audit_events ───────────────────────────────────────────────────────

CREATE TABLE "audit_events" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorEmail" TEXT,
  "action" "AuditAction" NOT NULL,
  "resourceType" "AuditResourceType" NOT NULL,
  "resourceId" TEXT,
  "caseId" TEXT,
  "metadata" JSONB,
  "ipAddress" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "audit_events_caseId_idx" ON "audit_events"("caseId");
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");
CREATE INDEX "audit_events_action_idx" ON "audit_events"("action");

-- ─── documents ──────────────────────────────────────────────────────────

CREATE TABLE "documents" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "blobPath" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sourceType" "EvidenceSourceType" NOT NULL,
  "uploadedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "documents_caseId_idx" ON "documents"("caseId");

-- ─── evidence_records ───────────────────────────────────────────────────

CREATE TABLE "evidence_records" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "documentId" TEXT,
  "sourceType" "EvidenceSourceType" NOT NULL,
  "sourceRecordId" TEXT NOT NULL,
  "reliabilityTier" "ReliabilityTier" NOT NULL DEFAULT 'tier1_authoritative',
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "evidence_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evidence_records_caseId_idx" ON "evidence_records"("caseId");

-- ─── provenance_records ─────────────────────────────────────────────────

CREATE TABLE "provenance_records" (
  "id" TEXT NOT NULL,
  "evidenceRecordId" TEXT NOT NULL,
  "originSource" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" TEXT NOT NULL,
  "transformationChain" JSONB NOT NULL DEFAULT '[]',
  "parentEvidenceId" TEXT,
  "contentHash" TEXT NOT NULL,
  "integrityAnchorId" TEXT,

  CONSTRAINT "provenance_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "provenance_records_evidenceRecordId_key" ON "provenance_records"("evidenceRecordId");

-- ─── Foreign keys ───────────────────────────────────────────────────────

ALTER TABLE "cases" ADD CONSTRAINT "cases_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "case_assignments" ADD CONSTRAINT "case_assignments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "case_intelligence_states" ADD CONSTRAINT "case_intelligence_states_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_evidenceRecordId_fkey"
  FOREIGN KEY ("evidenceRecordId") REFERENCES "evidence_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
