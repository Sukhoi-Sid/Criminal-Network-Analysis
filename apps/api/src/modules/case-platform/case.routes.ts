import { Router } from 'express';
import { z } from 'zod';
import {
  CaseAssignmentRole,
  CaseClassification,
  CaseStatus,
  type CaseDto,
  type PaginatedResponse,
  Permission,
} from '@sih/shared';
import { caseService } from './case.service';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { requireCaseAccess } from '../auth/policies';
import { toCaseDto } from '../../core/serialize';

export const caseRouter = Router();

caseRouter.use(authenticate);

const createCaseSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  classification: z.nativeEnum(CaseClassification).optional(),
  jurisdiction: z.string().optional(),
  contextSummary: z.string().optional(),
});

caseRouter.post('/', requirePermission(Permission.CASE_CREATE), async (req, res) => {
  const body = createCaseSchema.parse(req.body);
  const kase = await caseService.create({
    ...body,
    createdById: req.user!.id,
    actorEmail: req.user!.email,
    ipAddress: req.ip,
  });
  const dto: CaseDto = toCaseDto(kase);
  res.status(201).json(dto);
});

caseRouter.get('/', requirePermission(Permission.CASE_READ), async (req, res) => {
  const cases = await caseService.listForUser(req.user!.id, req.user!.role);
  const response: PaginatedResponse<CaseDto> = {
    items: cases.map(toCaseDto),
    total: cases.length,
    page: 1,
    pageSize: cases.length,
  };
  res.status(200).json(response);
});

caseRouter.get(
  '/:caseId',
  requirePermission(Permission.CASE_READ),
  requireCaseAccess,
  async (req, res) => {
    const kase = await caseService.getById(req.params.caseId);
    await caseService.recordRead(kase.id, { id: req.user!.id, email: req.user!.email }, req.ip);
    const dto: CaseDto = toCaseDto(kase);
    res.status(200).json(dto);
  },
);

const updateCaseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.nativeEnum(CaseStatus).optional(),
  classification: z.nativeEnum(CaseClassification).optional(),
  jurisdiction: z.string().optional(),
  contextSummary: z.string().optional(),
});

caseRouter.patch(
  '/:caseId',
  requirePermission(Permission.CASE_UPDATE),
  requireCaseAccess,
  async (req, res) => {
    const body = updateCaseSchema.parse(req.body);
    const updated = await caseService.update(
      req.params.caseId,
      body,
      { id: req.user!.id, email: req.user!.email },
      req.ip,
    );
    const dto: CaseDto = toCaseDto(updated);
    res.status(200).json(dto);
  },
);

const assignCaseSchema = z.object({
  userId: z.string().uuid(),
  role: z.nativeEnum(CaseAssignmentRole),
});

caseRouter.post(
  '/:caseId/assignments',
  requirePermission(Permission.CASE_ASSIGN),
  requireCaseAccess,
  async (req, res) => {
    const body = assignCaseSchema.parse(req.body);
    const assignment = await caseService.assign(
      req.params.caseId,
      body,
      { id: req.user!.id, email: req.user!.email },
      req.ip,
    );
    res.status(201).json(assignment);
  },
);
