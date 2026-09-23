import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AuditAction,
  AuditResourceType,
  EvidenceSourceType,
  ReliabilityTier,
} from '@sih/shared';
import type {
  EvidenceSourceType as PrismaEvidenceSourceType,
  ReliabilityTier as PrismaReliabilityTier,
} from '@prisma/client';
import { prisma } from '../../core/db';
import { env } from '../../core/env';
import { FileError, NotFoundError } from '../../core/errors';
import { auditService } from '../audit/audit.service';
import { assertCaseAccess } from '../auth/policies';

export interface UploadDocumentInput {
  caseId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  sourceType?: EvidenceSourceType;
  uploadedById: string;
  actorEmail: string;
  ipAddress?: string;
}

/**
 * Phase 1 skeleton for `evidence-store` (Blueprint §3, §13 — "skeleton" is
 * the deliverable here; extraction/mentions land in Phase 2's
 * `document-intelligence`). This module is the one place allowed to write
 * evidence content — everything downstream references it by id, never the
 * raw file, per SOURCE-OF-TRUTH.md principle #1.
 */
export class EvidenceStoreService {
  private hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Writes the blob to disk, indexes it as a Document, and creates a
   * matching EvidenceRecord + Provenance row so every uploaded file is
   * immediately evidence-chain-traceable (principle: "everything traceable
   * to source/time/confidence").
   */
  async uploadDocument(input: UploadDocumentInput) {
    const kase = await prisma.case.findUnique({ where: { id: input.caseId } });
    if (!kase) {
      throw new NotFoundError('Case not found');
    }

    const contentHash = this.hash(input.buffer);
    const sourceType = input.sourceType ?? EvidenceSourceType.FIR_UPLOAD;

    const caseDir = path.join(env.EVIDENCE_STORAGE_PATH, input.caseId);
    const storedFilename = `${randomUUID()}-${sanitizeFilename(input.filename)}`;
    const blobPath = path.join(caseDir, storedFilename);

    try {
      await mkdir(caseDir, { recursive: true });
      await writeFile(blobPath, input.buffer);
    } catch (err) {
      throw new FileError('Failed to write evidence blob to storage', { cause: (err as Error).message });
    }

    const { document, evidenceRecord } = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          caseId: input.caseId,
          filename: input.filename,
          mimeType: input.mimeType,
          contentHash,
          blobPath,
          sizeBytes: input.buffer.byteLength,
          sourceType: sourceType as unknown as PrismaEvidenceSourceType,
          uploadedById: input.uploadedById,
        },
      });

      const evidenceRecord = await tx.evidenceRecord.create({
        data: {
          caseId: input.caseId,
          documentId: document.id,
          sourceType: sourceType as unknown as PrismaEvidenceSourceType,
          sourceRecordId: document.id,
          reliabilityTier: ReliabilityTier.TIER1_AUTHORITATIVE as unknown as PrismaReliabilityTier,
          contentHash,
        },
      });

      await tx.provenance.create({
        data: {
          evidenceRecordId: evidenceRecord.id,
          originSource: 'investigator_upload',
          receivedById: input.uploadedById,
          transformationChain: [],
          contentHash,
        },
      });

      return { document, evidenceRecord };
    });

    await auditService.emit({
      actorId: input.uploadedById,
      actorEmail: input.actorEmail,
      action: AuditAction.EVIDENCE_DOCUMENT_CREATE,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document.id,
      caseId: input.caseId,
      ipAddress: input.ipAddress,
      metadata: { contentHash, evidenceRecordId: evidenceRecord.id },
    });

    return { document, evidenceRecord };
  }

  async listDocumentsForCase(caseId: string) {
    return prisma.document.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  }

  async getDocument(documentId: string, actor: { id: string; email: string }, ipAddress?: string) {
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (!document) {
      throw new NotFoundError('Document not found');
    }

    // SECURITY FIX: this lookup is keyed by documentId only (no caseId in
    // the route), so it previously returned any document to any user
    // holding EVIDENCE_READ — a direct IDOR (any investigator could read
    // any other investigator's case documents by guessing/incrementing
    // ids). Reuses the single case-ABAC primitive rather than
    // re-implementing the assignment check here.
    await assertCaseAccess(actor.id, document.caseId);

    await auditService.emit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AuditAction.EVIDENCE_DOCUMENT_READ,
      resourceType: AuditResourceType.DOCUMENT,
      resourceId: document.id,
      caseId: document.caseId,
      ipAddress,
    });

    return document;
  }

  async getEvidenceRecord(
    evidenceRecordId: string,
    actor: { id: string; email: string },
    ipAddress?: string,
  ) {
    const record = await prisma.evidenceRecord.findUnique({
      where: { id: evidenceRecordId },
      include: { provenance: true },
    });
    if (!record) {
      throw new NotFoundError('Evidence record not found');
    }

    // SECURITY FIX: same IDOR class as getDocument() above — evidence
    // records are keyed by their own id with no caseId in the route, so
    // this must independently assert case access rather than trusting the
    // EVIDENCE_READ permission alone.
    await assertCaseAccess(actor.id, record.caseId);

    await auditService.emit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AuditAction.EVIDENCE_DOCUMENT_READ,
      resourceType: AuditResourceType.EVIDENCE,
      resourceId: record.id,
      caseId: record.caseId,
      ipAddress,
    });

    return record;
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
}

export const evidenceStoreService = new EvidenceStoreService();
