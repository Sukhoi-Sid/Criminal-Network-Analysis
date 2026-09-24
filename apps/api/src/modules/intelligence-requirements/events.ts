export const IntelligenceEvents = {
  GAP_GENERATED: 'IntelligenceGapGenerated',
  CREATED: 'IntelligenceRequestCreated',
  SUBMITTED: 'IntelligenceRequestSubmitted',
  PENDING: 'IntelligenceRequestPendingAuthorization',
  AUTHORIZED: 'IntelligenceRequestAuthorized',
  REJECTED: 'IntelligenceRequestRejected',
  DISPATCHED: 'IntelligenceRequestDispatched',
  RECEIVED: 'IntelligenceDataReceived',
  COMPLETED: 'IntelligenceRequestCompleted',
  FAILED: 'IntelligenceRequestFailed',
} as const;
