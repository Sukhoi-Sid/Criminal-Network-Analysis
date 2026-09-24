# Phase 2 Status — FIR & Document Intelligence

## What's implemented

| Area | Files |
|---|---|
| Processor abstraction (D7) | `apps/api/src/modules/document-intelligence/processors.ts` — `IDocumentProcessor` interface + `PdfTextProcessor` (via `pdf-parse`, per-page text) + `PlainTextProcessor`, registry keyed by mimeType |
| Deterministic extraction | `apps/api/src/modules/document-intelligence/extractors.ts` — regex/rule-based matchers for all 8 required mention types |
| Orchestration | `apps/api/src/modules/document-intelligence/mention.service.ts` — ingest → extract → persist → status → events, idempotent |
| Events | `apps/api/src/modules/document-intelligence/events.ts` — `DocumentIngested` / `ExtractionCompleted` / `ExtractionFailed` on the **existing** `eventBus` |
| Case Intelligence State subscriber | `apps/api/src/modules/case-platform/intelligence-state.subscriber.ts` — reacts to `ExtractionCompleted`, owned by case-platform per the module-ownership table |
| Routes | `apps/api/src/modules/document-intelligence/mention.routes.ts` — process + list-mentions, case-scoped |
| Schema | `Document.processingStatus/processingError/processedAt` (additive columns) + new `Mention` model, `DocumentProcessingStatus`/`MentionType`/`ExtractionMethod` enums |
| Migration | `apps/api/prisma/migrations/20260910000000_phase2_document_intelligence/` — applied to live Postgres, verified via `psql \d` |
| Shared contracts | `packages/shared/src/index.ts` — additive only: 3 new enums, `AuditAction.DOCUMENT_PROCESS`, extended `DocumentDto`, new `MentionDto`/`ProcessDocumentResponse` |
| Synthetic FIR | `apps/api/prisma/fixtures/synthetic-fir-operation-crosslink.txt` — fictional, wired into `seed.ts` (uploads + processes it for the demo case via the real services, not a separate seed-only code path) |
| Tests | `apps/api/src/__tests__/document-intelligence.test.ts` |

## API surface added

- `POST /api/cases/:caseId/documents/:documentId/process` — trigger extraction. Body: `{ force?: boolean }`. `201` with fresh mentions, or `200` with cached mentions if already `completed` and not forced.
- `GET /api/cases/:caseId/documents/:documentId/mentions` — list mentions for a document.

Both reuse `authenticate` + `requirePermission(EVIDENCE_WRITE|EVIDENCE_READ)` + `requireCaseAccess` exactly as evidence-store's case-scoped routes do — no new authorization mechanism.

## Design decisions worth flagging

1. **Deterministic-only extraction, no LLM call.** The Phase 2 task instructions were explicit: "use deterministic extraction where reliable... never make the pipeline dependent on an LLM." IMPLEMENTATION-DECISIONS.md (D3) describes an `ILLMProvider` abstraction for a *future* phase; I did not build a concrete LLM-backed extractor in this pass — there's no live LLM API access in this sandbox anyway, and the task instructions prioritize deterministic extraction for MVP. If Phase 3+ wants LLM-assisted extraction, `IDocumentProcessor`/the matcher list in `extractors.ts` are the extension points; nothing here blocks that.
2. **IDOR fix specific to this module.** Both new routes take `:caseId` **and** `:documentId`. Route middleware (`requireCaseAccess`) proves the caller can access `:caseId`; the service additionally verifies the loaded document's actual `caseId` equals the path's `:caseId` before doing anything else (`loadDocumentInCase`). Without that second check, a user authorized on case A could reach case B's document by pairing A's caseId with B's documentId in the URL — same document/evidenceRecord ownership check the evidence-store fix already established, applied here since the path shape is different (caseId present) from evidence-store's by-id routes (caseId absent).
3. **Idempotency implementation.** `processDocument` always deletes and recreates a document's mention set inside one transaction (not conditionally on `force`) — this is simpler than conditional deletion and gives the same guarantee: a document's mention count in the DB always equals exactly what the most recent extraction produced, never more.
4. **CaseIntelligenceState update is per-document, not cumulative.** The event payload carries *absolute* counts for the document that was just processed; the subscriber writes/overwrites `summary.documents[documentId]`. This avoids double-counting on reprocess without needing to track and subtract a previous delta.
5. **Money vs. financial-identifier overlap.** Both matchers map to `MentionType.MONEY` (the required type list doesn't have a separate financial-identifier type — it says "MONEY / FINANCIAL_IDENTIFIER where reliably detectable"). The account-number matcher is label-anchored (`a/c no.`, `account no.`) specifically so it doesn't collide with the 10-digit phone-number matcher.

## What I actually verified (and what I couldn't, in this sandbox)

Same `binaries.prisma.sh` block as Phase 1 — see PHASE-1-STATUS.md for the
full picture. What's specific to Phase 2:

| Check | Result |
|---|---|
| Enum parity (`@sih/shared` vs. `schema.prisma`, all 11 enums) | ✅ Script-verified |
| Migration applied to live Postgres, `mentions` table + `documents` new columns confirmed via `\d` | ✅ |
| **Real execution** of `extractors.ts` against the sample FIR text (via `tsx`, no DB needed) | ✅ — and this caught two real bugs before they shipped (see below) |
| **Real execution** of `processors.ts` PDF extraction against a genuine multi-page PDF built with `pdfkit` (via `tsx`) | ✅ — correct per-page text + page-number provenance |
| Full HTTP+DB integration test suite (`document-intelligence.test.ts`) | ❌ Cannot run — blocked by the same missing `@prisma/client` generated output as every other test file in this repo |
| `tsc`/build for `apps/api` | ❌ Same reason |

**Bugs found and fixed via the real `tsx` runs** (not just static review):
- The PERSON/LOCATION/ORGANIZATION regexes used `\s+` internally, which
  matches newlines — on multi-line input this glued text across line breaks
  (e.g. `"Complainant: Rahul Sharma\nAccused: Vikram"` extracted as one
  person, `"Rahul Sharma\nAccused"`). Fixed by restricting the internal
  word-separator to `[ \t]+` (space/tab only) in all three matchers.
- The MONEY normalizer blanket-stripped everything except digits and dots,
  which left a stray leading `.` from the `Rs.` prefix (`"Rs. 85,000"` →
  `".85000"`). Fixed to extract just the trailing numeric run before
  stripping commas.

This is why I ran these standalone rather than only reading the code: the
regex/offset logic is exactly the kind of thing that looks right on
inspection and is wrong in a way only real input surfaces.

## Strict scope boundary respected

Not implemented (per explicit instruction): Entity Resolution, Knowledge
Graph, Neo4j, network/temporal/anomaly analytics, Intelligence Requirement
Engine, external data adapters (CDR/financial/criminal-history), RAG,
blockchain, advanced UI. `Mention` rows are explicitly derived/non-authoritative
(SYSTEM-ARCHITECTURE.md §3, §12) — nothing here resolves a mention to a
real-world entity or merges mentions across documents.

## Open items for review

1. Cannot literally run the test suite in this sandbox (see above) — the
   tests are written and the extraction logic they exercise was verified by
   direct execution, but the full HTTP/DB path needs a normal-network
   machine to confirm.
2. `CASE_IDENTIFIER` mentions currently include the label text in both
   `text` and `normalizedText` (e.g. `"FIR No: FIR-2026/00417"` rather than
   just `"FIR-2026/00417"`). Acceptable for MVP; a follow-up could narrow
   this to a capture group like the person/org/location matchers do.
3. `DocumentProcessingStatus`/`ExtractionMethod`/`MentionType` were added to
   the shared package additively — no existing export was changed or
   removed, but this is still a shared-contract change, flagging per the
   "do not silently modify architectural decisions" instruction even though
   it's additive, not a conflict.
