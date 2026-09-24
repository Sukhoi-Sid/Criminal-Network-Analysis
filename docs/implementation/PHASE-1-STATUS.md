# Phase 1 Status — Foundation & Secure Case System (FINAL)

## Verification update — 2026-09-17

The supplied Phase 2 ZIP was opened in the current workspace. Dependency installation,
Prisma client generation, both existing migrations, schema validation and API/shared builds succeeded.
All 31 Phase 1 tests passed against an isolated local PostgreSQL instance; the 13 Phase 2 tests also passed.
Earlier sandbox limitations below are historical, not the current verification status.
See [Phase 3 status](PHASE-3-STATUS.md) for the subsequent full regression run and additive changes.

This supersedes the earlier draft of this file. Phase 1 went through two
passes: an initial build, then a security-fix pass that closed the gaps
found on review. This document reflects the final, fixed state as of the
Phase 2 work session.

## What's implemented

| Area | Files | Notes |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | Users, Cases, CaseAssignments, CaseIntelligenceState, AuditEvent, Document, EvidenceRecord, Provenance |
| Config | `apps/api/src/core/env.ts` | Zod-validated env, fails fast on missing vars |
| DB client + health | `apps/api/src/core/db.ts` | Prisma singleton + `checkDatabaseConnection()` (real `SELECT 1`, never leaks connection details) |
| DTO mapping | `apps/api/src/core/serialize.ts` | Prisma rows → `@sih/shared` DTOs |
| Auth | `apps/api/src/modules/auth/*` | bcrypt hashing, JWT issue/verify, login, `/me`, RBAC (`requirePermission`) |
| Case ABAC | `apps/api/src/modules/auth/policies.ts` | Single primitive: `assertCaseAccess(userId, caseId)` — assignment-based, **no role bypass**. `requireCaseAccess` is its route-middleware wrapper |
| Audit | `apps/api/src/modules/audit/*` | Append-only emit + query, gated to `Permission.AUDIT_READ` (auditor only, per shared contracts) |
| Case platform | `apps/api/src/modules/case-platform/*` | Create (auto-assigns creator + inits CaseIntelligenceState), list, get, update, assign — all audit-logged |
| Evidence store | `apps/api/src/modules/evidence-store/*` | PDF/text upload → SHA-256 hash → blob to disk → Document + EvidenceRecord + Provenance |
| Wiring | `apps/api/src/app.ts`, `main.ts` | Express app, `/health` (DB-aware), error middleware, graceful shutdown |
| Migration | `apps/api/prisma/migrations/20260901000000_init/` | Applied to live Postgres and verified via `psql \d` |

## Security fixes applied in the second pass

1. **Case ABAC IDOR fix**: the original `requireCaseAccess` gave every
   `supervisor`-role user unconditional access to *any* case. Fixed —
   `assertCaseAccess` now checks a real `CaseAssignment` row for every role,
   no exceptions. This is the **single** ABAC primitive; every other
   case-scoping check in the codebase (evidence-store's by-id document/
   evidence-record reads, document-intelligence's process/mentions
   endpoints) calls into it rather than re-implementing case-membership
   logic.
2. **Evidence/document IDOR**: `GET /api/documents/:documentId` and
   `GET /api/evidence-records/:evidenceRecordId` (no `caseId` in the path)
   now call `assertCaseAccess` inside the service once the resource's
   `caseId` is known, closing the gap noted in the first draft of this doc.
3. **Audit query authorization**: tightened from an ad-hoc `requireRole`
   allow-list to `requirePermission(Permission.AUDIT_READ)`, which per
   `packages/shared`'s `ROLE_PERMISSIONS` only `auditor` holds. Matches the
   frozen blueprint's role table (`auditor: audit logs + provenance
   read-only`; `admin`/`supervisor` are not granted this).
4. **Audit-read logging**: reading the audit log now itself emits an
   `AUDIT_READ` event via the same `auditService.emit()` — no second
   logging path, and no recursion (`emit()` only inserts; it never calls
   `query()`, so logging a read can't trigger another read-log).
5. **Health check**: `/health` now calls `checkDatabaseConnection()`
   (`SELECT 1` via Prisma) and returns 503 with `database: "unavailable"`
   if Postgres is unreachable, instead of a static `{status: "ok"}`.

## What I verified this session (Phase 2 work)

Re-ran the same verification discipline as the original Phase 1 build:

| Check | Result |
|---|---|
| `pnpm install` | ✅ Succeeded (all 4 workspace packages including the new `document-intelligence` deps) |
| `pnpm --filter @sih/shared build` | ✅ Compiled clean |
| Enum parity: every `@sih/shared` enum vs. `schema.prisma` enum | ✅ 11/11 match (script-verified) |
| Brace/paren/bracket balance, all `.ts` files | ✅ Balanced |
| Migrations applied to live Postgres (`sih_criminal`, `sih_criminal_test`) | ✅ Applied via `psql`, schema confirmed via `\d` |
| `prisma generate` | ❌ Still blocked — `binaries.prisma.sh` returns `403 host_not_allowed` from this sandbox's egress proxy (confirmed explicitly this session, not just inferred) |
| `pnpm test` | ❌ Blocked transitively — every test file (Phase 1 **and** Phase 2) fails at import time on `Cannot find module '.prisma/client/default'`, because there is no generated client. This is not a Phase 2 regression; it affects the pre-existing Phase 1 tests identically. |

**Bottom line on Phase 1 regression risk**: the schema, routes, and service
code for Phase 1 are unchanged by Phase 2 except for additive columns
(`Document.processingStatus/processingError/processedAt`) and additive
relations (`Mention`). No Phase 1 table, column, enum value, or route was
removed or renamed. The Phase 1 logic itself was not touched. I could not
get a live test run to prove this in this sandbox (see above), but the diff
is additive-only by construction, which is the strongest guarantee
available without that run.

## How to actually verify (run this on a machine with normal network access)

```bash
pnpm install
docker compose up -d          # or point DATABASE_URL at your own Postgres
cp .env.example apps/api/.env
pnpm db:generate
pnpm db:migrate                # applies both 20260901000000_init and
                                # 20260910000000_phase2_document_intelligence
pnpm db:seed                   # also uploads + processes the synthetic FIR
pnpm --filter @sih/api test    # Phase 1 + Phase 2 suites
pnpm --filter @sih/api dev
curl localhost:3001/health     # → {"status":"ok","database":"connected"}
```

## Open items carried forward

- No public self-signup route (`AuthService.createUser` exists, unwired) —
  still an open scope decision, not a Phase 1/2 defect.
- Seed script prints the demo password to stdout — fine for local/demo use.
