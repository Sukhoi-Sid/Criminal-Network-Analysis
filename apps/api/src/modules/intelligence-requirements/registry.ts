import { Permission } from '@sih/shared';

export interface SourceDefinition {
  id: string;
  department: string;
  category: string;
  permission: Permission;
}
export interface RequirementRule {
  id: string;
  sourceId: string;
  targetType: string;
  targetPattern?: string;
  // Applied to the sentence/line containing the target, not the whole FIR.
  targetContext: string;
  requiredData: string;
  purpose: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  priorityReason: string;
  maxDays: number;
}
export interface CaseTypeRule {
  id: string;
  signals: string[];
  requirements: RequirementRule[];
}
export interface IntelligenceRegistry {
  version: string;
  sources: SourceDefinition[];
  caseTypes: CaseTypeRule[];
}

// All domain mappings live here. The engine has no theft/scam/source branches.
// Case types and source mappings can be added here without changing the engine.
export const intelligenceRegistry: IntelligenceRegistry = {
  version: 'phase3-v1',
  sources: [
    { id: 'mock-financial', department: 'Synthetic Financial Intelligence Desk', category: 'financial', permission: Permission.SOURCE_FINANCIAL },
    { id: 'mock-cdr', department: 'Synthetic Telecom Desk', category: 'telecom', permission: Permission.SOURCE_CDR },
    { id: 'mock-criminal-history', department: 'Synthetic Criminal Records Desk', category: 'criminal-history', permission: Permission.SOURCE_CRIMINAL_HISTORY },
    { id: 'mock-vehicle', department: 'Synthetic Vehicle Registry', category: 'vehicle', permission: Permission.SOURCE_VEHICLE },
    { id: 'mock-location', department: 'Synthetic CCTV and Location Desk', category: 'location', permission: Permission.SOURCE_LOCATION },
    { id: 'mock-cyber', department: 'Synthetic Cyber Intelligence Desk', category: 'cyber', permission: Permission.SOURCE_CYBER },
  ],
  caseTypes: [
    {
      id: 'THEFT', signals: ['\\btheft\\b', '\\bstolen\\b', '\\bstole\\b'],
      requirements: [
        { id: 'theft-vehicle', sourceId: 'mock-vehicle', targetType: 'vehicle', targetContext: '\\b(stolen|theft|suspect|accused|escape)\\b', requiredData: 'Vehicle registration and reported theft records', purpose: 'Verify the vehicle associated with the reported theft.', priority: 'HIGH', priorityReason: 'A vehicle is explicitly linked to the reported theft.', maxDays: 31 },
        { id: 'theft-history', sourceId: 'mock-criminal-history', targetType: 'person', targetContext: '\\b(accused|suspect)\\s*:', requiredData: 'Prior case references for investigator verification', purpose: 'Check potentially relevant prior case references for the named suspect; do not infer guilt.', priority: 'MEDIUM', priorityReason: 'The document names a suspect; prior references require independent verification.', maxDays: 31 },
        { id: 'theft-cctv', sourceId: 'mock-location', targetType: 'location', targetContext: '\\b(cctv|theft|stolen|escape|incident)\\b', requiredData: 'Available CCTV and location observations within the incident window', purpose: 'Identify observations at the documented incident location and time.', priority: 'HIGH', priorityReason: 'Incident-location observations may be time-sensitive.', maxDays: 7 },
      ],
    },
    {
      id: 'ONLINE_SCAM', signals: ['\\bonline scam\\b', '\\bcyber fraud\\b', '\\bonline (?:payment )?fraud\\b', '\\bphishing\\b'],
      requirements: [
        { id: 'scam-financial', sourceId: 'mock-financial', targetType: 'money', targetPattern: '^\\d{9,18}$', targetContext: '\\b(account|a/c)\\b.*\\b(fraud|scam|transferred|payment|beneficiary)\\b|\\b(fraud|scam|transferred|payment|beneficiary)\\b.*\\b(account|a/c)\\b', requiredData: 'Account transaction records for the reported payment window', purpose: 'Trace the reported suspicious payment flow for the extracted account.', priority: 'HIGH', priorityReason: 'A financial identifier is explicitly tied to the reported payment.', maxDays: 31 },
        { id: 'scam-telecom', sourceId: 'mock-cdr', targetType: 'phone', targetContext: '\\b(scammer|fraudster|suspect|accused|caller|fraudulent|phishing)\\b', requiredData: 'Scoped call and SMS metadata', purpose: 'Verify communications associated with the reported fraudulent contact.', priority: 'MEDIUM', priorityReason: 'A phone is tied to the reported fraudulent contact; metadata may corroborate it.', maxDays: 31 },
        { id: 'scam-cyber', sourceId: 'mock-cyber', targetType: 'phone', targetContext: '\\b(scammer|fraudster|suspect|accused|caller|fraudulent|phishing)\\b', requiredData: 'Synthetic cyber complaint references for the reported contact', purpose: 'Check cyber complaint references associated with the reported fraudulent contact.', priority: 'MEDIUM', priorityReason: 'The reported contact is relevant to the online fraud context.', maxDays: 31 },
      ],
    },
  ],
};
