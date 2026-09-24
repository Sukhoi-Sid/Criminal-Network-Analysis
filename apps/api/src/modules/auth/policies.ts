import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../core/db';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../core/errors';

/**
 * ABAC rule (Blueprint §10): a user may access a case only if they hold a
 * `CaseAssignment` row for it — regardless of platform role. `admin` has no
 * default case-content access (user management only). `auditor` gets
 * audit/provenance read access elsewhere, not case content. `supervisor`
 * access is likewise assignment-scoped (their "team's cases" are the cases
 * they are assigned to as CaseAssignmentRole.SUPERVISOR/INVESTIGATOR) — a
 * supervisor is NOT granted blanket access to every case in the system.
 *
 * SECURITY FIX: a previous version of this function granted every
 * `supervisor`-role user unconditional access to *any* case by id. That was
 * an overly broad permission grant (case content is meant to be case-scoped
 * for every non-auditor/admin role) and has been removed. This is the
 * single, non-duplicated ABAC primitive for case access — both the route
 * middleware (`requireCaseAccess`) and any service that receives a resource
 * id without a `caseId` route param (e.g. evidence-store fetching a
 * document/evidence record by id) must call `assertCaseAccess` rather than
 * re-implementing this check.
 *
 * Status codes preserve existing, already-tested behavior: 404 when the
 * case id doesn't exist at all, 403 when it exists but the user has no
 * assignment on it. Either way, access is denied — the IDOR fix is that
 * *no* role bypasses the assignment check, not the specific status code.
 */
export async function assertCaseAccess(userId: string, caseId: string): Promise<void> {
  const kase = await prisma.case.findUnique({ where: { id: caseId }, select: { id: true } });
  if (!kase) {
    throw new NotFoundError('Case not found');
  }

  const assignment = await prisma.caseAssignment.findUnique({
    where: { caseId_userId: { caseId, userId } },
    select: { id: true },
  });

  if (!assignment) {
    throw new ForbiddenError('Not assigned to this case');
  }
}

/** Express middleware form of `assertCaseAccess`. Reads `caseId` from
 * `req.params.caseId` (falling back to `req.params.id`); expects
 * `authenticate` to have run first. */
export async function requireCaseAccess(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }

  const caseId = String(req.params.caseId) ?? req.params.id;
  if (!caseId) {
    throw new NotFoundError('Case id missing from request');
  }

  await assertCaseAccess(req.user.id, caseId);
  next();
}
