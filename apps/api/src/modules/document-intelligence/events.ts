/**
 * Domain event names for the document-intelligence pipeline, per
 * IMPLEMENTATION-BLUEPRINT.md §6 ("Domain Events (In-Process)": ...
 * DocumentIngested, ExtractionCompleted...). Published on the existing
 * `eventBus` (core/domain-events.ts) — no second event mechanism.
 * `ExtractionFailed` extends that list for operational failure signalling,
 * as named explicitly in the Phase 2 task's example flow.
 */
export const DocumentIntelligenceEvents = {
  DOCUMENT_INGESTED: 'DocumentIngested',
  EXTRACTION_COMPLETED: 'ExtractionCompleted',
  EXTRACTION_FAILED: 'ExtractionFailed',
} as const;

export interface DocumentIngestedPayload {
  caseId: string;
  documentId: string;
}

export interface ExtractionCompletedPayload {
  caseId: string;
  documentId: string;
  /** Absolute (not incremental) counts for this document's current mention set — safe to overwrite on reprocess. */
  mentionsTotal: number;
  mentionCountsByType: Record<string, number>;
}

export interface ExtractionFailedPayload {
  caseId: string;
  documentId: string;
  error: string;
}
