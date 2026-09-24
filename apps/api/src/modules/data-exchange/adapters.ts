import { createHash } from 'node:crypto';
import { ValidationError } from '../../core/errors';
import { intelligenceRegistry } from '../intelligence-requirements/registry';
import type { IntelligenceRequestScope } from '@sih/shared';

export type RequestScope = IntelligenceRequestScope;
export interface ExchangeRequest { id: string; caseId: string; sourceId: string; scope: RequestScope }
export interface SubmissionReceipt { key: string; request: ExchangeRequest }
export interface ExternalDataPayload {
  synthetic: true; requestId: string; caseId: string; sourceId: string;
  targetEntity: string; timeFrom: string; timeTo: string;
  records: Record<string, unknown>[];
}
export interface ISourceAdapter {
  sourceId: string;
  supportedDataCategories: string[];
  validateRequest(request: ExchangeRequest): void;
  submitRequest(request: ExchangeRequest): Promise<SubmissionReceipt>;
  fetchResponse(receipt: SubmissionReceipt): Promise<ExternalDataPayload>;
}
type RecordFactory = (r: ExchangeRequest, reference: string) => Record<string, unknown>;
const factories: Record<string, RecordFactory> = {
  financial: (r, ref) => ({ transactionId: ref, account: r.scope.targetEntity, amountINR: 1250, counterparty: 'SYNTHETIC-ACCOUNT-002', timestamp: r.scope.timeFrom }),
  telecom: (r, ref) => ({ callId: ref, phone: r.scope.targetEntity, counterpart: 'SYNTHETIC-PHONE-002', durationSeconds: 45, timestamp: r.scope.timeFrom }),
  'criminal-history': (r, ref) => ({ reference: ref, reportedName: r.scope.targetEntity, disposition: 'Synthetic reference only; no guilt determination', asOf: r.scope.timeTo }),
  vehicle: (r, ref) => ({ recordId: ref, registration: r.scope.targetEntity, registeredOwner: 'Synthetic Demo Owner', asOf: r.scope.timeTo }),
  location: (r, ref) => ({ observationId: ref, location: r.scope.targetEntity, camera: 'SYNTHETIC-CAMERA-01', observation: 'Fictional movement for demonstration', timestamp: r.scope.timeFrom }),
  cyber: (r, ref) => ({ complaintRef: ref, contact: r.scope.targetEntity, classification: 'Synthetic reported phishing contact; unverified', timestamp: r.scope.timeFrom }),
};

class SyntheticSourceAdapter implements ISourceAdapter {
  supportedDataCategories: string[];
  constructor(public sourceId: string, private category: string, private factory: RecordFactory) {
    this.supportedDataCategories = [category];
  }
  validateRequest(request: ExchangeRequest) {
    const { scope } = request;
    if (request.sourceId !== this.sourceId || scope.sourceId !== this.sourceId || !scope.targetEntity || !scope.purpose ||
        !Number.isFinite(Date.parse(scope.timeFrom)) || !Number.isFinite(Date.parse(scope.timeTo)) || scope.timeFrom > scope.timeTo) {
      throw new ValidationError('Invalid source request scope');
    }
  }
  async submitRequest(request: ExchangeRequest) {
    this.validateRequest(request);
    return { key: `${this.sourceId}:${request.id}`, request };
  }
  async fetchResponse({ request }: SubmissionReceipt): Promise<ExternalDataPayload> {
    this.validateRequest(request);
    const ref = 'SYNTHETIC-' + createHash('sha256').update(request.id + this.category).digest('hex').slice(0, 12);
    return { synthetic: true, requestId: request.id, caseId: request.caseId, sourceId: this.sourceId,
      targetEntity: request.scope.targetEntity, timeFrom: request.scope.timeFrom, timeTo: request.scope.timeTo,
      records: [this.factory(request, ref)] };
  }
}

export const sourceAdapters = new Map<string, ISourceAdapter>(intelligenceRegistry.sources.map(s =>
  [s.id, new SyntheticSourceAdapter(s.id, s.category, factories[s.category])],
));

export async function exchangeSynthetic(request: ExchangeRequest) {
  const adapter = sourceAdapters.get(request.sourceId);
  if (!adapter) throw new ValidationError('No adapter configured for source');
  adapter.validateRequest(request);
  const receipt = await adapter.submitRequest(request);
  const payload = await adapter.fetchResponse(receipt);
  // Reject mismatched/unscoped receipts even when an adapter is faulty.
  if (payload.synthetic !== true || payload.requestId !== request.id || payload.caseId !== request.caseId ||
      payload.sourceId !== request.sourceId || payload.targetEntity !== request.scope.targetEntity ||
      payload.timeFrom !== request.scope.timeFrom || payload.timeTo !== request.scope.timeTo || !Array.isArray(payload.records) ||
      receipt.key !== `${request.sourceId}:${request.id}`) throw new ValidationError('Invalid synthetic source response');
  return { receipt, payload };
}
