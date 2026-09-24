import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.middleware';
import { intelligenceService, type IntelligenceActor } from './intelligence.service';

export const intelligenceRouter = Router();
const base = '/cases/:caseId/intelligence';
const empty = z.object({}).strict();
const review = z.object({ decision: z.enum(['select','dismiss']), note: z.string().trim().min(1).max(2000) }).strict();
const decision = z.object({ approved: z.boolean(), reason: z.string().trim().min(1).max(2000) }).strict();
const create = z.object({ gapId: z.string().uuid() }).strict();
const actor = (req: Request): IntelligenceActor => ({ ...req.user!, ipAddress: req.ip });
const param = (req: Request, key: string) => z.string().uuid().parse(req.params[key]);
intelligenceRouter.use(base, authenticate);

intelligenceRouter.post(`${base}/analyze`, async (req, res) => {
  empty.parse(req.body ?? {});
  res.json(await intelligenceService.analyze(param(req,'caseId'), actor(req)));
});
intelligenceRouter.get(`${base}/context`, async (req, res) => {
  res.json(await intelligenceService.getContext(param(req,'caseId'), actor(req)));
});
intelligenceRouter.get(`${base}/gaps`, async (req, res) => {
  const items = await intelligenceService.listGaps(param(req,'caseId'), actor(req));
  res.json({ items, total: items.length });
});
intelligenceRouter.get(`${base}/gaps/:gapId`, async (req, res) => {
  res.json(await intelligenceService.getGap(param(req,'caseId'), param(req,'gapId'), actor(req)));
});
intelligenceRouter.post(`${base}/gaps/:gapId/review`, async (req, res) => {
  const input = review.parse(req.body);
  res.json(await intelligenceService.review(param(req,'caseId'), param(req,'gapId'), actor(req), input.decision, input.note));
});
intelligenceRouter.post(`${base}/requests`, async (req, res) => {
  const input = create.parse(req.body);
  res.status(200).json(await intelligenceService.createRequest(param(req,'caseId'), input.gapId, actor(req)));
});
intelligenceRouter.get(`${base}/requests`, async (req, res) => {
  const items = await intelligenceService.listRequests(param(req,'caseId'), actor(req));
  res.json({ items, total: items.length });
});
intelligenceRouter.get(`${base}/requests/:requestId`, async (req, res) => {
  res.json(await intelligenceService.getRequest(param(req,'caseId'), param(req,'requestId'), actor(req)));
});
intelligenceRouter.post(`${base}/requests/:requestId/authorize`, async (req, res) => {
  const input = decision.parse(req.body);
  res.json(await intelligenceService.authorize(param(req,'caseId'), param(req,'requestId'), actor(req), input.approved, input.reason));
});
for (const operation of ['submit','dispatch','complete'] as const) {
  intelligenceRouter.post(`${base}/requests/:requestId/${operation}`, async (req, res) => {
    empty.parse(req.body ?? {});
    res.json(await intelligenceService[operation](param(req,'caseId'), param(req,'requestId'), actor(req)));
  });
}
intelligenceRouter.get(`${base}/requests/:requestId/response`, async (req, res) => {
  res.json(await intelligenceService.response(param(req,'caseId'), param(req,'requestId'), actor(req)));
});
