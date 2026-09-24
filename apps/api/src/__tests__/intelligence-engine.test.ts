import { describe, expect, it } from 'vitest';
import { extractMentions } from '../modules/document-intelligence/extractors';
import { analyzeContext, parseMentionDate, type CaseContext } from '../modules/intelligence-requirements/engine';
import { intelligenceRegistry } from '../modules/intelligence-requirements/registry';

function context(text: string, metadata = ''): CaseContext {
  return { caseId: 'case', metadata, documents: [{ id: 'doc', contentHash: 'hash', pages: [{ pageNumber: 1, text }] }],
    mentions: extractMentions([{ pageNumber: 1, text }]).map((m,i) => ({ ...m, id: String(i), documentId: 'doc', evidenceRecordId: 'evidence', normalizedText: m.normalizedText ?? null })) };
}
const theft = 'Reported vehicle theft.\nIncident window: 01 September 2026 to 02 September 2026\nAccused: Arjun Demo\nComplainant: Meera Example\nThe stolen vehicle MP09AB1234 was seen.\nCCTV at Gandhi Nagar Colony recorded the theft.';
const scam = 'Online payment fraud.\nTransaction window: 01 August 2026 to 15 August 2026\nThe victim transferred payment to account no. 123456789012 during the fraud.\nThe fraudulent caller used 9876543210.';

describe('Case-type requirement engine', () => {
  it('classifies theft and derives only justified vehicle/history/location requirements', () => {
    const result = analyzeContext(context(theft + '\nOffice account no. 123456789012.'));
    expect(result.caseType).toBe('THEFT');
    expect(result.gaps.map(g => g.sourceId).sort()).toEqual(['mock-criminal-history','mock-location','mock-vehicle']);
    expect(result.gaps.find(g => g.targetType === 'person')?.targetEntity).toBe('Arjun Demo');
    expect(result.gaps.some(g => g.targetEntity === 'Meera Example')).toBe(false);
  });
  it('classifies online scam and excludes unrelated vehicle/CCTV and monetary amounts', () => {
    const result = analyzeContext(context(scam + '\nRs. 123456789000\nUnrelated vehicle MP09AB1234 near Gandhi Nagar Colony.'));
    expect(result.caseType).toBe('ONLINE_SCAM');
    expect(result.gaps.map(g => g.sourceId).sort()).toEqual(['mock-cdr','mock-cyber','mock-financial']);
    expect(result.gaps.find(g => g.sourceId === 'mock-financial')?.targetEntity).toBe('123456789012');
  });
  it('records evidence, purpose, deterministic priorities and the explicit window', () => {
    const gap = analyzeContext(context(theft)).gaps.find(g => g.sourceId === 'mock-vehicle')!;
    expect(gap.timeFrom.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(gap.timeTo.toISOString()).toBe('2026-09-02T23:59:59.999Z');
    expect(gap.priority).toBe('HIGH');
    expect(gap.priorityReason).toContain('vehicle');
    expect(gap.explanation).toContain('MP09AB1234');
    expect(gap.explanation).toContain('theft-vehicle');
    expect(gap.purpose.length).toBeGreaterThan(20);
    expect(gap.origins.some(o => o.mentionType === 'date')).toBe(true);
    expect(gap.origins.every(o => o.evidenceRecordId === 'evidence')).toBe(true);
  });
  it.each([
    ['missing', ''], ['filing-only', 'Filing date: 01 September 2026'],
    ['invalid', 'Incident date: 31 February 2026'], ['ambiguous-year', 'Incident date: 01/09/26'],
    ['too-wide', 'Incident window: 01 January 2026 to 01 September 2026'],
    ['future', 'Incident date: 01 January 2099'],
    ['reversed', 'Incident window: 15 August 2026 to 01 August 2026'],
  ])('rejects %s time ranges without inventing dates', (_label, date) => {
    expect(analyzeContext(context('Vehicle theft.\n' + date + '\nThe stolen vehicle MP09AB1234.')).gaps).toHaveLength(0);
  });
  it('accepts an explicit single-day window and parses calendar dates strictly', () => {
    const result = analyzeContext(context('Vehicle theft.\nIncident date: 02/09/2026\nThe stolen vehicle MP09AB1234.'));
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].timeTo.getTime() - result.gaps[0].timeFrom.getTime()).toBe(86_399_999);
    expect(parseMentionDate('2026-02-30')).toBeNull();
    expect(parseMentionDate('2024-02-29')?.toISOString()).toContain('2024-02-29');
  });
  it('uses ISO dates from the existing Phase 2 extractor', () => {
    const result = analyzeContext(context('Vehicle theft.\nIncident window: 2026-08-01 to 2026-08-15\nThe stolen vehicle MP09AB1234.'));
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].timeFrom.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });
  it('requires a target association, not just a case-type keyword', () => {
    expect(analyzeContext(context('Online scam.\nIncident date: 01 September 2026\nOffice phone 9876543210.\nOffice account no. 123456789012.')).gaps).toEqual([]);
    expect(analyzeContext(context('Unknown complaint')).caseType).toBe('UNKNOWN');
  });
  it('does not borrow an unrelated document date for a target', () => {
    const ctx = context('Vehicle theft.\nThe stolen vehicle MP09AB1234.');
    const other = context('Incident date: 01 September 2026');
    ctx.documents.push({ ...other.documents[0], id: 'other' });
    ctx.mentions.push(...other.mentions.map(m => ({ ...m, documentId: 'other' })));
    expect(analyzeContext(ctx).gaps).toHaveLength(0);
  });
  it('supports mixed cases and new case mappings without engine changes', () => {
    expect(analyzeContext(context(theft + '\nOnline scam.')).caseType).toBe('MIXED');
    const registry = { ...intelligenceRegistry, version: 'custom', caseTypes: [{ id: 'CUSTOM', signals: ['custom report'], requirements: intelligenceRegistry.caseTypes[0].requirements.slice(0,1) }] };
    const result = analyzeContext(context(theft + '\nCustom report.'), registry);
    expect(result.caseType).toBe('CUSTOM');
    expect(result.gaps).toHaveLength(1);
  });
  it('keeps stable fingerprints/context when extraction IDs change', () => {
    const ctx = context(theft);
    const first = analyzeContext(ctx);
    ctx.mentions = ctx.mentions.map(m => ({ ...m, id: m.id + '-new' }));
    const second = analyzeContext(ctx);
    expect(second.contextHash).toBe(first.contextHash);
    expect(second.gaps.map(g => g.fingerprint)).toEqual(first.gaps.map(g => g.fingerprint));
  });
});
