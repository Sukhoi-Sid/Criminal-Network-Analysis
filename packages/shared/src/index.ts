// ─── Roles & Permissions ───────────────────────────────────────────────────

export enum UserRole {
  INVESTIGATOR = 'investigator',
  SUPERVISOR = 'supervisor',
  AUDITOR = 'auditor',
  ADMIN = 'admin',
}

export enum Permission {
  CASE_CREATE = 'case:create',
  CASE_READ = 'case:read',
  CASE_UPDATE = 'case:update',
  CASE_ASSIGN = 'case:assign',
  AUDIT_READ = 'audit:read',
  USER_MANAGE = 'user:manage',
  EVIDENCE_READ = 'evidence:read',
  EVIDENCE_WRITE = 'evidence:write',
}

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.INVESTIGATOR]: [
    Permission.CASE_CREATE,
    Permission.CASE_READ,
    Permission.CASE_UPDATE,
    Permission.EVIDENCE_READ,
    Permission.EVIDENCE_WRITE,
  ],
  [UserRole.SUPERVISOR]: [
    Permission.CASE_CREATE,
    Permission.CASE_READ,
    Permission.CASE_UPDATE,
    Permission.CASE_ASSIGN,
    Permission.EVIDENCE_READ,
    Permission.EVIDENCE_WRITE,
  ],
  [UserRole.AUDITOR]: [Permission.AUDIT_READ],
  [UserRole.ADMIN]: [Permission.USER_MANAGE],
};

// ─── Case ──────────────────────────────────────────────────────────────────

export enum CaseStatus {
  OPEN = 'open',
  ACTIVE = 'active',
  ON_HOLD = 'on_hold',
  CLOSED = 'closed',
}

export enum CaseClassification {
  RESTRICTED = 'restricted',
  CONFIDENTIAL = 'confidential',
  SECRET = 'secret',
}

export enum CaseAssignmentRole {
  INVESTIGATOR = 'investigator',
  SUPERVISOR = 'supervisor',
}

// ─── Audit ─────────────────────────────────────────────────────────────────

export enum AuditAction {
  LOGIN = 'login',
  LOGOUT = 'logout',
  LOGIN_FAILED = 'login_failed',
  CASE_CREATE = 'case_create',
  CASE_READ = 'case_read',
  CASE_UPDATE = 'case_update',
  CASE_ASSIGN = 'case_assign',
  EVIDENCE_DOCUMENT_CREATE = 'evidence_document_create',
  EVIDENCE_DOCUMENT_READ = 'evidence_document_read',
  USER_CREATE = 'user_create',
  USER_UPDATE = 'user_update',
  AUDIT_READ = 'audit_read',
  ACCESS_DENIED = 'access_denied',
}

export enum AuditResourceType {
  USER = 'user',
  CASE = 'case',
  DOCUMENT = 'document',
  EVIDENCE = 'evidence',
  AUDIT = 'audit',
  SESSION = 'session',
}

// ─── Evidence Store ────────────────────────────────────────────────────────

export enum EvidenceSourceType {
  FIR_UPLOAD = 'fir_upload',
  REPORT_UPLOAD = 'report_upload',
  ATTACHMENT = 'attachment',
  EXTERNAL_PACKAGE = 'external_package',
}

export enum ReliabilityTier {
  TIER1_AUTHORITATIVE = 'tier1_authoritative',
  TIER2_OPERATIONAL = 'tier2_operational',
  TIER3_DERIVED = 'tier3_derived',
  TIER4_UNVERIFIED = 'tier4_unverified',
}

// ─── API DTOs ──────────────────────────────────────────────────────────────

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthLoginRequest {
  email: string;
  password: string;
}

export interface AuthLoginResponse {
  token: string;
  user: UserDto;
}

export interface CaseDto {
  id: string;
  caseId: string;
  title: string;
  description: string | null;
  status: CaseStatus;
  classification: CaseClassification;
  jurisdiction: string | null;
  contextSummary: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  assignments?: CaseAssignmentDto[];
}

export interface CaseAssignmentDto {
  id: string;
  userId: string;
  role: CaseAssignmentRole;
  user?: Pick<UserDto, 'id' | 'name' | 'email' | 'role'>;
}

export interface CreateCaseRequest {
  title: string;
  description?: string;
  classification?: CaseClassification;
  jurisdiction?: string;
  contextSummary?: string;
}

export interface UpdateCaseRequest {
  title?: string;
  description?: string;
  status?: CaseStatus;
  classification?: CaseClassification;
  jurisdiction?: string;
  contextSummary?: string;
}

export interface AssignCaseRequest {
  userId: string;
  role: CaseAssignmentRole;
}

export interface AuditEventDto {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: AuditAction;
  resourceType: AuditResourceType;
  resourceId: string | null;
  caseId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface DocumentDto {
  id: string;
  caseId: string;
  filename: string;
  mimeType: string;
  contentHash: string;
  sourceType: EvidenceSourceType;
  uploadedById: string;
  createdAt: string;
}

export interface EvidenceRecordDto {
  id: string;
  caseId: string;
  documentId: string | null;
  sourceType: EvidenceSourceType;
  sourceRecordId: string;
  reliabilityTier: ReliabilityTier;
  contentHash: string;
  createdAt: string;
  provenance?: ProvenanceDto;
}

export interface ProvenanceDto {
  id: string;
  originSource: string;
  receivedAt: string;
  receivedById: string;
  transformationChain: unknown[];
  parentEvidenceId: string | null;
  contentHash: string;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
