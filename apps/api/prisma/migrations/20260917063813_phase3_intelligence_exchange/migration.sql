-- CreateEnum
CREATE TYPE "IntelligenceGapStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED', 'REQUESTED', 'RESOLVED', 'STALE');

-- CreateEnum
CREATE TYPE "IntelligencePriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "IntelligenceRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'PENDING_AUTHORIZATION', 'AUTHORIZED', 'REJECTED', 'DISPATCHED', 'RECEIVED', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'intelligence_analyze';
ALTER TYPE "AuditAction" ADD VALUE 'intelligence_read';
ALTER TYPE "AuditAction" ADD VALUE 'intelligence_review';
ALTER TYPE "AuditAction" ADD VALUE 'intelligence_request_create';
ALTER TYPE "AuditAction" ADD VALUE 'intelligence_transition';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditResourceType" ADD VALUE 'intelligence_gap';
ALTER TYPE "AuditResourceType" ADD VALUE 'intelligence_request';

-- DropIndex
DROP INDEX "case_assignments_userId_idx";

-- DropIndex
DROP INDEX "cases_createdById_idx";

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "extractedPages" JSONB;

-- CreateTable
CREATE TABLE "case_context_analyses" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "registryVersion" TEXT NOT NULL,
    "rationale" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_context_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_sources" (
    "id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "synthetic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "intelligence_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_gaps" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "caseType" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "requiredData" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetEntity" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "timeFrom" TIMESTAMP(3) NOT NULL,
    "timeTo" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "priority" "IntelligencePriority" NOT NULL,
    "priorityReason" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "status" "IntelligenceGapStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intelligence_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_gap_origins" (
    "id" TEXT NOT NULL,
    "gapId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "evidenceRecordId" TEXT,
    "mentionId" TEXT,
    "snapshot" JSONB NOT NULL,

    CONSTRAINT "intelligence_gap_origins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_requests" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "gapId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scope" JSONB NOT NULL,
    "status" "IntelligenceRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intelligence_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_authorizations" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "authorizedById" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_responses" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "evidenceRecordId" TEXT NOT NULL,
    "receiptKey" TEXT NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intelligence_transitions" (
    "sequence" SERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "fromStatus" "IntelligenceRequestStatus",
    "toStatus" "IntelligenceRequestStatus" NOT NULL,
    "eventType" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intelligence_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "case_context_analyses_caseId_key" ON "case_context_analyses"("caseId");

-- CreateIndex
CREATE INDEX "intelligence_gaps_caseId_status_idx" ON "intelligence_gaps"("caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_gaps_caseId_fingerprint_key" ON "intelligence_gaps"("caseId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_gaps_id_caseId_key" ON "intelligence_gaps"("id", "caseId");

-- CreateIndex
CREATE INDEX "intelligence_gap_origins_gapId_idx" ON "intelligence_gap_origins"("gapId");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_requests_gapId_key" ON "intelligence_requests"("gapId");

-- CreateIndex
CREATE INDEX "intelligence_requests_caseId_status_idx" ON "intelligence_requests"("caseId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_requests_gapId_caseId_key" ON "intelligence_requests"("gapId", "caseId");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_authorizations_requestId_key" ON "intelligence_authorizations"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_responses_requestId_key" ON "intelligence_responses"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_responses_evidenceRecordId_key" ON "intelligence_responses"("evidenceRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "intelligence_responses_receiptKey_key" ON "intelligence_responses"("receiptKey");

-- CreateIndex
CREATE INDEX "intelligence_transitions_requestId_createdAt_idx" ON "intelligence_transitions"("requestId", "createdAt");
CREATE UNIQUE INDEX "intelligence_transitions_sequence_key" ON "intelligence_transitions"("sequence");

ALTER TABLE "intelligence_gaps" ADD CONSTRAINT "intelligence_gaps_valid_window" CHECK ("timeFrom" <= "timeTo");
ALTER TABLE "intelligence_gaps" ADD CONSTRAINT "intelligence_gaps_required_scope" CHECK (
  length(trim("targetEntity")) > 0 AND length(trim("requiredData")) > 0 AND length(trim("purpose")) > 0 AND length(trim("explanation")) > 0
);

-- AddForeignKey
ALTER TABLE "case_context_analyses" ADD CONSTRAINT "case_context_analyses_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gaps" ADD CONSTRAINT "intelligence_gaps_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gaps" ADD CONSTRAINT "intelligence_gaps_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "intelligence_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gaps" ADD CONSTRAINT "intelligence_gaps_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gap_origins" ADD CONSTRAINT "intelligence_gap_origins_gapId_fkey" FOREIGN KEY ("gapId") REFERENCES "intelligence_gaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gap_origins" ADD CONSTRAINT "intelligence_gap_origins_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gap_origins" ADD CONSTRAINT "intelligence_gap_origins_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "evidence_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_gap_origins" ADD CONSTRAINT "intelligence_gap_origins_mentionId_fkey" FOREIGN KEY ("mentionId") REFERENCES "mentions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_requests" ADD CONSTRAINT "intelligence_requests_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_requests" ADD CONSTRAINT "intelligence_requests_gapId_caseId_fkey" FOREIGN KEY ("gapId", "caseId") REFERENCES "intelligence_gaps"("id", "caseId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_requests" ADD CONSTRAINT "intelligence_requests_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "intelligence_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_requests" ADD CONSTRAINT "intelligence_requests_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_authorizations" ADD CONSTRAINT "intelligence_authorizations_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "intelligence_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_authorizations" ADD CONSTRAINT "intelligence_authorizations_authorizedById_fkey" FOREIGN KEY ("authorizedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_responses" ADD CONSTRAINT "intelligence_responses_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "intelligence_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_responses" ADD CONSTRAINT "intelligence_responses_evidenceRecordId_fkey" FOREIGN KEY ("evidenceRecordId") REFERENCES "evidence_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_transitions" ADD CONSTRAINT "intelligence_transitions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "intelligence_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intelligence_transitions" ADD CONSTRAINT "intelligence_transitions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
