import { Router } from 'express';
import { z } from 'zod';
import type { MentionDto, PaginatedResponse, ProcessDocumentResponse } from '@sih/shared';
import { Permission } from '@sih/shared';
import { documentIntelligenceService } from './mention.service';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { requireCaseAccess } from '../auth/policies';
import { toDocumentDto, toMentionDto } from '../../core/serialize';

export const mentionRouter = Router();

mentionRouter.use(authenticate);

const processBodySchema = z.object({ force: z.boolean().optional() });

// Triggering extraction is a write action on evidence-derived data —
// reuses EVIDENCE_WRITE rather than adding a new permission for it.
mentionRouter.post(
  '/cases/:caseId/documents/:documentId/process',
  requirePermission(Permission.EVIDENCE_WRITE),
  requireCaseAccess,
  async (req, res) => {
    const body = processBodySchema.parse(req.body ?? {});
    const result = await documentIntelligenceService.processDocument(
      req.params.caseId,
      req.params.documentId,
      { id: req.user!.id, email: req.user!.email },
      { force: body.force },
      req.ip,
    );

    const response: ProcessDocumentResponse = {
      document: toDocumentDto(result.document),
      mentions: result.mentions.map(toMentionDto),
      reused: result.reused,
    };
    res.status(result.reused ? 200 : 201).json(response);
  },
);

mentionRouter.get(
  '/cases/:caseId/documents/:documentId/mentions',
  requirePermission(Permission.EVIDENCE_READ),
  requireCaseAccess,
  async (req, res) => {
    const mentions = await documentIntelligenceService.listMentions(req.params.caseId, req.params.documentId, {
      id: req.user!.id,
    });

    const response: PaginatedResponse<MentionDto> = {
      items: mentions.map(toMentionDto),
      total: mentions.length,
      page: 1,
      pageSize: mentions.length,
    };
    res.status(200).json(response);
  },
);
