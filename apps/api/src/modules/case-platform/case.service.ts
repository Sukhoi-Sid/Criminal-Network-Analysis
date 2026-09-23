import { randomUUID } from 'node:crypto';
import {
  AuditAction,
  AuditResourceType,
  CaseAssignmentRole,
  CaseClassification,
  CaseStatus,
  UserRole,
} from '@sih/shared';
import type {
  CaseAssignmentRole as PrismaCaseAssignmentRole,
  CaseClassification as PrismaCaseClassification,
  CaseStatus as PrismaCaseStatus,
} from '@prisma/client';
import { prisma } from '../../core/db';
import { NotFoundError, ValidationError } from '../../core/errors';
import { auditService } from '../audit/audit.service';

const assignmentInclude = {
  assignments: {
    include: { user: { select: { id: true, name: true, email: true, role: true } } },
  },
} as const;

function generateCaseRef(): string {
  const year = new Date().getFullYear();
  const suffix = randomUUID().split('-')[0].toUpperCase();
  return `REF-${year}-${suffix}`;
}

export interface CreateCaseInput {
  title: string;
  description?: string;
  classification?: CaseClassification;
  jurisdiction?: string;
  contextSummary?: string;
  createdById: string;
  actorEmail: string;
  ipAddress?: string;
}

export interface UpdateCaseInput {
  title?: string;
  description?: string;
  status?: CaseStatus;
  classification?: CaseClassification;
  jurisdiction?: string;
  contextSummary?: string;
}

export class CaseService {
  /**
   * Creates a case, auto-assigns the creator as investigator, and
   * initializes a fresh CaseIntelligenceState — the anchor for the
   * "investigation is iterative" principle from day one.
   */
  async create(input: CreateCaseInput) {
    const kase = await prisma.$transaction(async (tx) => {
      const created = await tx.case.create({
        data: {
          caseId: generateCaseRef(),
          title: input.title,
          description: input.description,
          classification: (input.classification ?? CaseClassification.RESTRICTED) as unknown as PrismaCaseClassification,
          jurisdiction: input.jurisdiction,
          contextSummary: input.contextSummary,
          createdById: input.createdById,
        },
      });

      await tx.caseAssignment.create({
        data: {
          caseId: created.id,
          userId: input.createdById,
          role: CaseAssignmentRole.INVESTIGATOR as unknown as PrismaCaseAssignmentRole,
        },
      });

      await tx.caseIntelligenceState.create({
        data: { caseId: created.id, version: 1, summary: {} },
      });

      return tx.case.findUniqueOrThrow({ where: { id: created.id }, include: assignmentInclude });
    });

    await auditService.emit({
      actorId: input.createdById,
      actorEmail: input.actorEmail,
      action: AuditAction.CASE_CREATE,
      resourceType: AuditResourceType.CASE,
      resourceId: kase.id,
      caseId: kase.id,
      ipAddress: input.ipAddress,
    });

    return kase;
  }

  /**
   * Cases visible to this user: cases they hold a CaseAssignment on.
   *
   * SECURITY FIX: this previously returned *every* case in the system for
   * `supervisor`-role users (an overly broad grant — see the note on
   * `assertCaseAccess` in `modules/auth/policies.ts`, which is the single
   * ABAC primitive this must stay consistent with). Supervisors now see
   * exactly the cases they are assigned to, same as investigators. The
   * `role` parameter is kept for call-site compatibility but is
   * intentionally unused for scoping — access is assignment-based for
   * every role.
   */
  async listForUser(userId: string, _role: UserRole) {
    return prisma.case.findMany({
      where: { assignments: { some: { userId } } },
      include: assignmentInclude,
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getById(caseId: string) {
    const kase = await prisma.case.findUnique({ where: { id: caseId }, include: assignmentInclude });
    if (!kase) {
      throw new NotFoundError('Case not found');
    }
    return kase;
  }

  async update(
    caseId: string,
    input: UpdateCaseInput,
    actor: { id: string; email: string },
    ipAddress?: string,
  ) {
    const existing = await prisma.case.findUnique({ where: { id: caseId } });
    if (!existing) {
      throw new NotFoundError('Case not found');
    }

    const updated = await prisma.case.update({
      where: { id: caseId },
      data: input as unknown as { status?: PrismaCaseStatus; classification?: PrismaCaseClassification } & Omit<
        UpdateCaseInput,
        'status' | 'classification'
      >,
      include: assignmentInclude,
    });

    await auditService.emit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AuditAction.CASE_UPDATE,
      resourceType: AuditResourceType.CASE,
      resourceId: caseId,
      caseId,
      ipAddress,
      metadata: { fields: Object.keys(input) },
    });

    return updated;
  }

  async assign(
    caseId: string,
    input: { userId: string; role: CaseAssignmentRole },
    actor: { id: string; email: string },
    ipAddress?: string,
  ) {
    const kase = await prisma.case.findUnique({ where: { id: caseId } });
    if (!kase) {
      throw new NotFoundError('Case not found');
    }

    const targetUser = await prisma.user.findUnique({ where: { id: input.userId } });
    if (!targetUser) {
      throw new ValidationError('Target user does not exist');
    }

    const assignment = await prisma.caseAssignment.upsert({
      where: { caseId_userId: { caseId, userId: input.userId } },
      update: { role: input.role as unknown as PrismaCaseAssignmentRole },
      create: { caseId, userId: input.userId, role: input.role as unknown as PrismaCaseAssignmentRole },
    });

    await auditService.emit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AuditAction.CASE_ASSIGN,
      resourceType: AuditResourceType.CASE,
      resourceId: caseId,
      caseId,
      ipAddress,
      metadata: { assignedUserId: input.userId, role: input.role },
    });

    return assignment;
  }

  async recordRead(caseId: string, actor: { id: string; email: string }, ipAddress?: string) {
    await auditService.emit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AuditAction.CASE_READ,
      resourceType: AuditResourceType.CASE,
      resourceId: caseId,
      caseId,
      ipAddress,
    });
  }
}

export const caseService = new CaseService();
