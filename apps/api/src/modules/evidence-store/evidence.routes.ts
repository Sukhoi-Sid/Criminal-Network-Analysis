import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  type DocumentDto,
  EvidenceSourceType,
  type EvidenceRecordDto,
  type PaginatedResponse,
  Permission,
} from '@sih/shared';
import { evidenceStoreService } from './evidence.service';
import { authenticate, requirePermission } from '../../middleware/auth.middleware';
import { requireCaseAccess } from '../auth/policies';
import { toDocumentDto, toEvidenceRecordDto } from '../../core/serialize';
import { ValidationError } from '../../core/errors';

export const evidenceRouter = Router();

evidenceRouter.use(authenticate);

// MVP document intelligence scope is PDF/text (D7) — reject anything else at the door.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain'];
    if (!allowed.includes(file.mimetype)) {
      cb(new ValidationError(`Unsupported file type: ${file.mimetype}. MVP supports PDF and plain text.`));
      return;
    }
    cb(null, true);
  },
});

const sourceTypeSchema = z.nativeEnum(EvidenceSourceType).optional();

evidenceRouter.post(
  '/cases/:caseId/documents',
  requirePermission(Permission.EVIDENCE_WRITE),
  requireCaseAccess,
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      throw new ValidationError('No file uploaded (expected multipart field "file")');
    }
    const sourceType = sourceTypeSchema.parse(req.body?.sourceType);

    const { document } = await evidenceStoreService.uploadDocument({
      caseId: req.params.caseId,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      sourceType,
      uploadedById: req.user!.id,
      actorEmail: req.user!.email,
      ipAddress: req.ip,
    });

    const dto: DocumentDto = toDocumentDto(document);
    res.status(201).json(dto);
  },
);

evidenceRouter.get(
  '/cases/:caseId/documents',
  requirePermission(Permission.EVIDENCE_READ),
  requireCaseAccess,
  async (req, res) => {
    const documents = await evidenceStoreService.listDocumentsForCase(req.params.caseId);
    const response: PaginatedResponse<DocumentDto> = {
      items: documents.map(toDocumentDto),
      total: documents.length,
      page: 1,
      pageSize: documents.length,
    };
    res.status(200).json(response);
  },
);

// This endpoint is keyed by documentId only (no caseId in the path), so
// `requireCaseAccess` can't run as route middleware here — the service
// (`evidenceStoreService.getDocument`) independently asserts case access via
// the shared `assertCaseAccess` policy once it has loaded the document and
// knows its caseId. See evidence.service.ts for the enforcement.
evidenceRouter.get('/documents/:documentId', requirePermission(Permission.EVIDENCE_READ), async (req, res) => {
  const document = await evidenceStoreService.getDocument(
    req.params.documentId,
    { id: req.user!.id, email: req.user!.email },
    req.ip,
  );
  const dto: DocumentDto = toDocumentDto(document);
  res.status(200).json(dto);
});

// Same IDOR concern as /documents/:documentId above — enforced in
// evidenceStoreService.getEvidenceRecord via assertCaseAccess.
evidenceRouter.get(
  '/evidence-records/:evidenceRecordId',
  requirePermission(Permission.EVIDENCE_READ),
  async (req, res) => {
    const record = await evidenceStoreService.getEvidenceRecord(
      req.params.evidenceRecordId,
      { id: req.user!.id, email: req.user!.email },
      req.ip,
    );
    const dto: EvidenceRecordDto = toEvidenceRecordDto(record);
    res.status(200).json(dto);
  },
);
