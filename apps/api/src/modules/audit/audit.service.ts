import { AuditAction, AuditResourceType } from '@sih/shared';
import type { AuditAction as PrismaAuditAction, AuditResourceType as PrismaAuditResourceType } from '@prisma/client';
import { prisma } from '../../core/db';

export interface EmitAuditEventInput {
  actorId?: string | null;
  actorEmail?: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId?: string | null;
  caseId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export interface AuditQueryOptions {
  caseId?: string;
  actorId?: string;
  action?: AuditAction;
  page?: number;
  pageSize?: number;
}

/**
 * IAuditEmitter implementation (Blueprint §6). Append-only: no update/delete
 * operations are exposed. Every module that mutates state should call `emit`.
 */
export class AuditService {
  async emit(input: EmitAuditEventInput): Promise<void> {
    await prisma.auditEvent.create({
      data: {
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        action: input.action as unknown as PrismaAuditAction,
        resourceType: input.resourceType as unknown as PrismaAuditResourceType,
        resourceId: input.resourceId ?? null,
        caseId: input.caseId ?? null,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }

  async query(options: AuditQueryOptions) {
    const page = options.page && options.page > 0 ? options.page : 1;
    const pageSize = options.pageSize && options.pageSize > 0 ? Math.min(options.pageSize, 200) : 50;

    const where = {
      ...(options.caseId ? { caseId: options.caseId } : {}),
      ...(options.actorId ? { actorId: options.actorId } : {}),
      ...(options.action ? { action: options.action as unknown as PrismaAuditAction } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}

export const auditService = new AuditService();
