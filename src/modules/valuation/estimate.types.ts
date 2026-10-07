import type { valuationOptions, valuationPolicies, valuationReferencePrices, valuationRules } from '../../database/schema/valuation.js';
import type { Category, OptionCategory } from './domain.js';

export interface EstimateInput {
  brandId: string; modelId: string; variantId: string; modelYear: number;
  odometerKm?: number | null; manufacturingDate?: string | null; registrationDate?: string | null;
  exteriorCondition?: string | null; interiorCondition?: string | null; accidentLevel?: string | null; floodLevel?: string | null;
  engineCondition?: string | null; transmissionCondition?: string | null; serviceHistory?: string | null;
  ownerCount?: number | null; usageType?: string | null; colorId?: string | null;
}
export type Snapshot = { policy: typeof valuationPolicies.$inferSelect; options: Option[]; rules: Rule[]; references: Reference[] };
export type Rule = typeof valuationRules.$inferSelect;
export type Reference = typeof valuationReferencePrices.$inferSelect;
export type Option = typeof valuationOptions.$inferSelect;
export const CONDITION_FIELDS = {
  EXTERIOR: 'exteriorCondition', INTERIOR: 'interiorCondition', ACCIDENT: 'accidentLevel', FLOOD: 'floodLevel',
  ENGINE: 'engineCondition', TRANSMISSION: 'transmissionCondition', SERVICE: 'serviceHistory', USAGE: 'usageType',
} as const satisfies Record<OptionCategory, keyof EstimateInput>;
export interface PriceRange { min: number; max: number }
export interface Adjustment {
  type: Category; label: string; ruleId: string | null; scope: Rule['scope'] | null;
  configuredPercentage: number; percentage: number; factor: number; before: number; after: number;
  manualInspectionRequired: boolean; fallback: boolean;
}
export interface Reason { code: string; message: string }
export interface Evaluation {
  status: 'ESTIMATED' | 'MANUAL_INSPECTION' | 'MISSING_REFERENCE' | 'INSUFFICIENT_DATA';
  policyId: string; policyVersion: string; policyRevision: number; calculatedAt: string;
  ageYears: number; ageSource: 'MANUFACTURING_DATE' | 'REGISTRATION_DATE' | 'MODEL_YEAR';
  expectedOdometerKm: number; odometerDeviationPercent: number | null;
  referencePrice: number | null; referenceType: Reference['basePriceType'] | null; referenceId: string | null;
  referenceBasis: { ageYears: number; odometerKm: number; ageFactor: number; odoFactor: number; note: string } | null;
  estimatedMarketValue: number | null; marketRange: PriceRange | null; dealerBuyingRange: PriceRange | null;
  candidateMarketRange: PriceRange | null; candidateDealerBuyingRange: PriceRange | null;
  confidenceScore: number; confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH'; missingFields: string[];
  manualInspectionRequired: boolean; reasons: Reason[]; adjustments: Adjustment[];
  cap: { before: number; after: number; min: number; max: number; applied: boolean } | null;
}
