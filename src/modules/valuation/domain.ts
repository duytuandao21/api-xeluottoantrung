export const CATEGORIES = ['AGE', 'ODO', 'EXTERIOR', 'INTERIOR', 'ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION', 'SERVICE', 'OWNERS', 'USAGE', 'COLOR', 'MARKET'] as const;
export type Category = typeof CATEGORIES[number];
export const OPTION_CATEGORIES = ['EXTERIOR', 'INTERIOR', 'ACCIDENT', 'FLOOD', 'ENGINE', 'TRANSMISSION', 'SERVICE', 'USAGE'] as const;
export type OptionCategory = typeof OPTION_CATEGORIES[number];
export const RANGE_CATEGORIES: readonly Category[] = ['AGE', 'ODO', 'OWNERS'];
export const SCOPES = ['GLOBAL', 'BRAND', 'MODEL', 'VARIANT'] as const;
export const BASE_TYPES = ['ORIGINAL_MSRP', 'CURRENT_MSRP', 'MARKET_REFERENCE'] as const;
export const POLICY_STATUSES = ['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED'] as const;
export const VALUATION_PERMISSIONS = ['read', 'reference_prices.manage', 'rules.manage', 'settings.update', 'policies.manage', 'publish', 'audit.read', 'simulate', 'history.read', 'history.update'].map(action => `valuation.${action}`);
export interface PolicyConfig {
  expectedKmPerYear: number; youngVehicleAgeFloor: number; odoMaxBonusPercent: number; odoMaxPenaltyPercent: number;
  minValueFactor: number; maxValueFactor: number; marketRangeMinusPercent: number; marketRangePlusPercent: number;
  dealerMarginMinPercent: number; dealerMarginMaxPercent: number; roundingVnd: number;
  minModelYear: number; maxVehicleAge: number; maxOdometerKm: number;
  mediumConfidenceThreshold: number; highConfidenceThreshold: number;
  confidenceWeights: Record<'odo' | 'exterior' | 'interior' | 'accident' | 'flood' | 'engine' | 'transmission' | 'service' | 'owners' | 'usage' | 'color', number>;
  showSeverePriceRange: boolean;
}
export interface ValidationReport { passed: boolean; errors: string[]; warnings: string[]; revision: number; checkedAt: string }
