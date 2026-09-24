-- Phase 2 migration: FIR & document intelligence.
-- Hand-authored for the same reason as the Phase 1 baseline migration (see
-- 20260901000000_init/migration.sql header) — this sandbox cannot reach
-- binaries.prisma.sh to run `prisma migrate dev`. Verify with:
--   npx prisma migrate diff \
--     --from-migrations ./prisma/migrations \
--     --to-schema-datamodel ./prisma/schema.prisma \
--     --shadow-database-url "$DATABASE_URL" --script
-- before relying on this in an environment with real Prisma engine access.

-- ─── New enum value on an existing type ────────────────────────────────
-- Run as its own statement (not batched into a later CREATE TABLE that
-- uses it) so it's safe under Postgres's "can't use a just-added enum
-- value in the same transaction" rule if this script is ever wrapped in
-- an explicit transaction by a migration runner.

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'document_process';

-- ─── New enums ──────────────────────────────────────────────────────────

CREATE TYPE "DocumentProcessingStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TYPE "MentionType" AS ENUM (
  'person',
  'phone',
  'vehicle',
  'location',
  'organization',
  'case_identifier',
  'date',
  'money'
);

CREATE TYPE "ExtractionMethod" AS ENUM ('regex', 'llm');

-- ─── documents: processing columns ─────────────────────────────────────

ALTER TABLE "documents" ADD COLUMN "processingStatus" "DocumentProcessingStatus" NOT NULL DEFAULT 'pending';
ALTER TABLE "documents" ADD COLUMN "processingError" TEXT;
ALTER TABLE "documents" ADD COLUMN "processedAt" TIMESTAMP(3);

-- ─── mentions ───────────────────────────────────────────────────────────

CREATE TABLE "mentions" (
  "id" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "evidenceRecordId" TEXT,
  "mentionType" "MentionType" NOT NULL,
  "text" TEXT NOT NULL,
  "normalizedText" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL,
  "pageNumber" INTEGER,
  "startOffset" INTEGER,
  "endOffset" INTEGER,
  "extractionMethod" "ExtractionMethod" NOT NULL DEFAULT 'regex',
  "extractedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mentions_caseId_idx" ON "mentions"("caseId");
CREATE INDEX "mentions_documentId_idx" ON "mentions"("documentId");
CREATE INDEX "mentions_mentionType_idx" ON "mentions"("mentionType");

ALTER TABLE "mentions" ADD CONSTRAINT "mentions_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mentions" ADD CONSTRAINT "mentions_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mentions" ADD CONSTRAINT "mentions_evidenceRecordId_fkey"
  FOREIGN KEY ("evidenceRecordId") REFERENCES "evidence_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
