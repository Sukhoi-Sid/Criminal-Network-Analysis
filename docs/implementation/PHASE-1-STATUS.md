# Phase 1 Status — Foundation & Secure Case System

**Built by:** Claude, in a sandbox with no network/Docker/Postgres access — so
this was written and statically reviewed, but **not run**. Nothing here
should be treated as "tested and passing" until you run the commands below.

---

## What's implemented

| Area | Files | Notes |
|---|---|---|
| Schema | `apps/api/prisma/schema.prisma` | Users, Cases, CaseAssignments, CaseIntelligenceState, AuditEvent, Document, EvidenceRecord, Provenance |
| Config | `apps/api/src/core/env.ts` | Zod-validated env, fails fast on missing vars |
| DB client | `apps/api/src/core/db.ts` | Prisma singleton |
| DTO mapping | `apps/api/src/core/serialize.ts` | Prisma rows → `@sih/shared` DTOs (Date → ISO string, enum casts) |
| Auth | `apps/api/src/modules/auth/*` | bcrypt hashing, JWT issue/verify, login, `/me`, RBAC + ABAC middleware |
| Audit | `apps/api/src/modules/audit/*` | Append-only emit + query, gated to auditor/admin/supervisor |
| Case platform | `apps/api/src/modules/case-platform/*` | Create (auto-assigns creator + inits CaseIntelligenceState), list, get, update, assign — all audit-logged |
| Evidence store (skeleton) | `apps/api/src/modules/evidence-store/*` | PDF/text upload → SHA-256 hash → blob to disk → Document + EvidenceRecord + Provenance rows |
| Wiring | `apps/api/src/app.ts`, `main.ts` | Express app, error middleware, graceful shutdown |
| Seed | `apps/api/prisma/seed.ts` | 4 demo users (one per role) + the "Operation Crosslink" (D5) case shell |
| Tests | `apps/api/src/__tests__/*.test.ts` | Integration tests against a real Postgres via supertest — auth, case-platform, evidence upload |

Reused as-is, untouched: `packages/shared/src/index.ts`, `apps/api/src/core/errors.ts`, `apps/api/src/core/domain-events.ts`.

---

## What I actually verified in this sandbox

I got further than the previous attempt — `registry.npmjs.org` turned out to
be reachable here, so I could install and partially verify:

| Check | Result |
|---|---|
| `pnpm install` (all 3 workspaces) | ✅ Succeeded |
| `pnpm --filter @sih/shared build` (`tsc`) | ✅ Compiled clean, no errors |
| Cross-check: every `@sih/shared` enum's string values vs. `schema.prisma` enum values | ✅ All 8 match exactly (script-verified, not eyeballed) |
| Brace/paren/bracket balance across every new `.ts` file | ✅ Balanced |
| `prisma generate` / `prisma validate` | ❌ Blocked — needs `binaries.prisma.sh` for the query/schema-engine binaries, which isn't on this sandbox's allowed domain list (only npm registries are) |

Because `prisma generate` couldn't run, `@prisma/client`'s generated types
don't exist here, so I could **not** run a real `tsc --noEmit` over
`apps/api` — that needs the generated client. Everything in `apps/api` was
therefore checked by careful manual review plus the automated checks above
(enum parity, brace balance, cross-file import paths), not by the compiler.
Run `pnpm db:generate` first thing on your machine and `apps/api` should
compile; if it doesn't, the enum-cast lines (search for `as unknown as
Prisma`) are the first place to look.



Prisma generates its own enum types from `schema.prisma` that are
**string-identical but nominally distinct** TypeScript types from the enums
in `@sih/shared`. Passing a `@sih/shared` enum value into a Prisma
`create`/`update` call needs an explicit cast (`as unknown as PrismaXyz`);
going the other way — Prisma output into a `@sih/shared`-typed DTO — is
handled centrally in `serialize.ts`, which accepts loose `string` types and
casts once on the way out. If you rename an enum on either side, keep the
spelling identical or these casts silently stop matching.

---

## How to actually verify this

```bash
# 1. Install deps (needs network — blocked in this sandbox)
pnpm install

# 2. Start Postgres
docker compose up -d

# 3. Env
cp .env.example apps/api/.env   # adjust if your compose ports differ

# 4. Generate client, migrate, seed
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Run the API
pnpm --filter @sih/api dev
# → GET http://localhost:3001/health should return { status: "ok" }

# 6. Run tests (needs the same Postgres, migrated)
pnpm --filter @sih/api test
```

Demo login (from the seed script): `investigator@ncrb.demo` /
`Passw0rd!2026` (also `supervisor@`, `auditor@`, `admin@ncrb.demo`).

### Smoke-test the API by hand

```bash
TOKEN=$(curl -s -X POST localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"investigator@ncrb.demo","password":"Passw0rd!2026"}' | jq -r .token)

curl -s localhost:3001/api/cases -H "Authorization: Bearer $TOKEN" | jq
```

---

## What I did **not** build in Phase 1 (by design, per the frozen blueprint)

- Document extraction/mentions (Phase 2 — `document-intelligence`)
- Gap analysis, intelligence requests, mock source adapters (Phase 3)
- Entity resolution, Neo4j graph, analytics, findings/RAG (Phases 4–7)
- Frontend (`apps/web`) — Phase 8
- Integrity/blockchain anchoring (Phase 9) — `EvidenceRecord`/`Provenance`
  already carry an (unused, nullable) `integrityAnchorId` so Phase 9 doesn't
  require a schema migration to bolt on

## Sandbox tooling changes I made along the way

`pnpm install` on this sandbox's pnpm (12.x) ignores postinstall scripts by
default now — I added `allowBuilds` / `onlyBuiltDependencies` entries to
`pnpm-workspace.yaml` so `@prisma/client`, `@prisma/engines`, `esbuild`, and
`prisma` are allowed to run their build scripts. This is a real fix you'll
likely need too on a recent pnpm; if your pnpm version doesn't recognize
`allowBuilds`, run `pnpm approve-builds` interactively instead.

---

## Open items for your review

1. **Per-document case-scoped ABAC**: `GET /api/documents/:documentId` checks
   `EVIDENCE_READ` permission but not case assignment (the route has no
   `caseId` in its path). Flagged in a code comment; worth tightening when
   the evidence-detail UI lands.
2. **Password rotation / registration flow**: there's no public signup route
   on purpose — `AuthService.createUser` exists but isn't wired to a route
   yet, since the blueprint doesn't specify one for Phase 1. Decide whether
   admin user-management is in-scope now or waits.
3. Seed script demo password is printed to stdout in plaintext for local dev
   convenience — fine for a hackathon demo, not for anything closer to prod.
