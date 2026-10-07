import type { EstimateInput, Evaluation, Option, Reference, Rule, Snapshot } from './estimate.types.js';
export const VALUATION_LEAD_STATUSES = ['NEW', 'CONTACTED', 'INSPECTION_SCHEDULED', 'PURCHASED', 'REJECTED', 'CLOSED'] as const;
export type ValuationLeadStatus = typeof VALUATION_LEAD_STATUSES[number];
export interface HistorySnapshot {
  schemaVersion: 1; input: EstimateInput;
  vehicle: { brandId: string; brandName: string; modelId: string; modelName: string; variantId: string; variantName: string; modelYear: number };
  policy: Pick<Snapshot['policy'], 'id' | 'name' | 'version' | 'revision' | 'config' | 'publishedAt'>;
  reference: Reference | null; resolvedRules: Rule[]; conditionOptions: Option[];
  color: { id: string; name: string; colorCode: string | null } | null;
  result: Evaluation; disclaimer: string; ctaLabel: string;
}
