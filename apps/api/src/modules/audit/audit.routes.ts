import { Router } from 'express';
import { z } from 'zod';
import {
  AuditAction,
  AuditResourceType,
  type AuditEventDto,
  type PaginatedResponse,
  Permission,
} from '@sih/shared';
import { auditService } from './audit.service';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { toAuditEventDto } from '../../core/serialize';

export const auditRouter = Router();

const querySchema = z.object({
  caseId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.nativeEnum(AuditAction).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().optional(),
});

// SECURITY FIX: this route previously used a separate `requireRole(AUDITOR,
// ADMIN, SUPERVISOR)` gate that granted admin and supervisor raw audit-log
// access. That contradicts the frozen permission contract in
// `packages/shared` — `ROLE_PERMISSIONS` grants `Permission.AUDIT_READ` to
// `auditor` only (admin has `USER_MANAGE`; supervisor has case
// permissions). `requireRole` was a second, parallel authorization
// mechanism that could grant access the permission table doesn't — removed
// in favor of the single RBAC primitive (`requirePermission`) every other
// route already uses, which now correctly restricts this to `auditor`.
auditRouter.get('/', authenticate, requirePermission(Permission.AUDIT_READ), async (req, res) => {
  const query = querySchema.parse(req.query);
  const result = await auditService.query(query);

  const response: PaginatedResponse<AuditEventDto> = {
    items: result.items.map(toAuditEventDto),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };

  // AUDIT_READ event for this query itself — recorded AFTER the query has
  // already run and its results captured above, so this event cannot
  // appear in its own result set, and `auditService.emit` only performs a
  // single `INSERT` (it never calls `.query()`), so there is no recursive
  // read-triggers-read loop possible here.
  await auditService.emit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: AuditAction.AUDIT_READ,
    resourceType: AuditResourceType.AUDIT,
    caseId: query.caseId ?? null,
    ipAddress: req.ip,
    metadata: { filters: query },
  });

  res.status(200).json(response);
});
