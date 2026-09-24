# Phase 3 — Intelligence Requirement & Data Exchange

Implemented in the existing Phase 2 project from `SIH_26189_Criminal_codex start.zip`.
This is an additive extension of the frozen modular monolith. No replacement project, second extraction pipeline,
new event bus, graph, RAG, blockchain or Phase 8 frontend was introduced.

## What is implemented

| Boundary | Implementation |
|---|---|
| `intelligence-requirements` | Case-context loading/classification, configurable rules, persistent gaps, review, immutable request scope, supervisor decisions and lifecycle |
| `data-exchange` | `ISourceAdapter`, adapter registry, deterministic synthetic financial, CDR, criminal-history, vehicle, CCTV/location and cyber adapters; scoped response validation |
| Existing `document-intelligence` | Reused mentions/processors; cached extracted pages, legacy-cache backfill, ISO-date recognition; PDF Buffer compatibility fix and preserved line boundaries |
| Existing `evidence-store` | Content-addressed immutable JSON packages, Document/EvidenceRecord/Provenance receipt, verified reads |
| Existing `auth` and shared permissions | Existing JWT authentication, role-permission table and `assertCaseAccess`; Phase 3 operation/source permissions |
| Existing `audit` | Optional transaction client allows audit and workflow changes to commit together |
| Existing event bus | Gap-generated and request lifecycle events; durable request transition history with replayable delivery |
| Prisma | One additive Phase 3 migration, operational models, unique indexes, relational constraints and scope checks |

## Case-type engine and relevance

`apps/api/src/modules/intelligence-requirements/registry.ts` contains case signals, requirements, sources,
target constraints, data descriptions, purposes, time limits and priority reasons. Add a case type or mapping there;
the generic engine does not branch on theft/scam/source names. A new source adapter implements the existing
`ISourceAdapter` contract and registers in `sourceAdapters`.

The engine consumes case title/description/context summary, completed Phase 2 document pages, and persisted mentions.
Raw returned packages are excluded from document context so they cannot create a feedback loop.
For old processed documents without a page cache, the existing processor reconstructs pages once without
deleting/replacing mention records. New processing persists pages alongside the existing mention transaction.

Each suggestion requires all of the following:

1. Supported case-type signals from actual metadata/document text (`THEFT`, `ONLINE_SCAM`, `MIXED`, or `UNKNOWN`).
2. A mapped source and an extracted target of the rule's type/pattern.
3. Supporting text in the target's own sentence/line, checked against its recorded source span.
4. Valid, explicit incident/transaction dates from the same document. Filing dates are not substituted.
5. A configured purpose and explainable priority.

| Case type | Target condition | Source | Priority |
|---|---|---|---|
| THEFT | Vehicle locally associated with theft/stolen/accused/escape context | mock-vehicle | HIGH |
| THEFT | Named person with an Accused/Suspect label; no automatic checks on complainants or victims | mock-criminal-history | MEDIUM |
| THEFT | Location associated with incident/theft/CCTV context | mock-location | HIGH |
| ONLINE_SCAM | Extracted account identifier linked to reported payment/fraud, not an amount | mock-financial | HIGH |
| ONLINE_SCAM | Phone locally linked to caller/fraudster/suspect/phishing context | mock-cdr | MEDIUM |
| ONLINE_SCAM | Same supported fraudulent-contact target | mock-cyber | MEDIUM |

Time ranges use explicit `Incident date:`, `Incident window:`, `Transaction window:` (or equivalent supported labels).
Four-digit-year day/month/year, ISO dates and textual month dates are supported. Dates become inclusive UTC day
boundaries. Missing, invalid, reversed, future or excessive windows produce no gap, with a recorded exclusion reason.
CCTV/location is limited to seven days; other demo mappings to 31 days. No date or target is invented.
Numeric account identifiers are supported by the existing MONEY/financial-identifier extraction convention.
Unrecognized formats, including unsupported identifier types, require extending the same Phase 2 matcher registry.

The rationale is a rule trace quoting the actual target context, source span, window and priority reason.
These are heuristic requirements for human review, never findings of guilt or authoritative evidence.
Rule coverage is intentionally conservative; it is not general natural-language understanding.

## Persistence and idempotency

- `CaseContextAnalysis`: one current record per case; security `CaseClassification` remains unchanged.
- `IntelligenceGap`: case/type/rule, required data, target, source, window, purpose, priority/rationale, reviewer and status.
- `IntelligenceGapOrigin`: Document/EvidenceRecord/Mention FKs plus immutable mention/span snapshots.
- `IntelligenceSource`: synthetic department/category and required source permission.
- `IntelligenceRequest`: one formal request per gap; immutable server-derived scope and creator.
- `IntelligenceAuthorization`: one immutable independent supervisor decision per request, including reason/time.
- `IntelligenceResponse`: one receipt per request linked to its evidence/provenance record.
- `IntelligenceTransition`: ordered, actor-attributed lifecycle history, stable event IDs and publication timestamps.

Gap fingerprints include the registry/context digest, rule, normalized target, required data and window.
Repeated/concurrent analysis of identical context creates no duplicates. A material context change produces new
gap versions requiring new review/authorization; superseded unrequested gaps become STALE. Previously requested
gaps and scopes remain historical, and old context cannot be dispatched. Rejected requests remain terminal;
adapter failures can retry with the original authorization if the context is still current.

Per-case PostgreSQL row locks serialize Phase 3 generation/transitions. Unique constraints protect gap fingerprints,
request-per-gap, authorization-per-request, response-per-request and receipt keys. A composite FK prevents
cross-case gap/request pairing. SQL checks enforce nonempty scope and ordered time windows.

Phase 2 forced reprocessing can replace Mention IDs. Origin FKs become null, preserving document/evidence links
and exact immutable span snapshots; unchanged content retains the same context/fingerprint.

## Review, authorization and lifecycle

```text
Case + Phase 2 context
  -> classify -> relevant gaps -> investigator selects gap with review note
  -> DRAFT request (immutable scope)
  -> SUBMITTED -> PENDING_AUTHORIZATION
  -> independent assigned supervisor AUTHORIZED or REJECTED
  -> DISPATCHED -> RECEIVED -> COMPLETED
                     \-> FAILED -> authorized retry
```

SUBMITTED means submitted for internal approval, not external access. It is recorded together with
PENDING_AUTHORIZATION in a transaction. Synchronous MVP dispatch records DISPATCHED and then RECEIVED/FAILED.
Completion explicitly acknowledges a received package and resolves the gap; it does not assert that the
investigation is solved or that returned information is true.

An investigator cannot authorize. A supervisor must have both the platform role/permission and a supervisor
assignment on this case, and must be different from the request creator and gap reviewer. Admins/auditors
gain no case-content access. Source permissions use the existing role-permission mechanism; the demo grants
its six synthetic sources to investigators/supervisors, subject to case assignment and approval.

Phase 3 services recheck the live user role and reuse `assertCaseAccess`. They return identical 404s for
unassigned/missing cases and for mismatched case/resource IDs. This intentionally narrows Phase 3 existence
disclosure without changing Phase 1/2 response contracts. Access denials and successful reads are audited.
All state-changing payloads are strict; no API accepts an arbitrary status, source, target or request scope.

Request transitions and their audit events commit atomically. Ordered event history publishes through the
existing in-process bus after commit. An undelivered transition is retried on the next request operation using
the same event ID; subscribers must be idempotent (at-least-once delivery). No queue/microservice is introduced.
The gap-generated event is emitted after a successful generation transaction. No Phase 4+ subscribers run.

## Evidence and provenance

```text
Case -> uploaded Document/EvidenceRecord -> extracted Mention (or preserved span)
 -> derived Gap -> reviewed immutable Request -> supervisor Authorization
 -> synthetic Source -> Returned Intelligence -> EvidenceRecord + Provenance
```

The evidence store alone writes external package blobs. It stores JSON off-chain with SHA-256, a Document index,
an `external_package` EvidenceRecord and Provenance referencing source, receiving actor/time, request,
authorization, original evidence and all supporting span snapshots. Synthetic packages are `tier4_unverified`.
Their response relation supplies case/request/source linkage and retrieval time. Returned-package reads verify
the content hash and never return filesystem paths. No raw intelligence or hashes are submitted to blockchain.

Retry uses a deterministic receipt key and content-addressed blob filename; concurrent/repeated dispatch cannot
create duplicate response/evidence rows. As in the existing local blob architecture, a database failure after a
blob write can leave an unindexed file; the next identical retry reuses it. No destructive cleanup job is added.
Only synchronous synthetic adapters are implemented; there is no unauthenticated callback ingestion endpoint.

## API guide

All routes are under `/api/cases/:caseId/intelligence` and require a Bearer token.
All JSON mutation bodies are strict. New and reused request creation both return 200 for retry consistency.

| Method | Suffix | Body/result |
|---|---|---|
| POST | `/analyze` | `{}`; current classification, generated IDs, persistent gaps |
| GET | `/context` | Current classification, context digest and matching/exclusion rationale |
| GET | `/gaps` | Case/source-scoped `{ items, total }` |
| GET | `/gaps/:gapId` | Gap, source and origin details |
| POST | `/gaps/:gapId/review` | `{ "decision": "select" or "dismiss", "note": "..." }` |
| POST | `/requests` | `{ "gapId": "uuid" }`; requires selected/current gap |
| GET | `/requests` | Case/source-scoped `{ items, total }` |
| GET | `/requests/:requestId` | Scope, authorization, source, receipt/provenance and ordered history |
| POST | `/requests/:requestId/submit` | `{}` |
| POST | `/requests/:requestId/authorize` | `{ "approved": true or false, "reason": "..." }`; independent supervisor |
| POST | `/requests/:requestId/dispatch` | `{}`; performs approved synthetic exchange or retries FAILED |
| GET | `/requests/:requestId/response` | Verified synthetic payload and evidence/provenance |
| POST | `/requests/:requestId/complete` | `{}`; requires received package |

Authentication uses existing `POST /api/auth/login`. Existing case/document APIs are unchanged.

## Synthetic demo

From the project root after configuring `apps/api/.env` and migrating:

```sh
pnpm build
pnpm db:seed
pnpm demo:phase3
pnpm start
```

`db:seed` preserves Operation Crosslink and adds `REF-2026-DEMO-THEFT` and `REF-2026-DEMO-SCAM`.
It uploads/processes the fixtures through real evidence/document services and generates three gaps per scenario.
`demo:phase3` explicitly simulates investigator review, independent supervisor approval, dispatch, receipt and
completion through the real workflow services. It asserts the exact source sets, so unrelated sources fail the demo.
The theft fixture includes an unrelated office phone; the scam fixture includes an unrelated vehicle/location.
Neither becomes an inappropriate request. The script is rerunnable without extra requests or packages.

Existing demo credentials: `investigator@ncrb.demo` and `supervisor@ncrb.demo`, password `Passw0rd!2026`.
These are synthetic local-demo credentials only.

## Verification — 2026-09-17

| Check | Result |
|---|---|
| Baseline install, Prisma generation/schema validation, migrations and build | Passed before Phase 3 |
| Baseline Phase 1 + Phase 2 | 44/44 tests passed |
| Frozen-lockfile dependency validation | Passed; no new runtime dependencies |
| Phase 3 migration on existing database | Applied successfully |
| Fresh test database migration from all three migrations | Applied successfully |
| Migration status and live schema diff | Up to date; no schema difference |
| Full TypeScript check | Includes API, shared, tests, seeds, scripts and Vitest configuration |
| Shared/API production build | Passed |
| Full regression suite | 79/79: 31 Phase 1, 13 Phase 2, 35 Phase 3 |
| Real API startup | Production build served on port 3001 |
| Live `/health` | 200; database connected |
| Both live demo cases | Six COMPLETED requests; each returned synthetic data and linked provenance |
| Phase boundary review | No Phase 4–9 implementation introduced |

The 35 Phase 3 tests cover classification and registry extensibility; positive/negative source selection;
targets, actual rationale and priority; missing/invalid/reversed/future/ISO dates; generation; review; full lifecycle;
authentication/live-role RBAC/source permissions; assignment ABAC/self-approval; cross-case IDOR; strict bodies;
audit rollback; domain event retry; wrong-case source responses; failed-adapter retry; concurrent idempotency;
stale-context handling; provenance after forced extraction; real multiline PDF; legacy cache backfill and blob tampering.

Tests use a separate `_test` database. `pnpm test` prepares/migrates it and refuses to clear a non-test database.
Vitest uses one isolated thread worker with serial files to avoid the Windows/Node fork-worker IPC closure
observed during verification. Expected audit/subscriber-failure tests deliberately log a failure before proving recovery.

This machine uses an isolated PostgreSQL 18 instance on port 5433, leaving the pre-existing port-5432 server
untouched. Compose remains configured for PostgreSQL 16. The schema uses standard PostgreSQL features;
PostgreSQL 16 was not separately executed in this session.
