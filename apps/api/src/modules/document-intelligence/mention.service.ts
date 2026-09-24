import { AuditAction, AuditResourceType, DocumentProcessingStatus, ExtractionMethod } from '@sih/shared';
import type {
  DocumentProcessingStatus as PrismaDocumentProcessingStatus,
  ExtractionMethod as PrismaExtractionMethod,
  MentionType as PrismaMentionType,
} from '@prisma/client';
import { prisma } from '../../core/db';
import { eventBus } from '../../core/domain-events';
import { ApplicationError, FileError, NotFoundError, ValidationError } from '../../core/errors';
import { auditService } from '../audit/audit.service';
import { getDocumentProcessor } from './processors';
import { extractMentions } from './extractors';
import { DocumentIntelligenceEvents } from './events';
import type { ExtractionCompletedPayload, ExtractionFailedPayload } from './events';

export interface ProcessDocumentOptions {
  force?: boolean;
}

/**
 * `IDocumentProcessor`-consuming orchestrator for the Phase 2 pipeline:
 * Evidence (already stored) → text extraction → deterministic mention
 * extraction → provenance-bound persistence → processing status → domain
 * events. Mentions are always DERIVED — the source Document/EvidenceRecord
 * remains authoritative (SYSTEM-ARCHITECTURE.md §3); this service never
 * mutates or duplicates the original evidence.
 *
 * Case access: both public methods are called from routes shaped
 * `/cases/:caseId/documents/:documentId/...`, so — matching the existing
 * evidence-store convention — case ABAC (`requireCaseAccess`) runs as route
 * middleware, not re-checked here. What IS checked here is that `documentId`
 * actually belongs to the `caseId` in the path: without that, a user
 * authorized on case A could reach case B's document by pairing A's caseId
 * with B's documentId in the URL. That's a path/resource-consistency check,
 * not a duplicate of the ABAC primitive itself.
 */
export class DocumentIntelligenceService {
  private async loadDocumentInCase(caseId: string, documentId: string) {
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (!document || document.caseId !== caseId) {
      // Same response either way — existence of a document in a *different*
      // case is not revealed to a caller only authorized on this one.
      throw new NotFoundError('Document not found');
    }
    return document;
  }

  /**
   * Idempotent by default: a COMPLETED document returns its existing
   * mentions without re-extracting. Pass `force: true` to reprocess — the
   * previous mention set for this document is replaced (deleted + recreated
   * in one transaction), so reprocessing never accumulates duplicates.
   */
  async processDocument(
    caseId: string,
    documentId: string,
    actor: { id: string; email: string },
    options: ProcessDocumentOptions = {},
    ipAddress?: string,
  ) {
    const document = await this.loadDocumentInCase(caseId, documentId);

    if (document.processingStatus === (DocumentProcessingStatus.PROCESSING as unknown as PrismaDocumentProcessingStatus)) {
      throw new ValidationError('Document is already being processed');
    }

    if (
      document.processingStatus === (DocumentProcessingStatus.COMPLETED as unknown as PrismaDocumentProcessingStatus) &&
      !options.force
    ) {
      const mentions = await prisma.mention.findMany({ where: { documentId }, orderBy: { extractedAt: 'asc' } });
      return { document, mentions, reused: true };
    }

    await prisma.document.update({
      where: { id: documentId },
      data: {
        processingStatus: DocumentProcessingStatus.PROCESSING as unknown as PrismaDocumentProcessingStatus,
        processingError: null,
      },
    });

    await eventBus.publish({
      id: eventBus.generateId(),
      type: DocumentIntelligenceEvents.DOCUMENT_INGESTED,
      payload: { caseId: document.caseId, documentId: document.id },
      timestamp: Date.now(),
    });

    try {
      const processor = getDocumentProcessor(document.mimeType);
      const extraction = await processor.extract({
        documentId: document.id,
        caseId: document.caseId,
        blobPath: document.blobPath,
        mimeType: document.mimeType,
      });

      const candidates = extractMentions(extraction.pages);
      const evidenceRecord = await prisma.evidenceRecord.findFirst({ where: { documentId } });

      const mentions = await prisma.$transaction(async (tx) => {
        await tx.mention.deleteMany({ where: { documentId } });

        if (candidates.length > 0) {
          await tx.mention.createMany({
            data: candidates.map((c) => ({
              caseId: document.caseId,
              documentId: document.id,
              evidenceRecordId: evidenceRecord?.id ?? null,
              mentionType: c.mentionType as unknown as PrismaMentionType,
              text: c.text,
              normalizedText: c.normalizedText ?? null,
              confidence: c.confidence,
              pageNumber: c.pageNumber,
              startOffset: c.startOffset,
              endOffset: c.endOffset,
              extractionMethod: ExtractionMethod.REGEX as unknown as PrismaExtractionMethod,
            })),
          });
        }

        await tx.document.update({
          where: { id: documentId },
          data: {
            processingStatus: DocumentProcessingStatus.COMPLETED as unknown as PrismaDocumentProcessingStatus,
            processedAt: new Date(),
            processingError: null,
          },
        });

        return tx.mention.findMany({ where: { documentId }, orderBy: { extractedAt: 'asc' } });
      });

      const mentionCountsByType = countByType(mentions);

      await auditService.emit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: AuditAction.DOCUMENT_PROCESS,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: document.id,
        caseId: document.caseId,
        ipAddress,
        metadata: { status: 'completed', mentionsTotal: mentions.length, mentionCountsByType, forced: !!options.force },
      });

      const completedPayload: ExtractionCompletedPayload = {
        caseId: document.caseId,
        documentId: document.id,
        mentionsTotal: mentions.length,
        mentionCountsByType,
      };
      await eventBus.publish({
        id: eventBus.generateId(),
        type: DocumentIntelligenceEvents.EXTRACTION_COMPLETED,
        payload: completedPayload as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      });

      const updatedDocument = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
      return { document: updatedDocument, mentions, reused: false };
    } catch (err) {
      // Sanitized failure message only — never persist/emit raw stack
      // traces or internal paths (blobPath, DB details) to processingError.
      const message = err instanceof ApplicationError ? err.message : 'Document processing failed';

      await prisma.document.update({
        where: { id: documentId },
        data: {
          processingStatus: DocumentProcessingStatus.FAILED as unknown as PrismaDocumentProcessingStatus,
          processingError: message.slice(0, 500),
        },
      });

      await auditService.emit({
        actorId: actor.id,
        actorEmail: actor.email,
        action: AuditAction.DOCUMENT_PROCESS,
        resourceType: AuditResourceType.DOCUMENT,
        resourceId: document.id,
        caseId: document.caseId,
        ipAddress,
        metadata: { status: 'failed', error: message },
      });

      const failedPayload: ExtractionFailedPayload = { caseId: document.caseId, documentId: document.id, error: message };
      await eventBus.publish({
        id: eventBus.generateId(),
        type: DocumentIntelligenceEvents.EXTRACTION_FAILED,
        payload: failedPayload as unknown as Record<string, unknown>,
        timestamp: Date.now(),
      });

      if (err instanceof ApplicationError) {
        throw err;
      }
      throw new FileError('Document processing failed');
    }
  }

  async listMentions(caseId: string, documentId: string, _actor: { id: string }) {
    await this.loadDocumentInCase(caseId, documentId);
    return prisma.mention.findMany({ where: { documentId }, orderBy: { extractedAt: 'asc' } });
  }
}

function countByType(mentions: { mentionType: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of mentions) {
    counts[m.mentionType] = (counts[m.mentionType] ?? 0) + 1;
  }
  return counts;
}

export const documentIntelligenceService = new DocumentIntelligenceService();
