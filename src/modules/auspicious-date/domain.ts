export const PURPOSES = ['BUY_CAR', 'RECEIVE_CAR', 'SIGN_CONTRACT'] as const;
export type Purpose = typeof PURPOSES[number];
export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const EFFECTS = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'] as const;
export const CLASSIFICATIONS = ['VERY_GOOD', 'GOOD', 'NORMAL', 'NOT_RECOMMENDED', 'AVOID'] as const;
export const VERSION_STATUSES = ['DRAFT', 'REVIEW', 'VALIDATED', 'PUBLISHED', 'ARCHIVED'] as const;
export const SOURCE_STATUSES = ['UNVERIFIED', 'VERIFIED', 'REJECTED'] as const;
export const HANDLERS = ['DIRECT_AGE_CONFLICT', 'BRANCH_HARMONY', 'FIVE_ELEMENT_RELATION', 'TRADITIONAL_TABOO', 'AUSPICIOUS_DAY', 'PURPOSE_OFFICER', 'GOOD_HOURS'] as const;
export type Classification = typeof CLASSIFICATIONS[number];
export type Priority = typeof PRIORITIES[number];
export type Effect = typeof EFFECTS[number];
export type Handler = typeof HANDLERS[number];
export interface RuleParameters { officers?: number[] }
export interface RuleDefinition {
  id: string; code: string; category: string; priority: Priority; effect: Effect;
  weight: number; hardExclusion: boolean; isEnabled: boolean; engineHandler: Handler;
  sortOrder: number; parameters: RuleParameters;
}
export interface RuleResult {
  code: string; matched: boolean; status: 'PASS' | 'MATCH' | 'FAIL' | 'NOT_APPLICABLE';
  effect: Effect; priority: Priority; scoreDelta: number; hardExclusion: boolean;
  metadata: Record<string, unknown>;
}
export interface Explanation { code: string; effect: Effect; priority: Priority; title: string; shortDescription: string; detailDescription: string }
export interface ReferenceExpectation {
  calendar?: Record<string, unknown>;
  almanac?: Record<string, unknown>;
  rules?: { code: string; matched: boolean; status?: RuleResult['status'] }[];
  classification: Classification;
}
export interface ValidationReport {
  passed: boolean; errors: string[]; total: number; pass: number; fail: number; changed: number;
  cases: { id: string; name: string; status: 'PASS' | 'FAIL' | 'CHANGED'; differences: string[] }[];
}
