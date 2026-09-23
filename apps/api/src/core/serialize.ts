/**
 * Prisma returns `Date` objects and its own (nominally distinct but
 * string-identical) enum types; our shared DTOs (packages/shared) declare
 * timestamps as ISO strings and use the shared enums. These helpers keep
 * that conversion in one place instead of scattering casts everywhere.
 */

import type {
  AuditAction,
  AuditEventDto,
  AuditResourceType,
  CaseAssignmentDto,
  CaseAssignmentRole,
  CaseClassification,
  CaseDto,
  CaseStatus,
  DocumentDto,
  EvidenceRecordDto,
  EvidenceSourceType,
  ProvenanceDto,
  ReliabilityTier,
  UserDto,
  UserRole,
} from '@sih/shared';

export function toUserDto(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toCaseAssignmentDto(assignment: {
  id: string;
  userId: string;
  role: string;
  user?: { id: string; name: string; email: string; role: string } | null;
}): CaseAssignmentDto {
  return {
    id: assignment.id,
    userId: assignment.userId,
    role: assignment.role as CaseAssignmentRole,
    ...(assignment.user
      ? {
          user: {
            id: assignment.user.id,
            name: assignment.user.name,
            email: assignment.user.email,
            role: assignment.user.role as UserRole,
          },
        }
      : {}),
  };
}

export function toCaseDto(c: {
  id: string;
  caseId: string;
  title: string;
  description: string | null;
  status: string;
  classification: string;
  jurisdiction: string | null;
  contextSummary: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  assignments?: Parameters<typeof toCaseAssignmentDto>[0][];
}): CaseDto {
  return {
    id: c.id,
    caseId: c.caseId,
    title: c.title,
    description: c.description,
    status: c.status as CaseStatus,
    classification: c.classification as CaseClassification,
    jurisdiction: c.jurisdiction,
    contextSummary: c.contextSummary,
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    ...(c.assignments ? { assignments: c.assignments.map(toCaseAssignmentDto) } : {}),
  };
}

export function toAuditEventDto(e: {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  caseId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: Date;
}): AuditEventDto {
  return {
    id: e.id,
    actorId: e.actorId,
    actorEmail: e.actorEmail,
    action: e.action as AuditAction,
    resourceType: e.resourceType as AuditResourceType,
    resourceId: e.resourceId,
    caseId: e.caseId,
    metadata: (e.metadata as Record<string, unknown> | null) ?? null,
    ipAddress: e.ipAddress,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toDocumentDto(d: {
  id: string;
  caseId: string;
  filename: string;
  mimeType: string;
  contentHash: string;
  sourceType: string;
  uploadedById: string;
  createdAt: Date;
}): DocumentDto {
  return {
    id: d.id,
    caseId: d.caseId,
    filename: d.filename,
    mimeType: d.mimeType,
    contentHash: d.contentHash,
    sourceType: d.sourceType as EvidenceSourceType,
    uploadedById: d.uploadedById,
    createdAt: d.createdAt.toISOString(),
  };
}

export function toProvenanceDto(p: {
  id: string;
  originSource: string;
  receivedAt: Date;
  receivedById: string;
  transformationChain: unknown;
  parentEvidenceId: string | null;
  contentHash: string;
}): ProvenanceDto {
  return {
    id: p.id,
    originSource: p.originSource,
    receivedAt: p.receivedAt.toISOString(),
    receivedById: p.receivedById,
    transformationChain: (p.transformationChain as unknown[]) ?? [],
    parentEvidenceId: p.parentEvidenceId,
    contentHash: p.contentHash,
  };
}

export function toEvidenceRecordDto(e: {
  id: string;
  caseId: string;
  documentId: string | null;
  sourceType: string;
  sourceRecordId: string;
  reliabilityTier: string;
  contentHash: string;
  createdAt: Date;
  provenance?: Parameters<typeof toProvenanceDto>[0] | null;
}): EvidenceRecordDto {
  return {
    id: e.id,
    caseId: e.caseId,
    documentId: e.documentId,
    sourceType: e.sourceType as EvidenceSourceType,
    sourceRecordId: e.sourceRecordId,
    reliabilityTier: e.reliabilityTier as ReliabilityTier,
    contentHash: e.contentHash,
    createdAt: e.createdAt.toISOString(),
    ...(e.provenance ? { provenance: toProvenanceDto(e.provenance) } : {}),
  };
}
