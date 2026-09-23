# Implementation Decisions

**Status:** FROZEN  
**Related:** [IMPLEMENTATION-BLUEPRINT.md](./IMPLEMENTATION-BLUEPRINT.md)

---

## Locked Implementation Decisions

| ID | Decision | Detail | Status |
|---|---|---|---|
| **D1** | Graph database | **Neo4j** for derived Knowledge Graph in MVP | Locked |
| **D2** | Repository structure | **Monorepo** with npm/pnpm workspaces | Locked |
| **D3** | LLM integration | **External LLM API** for extraction and RAG, behind **`ILLMProvider` abstraction** | Locked |
| **D4** | Integrity / blockchain MVP | **Local integrity/hash ledger** (PostgreSQL table + verify API); blockchain boundary extensible for production | Locked |
| **D5** | Primary demo scenario | One complete scripted **Operation Crosslink** investigation | Locked |
| **D6** | Frontend graph | **React** with **Cytoscape.js** for investigator network experience | Locked |
| **D7** | Document ingestion MVP | **PDF and text** FIR ingestion; document-intelligence boundary **extensible** for scanned/image and Hindi without multilingual OCR over-engineering now | Locked |

---

## Storage Decisions (Derived from D1, D4)

| Store | Choice | Role |
|---|---|---|
| PostgreSQL | Primary operational DB | Cases, users, requests, entities, findings, audit, integrity metadata |
| Neo4j | Derived graph (D1) | Case-scoped analytical graph — rebuildable from evidence |
| Blob storage | Filesystem or S3-compatible | Raw documents and external packages |
| pgvector (optional) | PostgreSQL extension | RAG embeddings |
| Local hash ledger (D4) | PostgreSQL `integrity_anchors` | MVP tamper-evident anchoring |

---

## Deployment Decision

| Aspect | MVP | Future |
|---|---|---|
| Backend | Single modular monolith (`apps/api`) | Optional split of Gateway or Brain if scale demands |
| Frontend | Single SPA (`apps/web`) | Mobile/field app against same API |
| Services | In-process module boundaries + domain events | Same interfaces → separate deployables |

---

## LLM Provider Abstraction (D3)

```
ILLMProvider
  ├── extractEntities(documentContent, context): ExtractionResult
  ├── extractEvents(documentContent, context): EventExtractionResult
  └── generateGroundedAnswer(question, retrievalContext): GroundedAnswer
```

Implementations: swappable (e.g. OpenAI, Gemini). All outputs require provenance binding before entering evidence/graph pipeline.

---

## Document Intelligence Abstraction (D7)

```
IDocumentProcessor
  ├── supportedMimeTypes: string[]     // MVP: application/pdf, text/plain
  ├── ingest(file, caseId): DocumentRef
  └── extract(documentRef): ExtractionResult
```

Future implementations plug in without changing case platform or brain:
- `PdfTextProcessor` (MVP)
- `OcrImageProcessor` (future — scanned FIR)
- `MultilingualProcessor` (future — Hindi)

---

## Decision Change Log

| Date | ID | Change |
|---|---|---|
| 2026-09 | D1 | Neo4j selected over PostgreSQL-only graph tables |
| 2026-09 | D2–D6 | Blueprint decisions locked at freeze |
| 2026-09 | D7 | PDF/text MVP with extensible document boundary clarified |

---

## Change Control Process

1. Identify conflict with frozen blueprint or architecture
2. Document impact on modules, storage, interfaces, MVP scope
3. Obtain explicit approval
4. Update this log and IMPLEMENTATION-BLUEPRINT.md together
5. Never silently drift in implementation
