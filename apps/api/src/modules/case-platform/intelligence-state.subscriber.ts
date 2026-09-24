import { eventBus, type DomainEvent } from '../../core/domain-events';
import { prisma } from '../../core/db';
import { DocumentIntelligenceEvents } from '../document-intelligence/events';
import type { ExtractionCompletedPayload } from '../document-intelligence/events';

/**
 * `case-platform` owns `CaseIntelligenceState` (module ownership table,
 * IMPLEMENTATION-BLUEPRINT.md §3) — it's the reader, document-intelligence
 * only ever *publishes* `ExtractionCompleted` on the existing `eventBus`.
 * Reuses the existing in-process event bus; no new pub/sub mechanism.
 *
 * Payload carries *absolute* per-document counts (not deltas), so a
 * reprocessed document overwrites its own entry here instead of double
 * counting — matching the same idempotency guarantee as the mention table
 * itself.
 */
let subscribed = false;

export function registerCaseIntelligenceStateSubscriber(): void {
  if (subscribed) {
    return;
  }
  subscribed = true;

  eventBus.subscribe(DocumentIntelligenceEvents.EXTRACTION_COMPLETED, {
    async handle(event: DomainEvent) {
      const payload = event.payload as unknown as ExtractionCompletedPayload;

      const state = await prisma.caseIntelligenceState.findUnique({ where: { caseId: payload.caseId } });
      if (!state) {
        // Defensive only — every Case gets a CaseIntelligenceState at
        // creation time (case.service.ts). Don't fail the extraction
        // request over a missing summary row.
        return;
      }

      const summary = (state.summary as Record<string, unknown>) ?? {};
      const documents = (summary.documents as Record<string, unknown>) ?? {};

      await prisma.caseIntelligenceState.update({
        where: { caseId: payload.caseId },
        data: {
          version: { increment: 1 },
          summary: {
            ...summary,
            documents: {
              ...documents,
              [payload.documentId]: {
                mentionsTotal: payload.mentionsTotal,
                mentionCountsByType: payload.mentionCountsByType,
                lastExtractedAt: new Date().toISOString(),
              },
            },
          },
        },
      });
    },
  });
}
