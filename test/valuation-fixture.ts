import { DEFAULT_CONFIG, OPTION_EXAMPLES, RANGE_EXAMPLES } from '../src/modules/valuation/defaults.js';
import type { OptionCategory } from '../src/modules/valuation/domain.js';
import type { EstimateInput, Rule, Snapshot } from '../src/modules/valuation/estimate.types.js';

export const fixtureId = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const FIXTURE_NOW = new Date('2026-10-06T05:00:00Z');
export function valuationFixture(): { input: EstimateInput; snapshot: Snapshot } {
  const policyId = fixtureId(1), date = new Date('2020-01-01T00:00:00Z'); let next = 10;
  const snapshot: Snapshot = {
    policy: { id: policyId, name: 'Synthetic test policy', version: '1.0.0', status: 'DRAFT', revision: 1, validatedRevision: null, config: structuredClone(DEFAULT_CONFIG), validationReport: null, createdBy: null, updatedBy: null, publishedBy: null, publishedAt: null, createdAt: date, updatedAt: date },
    options: [], rules: [], references: [{ id: fixtureId(2), policyId, variantId: fixtureId(5), modelYear: 2023, originalMsrp: 900000000, currentMsrp: 1000000000, marketReference: 680000000, basePriceType: 'ORIGINAL_MSRP', source: 'Synthetic test; not market data', note: '', referenceAgeYears: 3, referenceOdometerKm: 45000, basisNote: 'Neutral condition, 2 owners, personal use', effectiveFrom: date, effectiveTo: null, active: true, updatedBy: null, createdAt: date, updatedAt: date }],
  };
  const addRule = (data: Partial<Rule>) => snapshot.rules.push({ id: fixtureId(next++), policyId, category: 'AGE', scope: 'GLOBAL', brandId: null, modelId: null, variantId: null, optionId: null, colorId: null, minValue: null, maxValue: null, adjustmentPercent: 0, manualInspectionRequired: false, active: true, label: 'Fixture', note: '', effectiveFrom: null, effectiveTo: null, updatedBy: null, createdAt: date, updatedAt: date, ...data });
  for (const rule of RANGE_EXAMPLES) addRule(rule);
  for (const [category, examples] of Object.entries(OPTION_EXAMPLES) as [OptionCategory, typeof OPTION_EXAMPLES[OptionCategory]][]) {
    const rows = [...examples, ['UNKNOWN', 'Chưa rõ', 0, ['ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION'].includes(category)] as typeof examples[number]];
    for (const [sortOrder, [code, label, percent, manual]] of rows.entries()) {
      const optionId = fixtureId(next++);
      snapshot.options.push({ id: optionId, policyId, category, code, label, description: '', isUnknown: code === 'UNKNOWN', requiresInspection: !!manual, active: true, sortOrder, updatedBy: null, createdAt: date, updatedAt: date });
      addRule({ category, optionId, adjustmentPercent: percent, manualInspectionRequired: !!manual, label });
    }
  }
  return { snapshot, input: { brandId: fixtureId(3), modelId: fixtureId(4), variantId: fixtureId(5), modelYear: 2023, odometerKm: 45000, exteriorCondition: 'ORIGINAL', interiorCondition: 'GOOD', accidentLevel: 'NONE', floodLevel: 'NONE', engineCondition: 'NORMAL', transmissionCondition: 'NORMAL', serviceHistory: 'PARTIAL', ownerCount: 2, usageType: 'PERSONAL', colorId: fixtureId(6) } };
}
