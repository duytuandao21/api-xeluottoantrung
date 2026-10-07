import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { profiles } from './auth.js';
import { brands, carModels, carVersions, carColors } from './catalog.js';
import { BASE_TYPES, CATEGORIES, POLICY_STATUSES, SCOPES, type PolicyConfig, type ValidationReport } from '../../modules/valuation/domain.js';

export const valuationCategory = pgEnum('valuation_category', CATEGORIES);
export const valuationScope = pgEnum('valuation_scope', SCOPES);
export const valuationBaseType = pgEnum('valuation_base_type', BASE_TYPES);
export const valuationPolicyStatus = pgEnum('valuation_policy_status', POLICY_STATUSES);
export const valuationPolicies = pgTable('valuation_policies', {
  id: id(), name: text('name').notNull(), version: text('version').notNull(), status: valuationPolicyStatus('status').default('DRAFT').notNull(),
  revision: integer('revision').default(1).notNull(), validatedRevision: integer('validated_revision'),
  config: jsonb('config').$type<PolicyConfig>().notNull(), validationReport: jsonb('validation_report').$type<ValidationReport>(),
  createdBy: uuid('created_by').references(() => profiles.id), updatedBy: uuid('updated_by').references(() => profiles.id),
  publishedBy: uuid('published_by').references(() => profiles.id), publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('valuation_policy_version_uq').on(t.version),
  uniqueIndex('valuation_one_published_uq').on(t.status).where(sql`${t.status} = 'PUBLISHED'`),
  check('valuation_policy_revision_valid', sql`${t.revision} > 0`)]);

export const valuationSettings = pgTable('valuation_settings', {
  id: integer('id').primaryKey().default(1), isEnabled: boolean('is_enabled').default(false).notNull(),
  activePolicyId: uuid('active_policy_id').references(() => valuationPolicies.id),
  disclaimer: text('disclaimer').notNull(), ctaLabel: text('cta_label').notNull(),
  updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [check('valuation_settings_singleton', sql`${t.id} = 1`), check('valuation_enabled_policy', sql`NOT ${t.isEnabled} OR ${t.activePolicyId} IS NOT NULL`)]);

export const valuationReferencePrices = pgTable('valuation_reference_prices', {
  id: id(), policyId: uuid('policy_id').notNull().references(() => valuationPolicies.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id').notNull().references(() => carVersions.id), modelYear: integer('model_year').notNull(),
  originalMsrp: bigint('original_msrp', { mode: 'number' }), currentMsrp: bigint('current_msrp', { mode: 'number' }),
  marketReference: bigint('market_reference', { mode: 'number' }), basePriceType: valuationBaseType('base_price_type').notNull(),
  source: text('source').notNull(), note: text('note').notNull().default(''),
  referenceAgeYears: numeric('reference_age_years', { precision: 6, scale: 2, mode: 'number' }), referenceOdometerKm: integer('reference_odometer_km'),
  basisNote: text('basis_note').notNull().default(''),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(), effectiveTo: timestamp('effective_to', { withTimezone: true }),
  active: boolean('active').default(true).notNull(), updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index('valuation_reference_lookup_idx').on(t.policyId, t.variantId, t.modelYear, t.active),
  check('valuation_reference_year', sql`${t.modelYear} BETWEEN 1886 AND 2100`),
  check('valuation_reference_prices_valid', sql`(${t.originalMsrp} IS NULL OR ${t.originalMsrp} BETWEEN 1 AND 9007199254740991) AND (${t.currentMsrp} IS NULL OR ${t.currentMsrp} BETWEEN 1 AND 9007199254740991) AND (${t.marketReference} IS NULL OR ${t.marketReference} BETWEEN 1 AND 9007199254740991)`),
  check('valuation_reference_selected_price', sql`CASE ${t.basePriceType} WHEN 'ORIGINAL_MSRP' THEN ${t.originalMsrp} IS NOT NULL WHEN 'CURRENT_MSRP' THEN ${t.currentMsrp} IS NOT NULL ELSE ${t.marketReference} IS NOT NULL END`),
  check('valuation_reference_dates', sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`),
  check('valuation_reference_market_basis', sql`${t.basePriceType} <> 'MARKET_REFERENCE' OR (${t.referenceAgeYears} IS NOT NULL AND ${t.referenceAgeYears} >= 0 AND ${t.referenceOdometerKm} IS NOT NULL AND ${t.referenceOdometerKm} >= 0 AND length(trim(${t.basisNote})) >= 3)`)]);

export const valuationOptions = pgTable('valuation_condition_options', {
  id: id(), policyId: uuid('policy_id').notNull().references(() => valuationPolicies.id, { onDelete: 'cascade' }),
  category: valuationCategory('category').notNull(), code: text('code').notNull(), label: text('label').notNull(),
  description: text('description').notNull().default(''), isUnknown: boolean('is_unknown').default(false).notNull(),
  requiresInspection: boolean('requires_inspection').default(false).notNull(), active: boolean('active').default(true).notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('valuation_options_code_uq').on(t.policyId, t.category, t.code),
  check('valuation_options_category', sql`${t.category} IN ('EXTERIOR','INTERIOR','ACCIDENT','FLOOD','ENGINE','TRANSMISSION','SERVICE','USAGE')`),
  check('valuation_options_order', sql`${t.sortOrder} >= 0`)]);

export const valuationRules = pgTable('valuation_rules', {
  id: id(), policyId: uuid('policy_id').notNull().references(() => valuationPolicies.id, { onDelete: 'cascade' }),
  category: valuationCategory('category').notNull(), scope: valuationScope('scope').default('GLOBAL').notNull(),
  brandId: uuid('brand_id').references(() => brands.id), modelId: uuid('model_id').references(() => carModels.id), variantId: uuid('variant_id').references(() => carVersions.id),
  optionId: uuid('option_id').references(() => valuationOptions.id), colorId: uuid('color_id').references(() => carColors.id),
  minValue: numeric('min_value', { precision: 14, scale: 2, mode: 'number' }), maxValue: numeric('max_value', { precision: 14, scale: 2, mode: 'number' }),
  adjustmentPercent: numeric('adjustment_percent', { precision: 6, scale: 2, mode: 'number' }).notNull(),
  manualInspectionRequired: boolean('manual_inspection_required').default(false).notNull(), active: boolean('active').default(true).notNull(),
  label: text('label').notNull(), note: text('note').notNull().default(''),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }), effectiveTo: timestamp('effective_to', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index('valuation_rules_lookup_idx').on(t.policyId, t.category, t.scope, t.active),
  check('valuation_rule_scope_fk', sql`(${t.scope} = 'GLOBAL' AND ${t.brandId} IS NULL AND ${t.modelId} IS NULL AND ${t.variantId} IS NULL) OR (${t.scope} = 'BRAND' AND ${t.brandId} IS NOT NULL AND ${t.modelId} IS NULL AND ${t.variantId} IS NULL) OR (${t.scope} = 'MODEL' AND ${t.modelId} IS NOT NULL AND ${t.brandId} IS NULL AND ${t.variantId} IS NULL) OR (${t.scope} = 'VARIANT' AND ${t.variantId} IS NOT NULL AND ${t.brandId} IS NULL AND ${t.modelId} IS NULL)`),
  check('valuation_rule_percent', sql`${t.adjustmentPercent} BETWEEN -95 AND 100`),
  check('valuation_rule_range', sql`${t.minValue} IS NULL OR ${t.maxValue} IS NULL OR ${t.minValue} < ${t.maxValue}`),
  check('valuation_rule_dates', sql`${t.effectiveTo} IS NULL OR ${t.effectiveFrom} IS NOT NULL AND ${t.effectiveFrom} < ${t.effectiveTo}`),
  check('valuation_rule_selector', sql`CASE WHEN ${t.category} IN ('AGE','ODO','OWNERS') THEN ${t.optionId} IS NULL AND ${t.colorId} IS NULL AND (${t.minValue} IS NOT NULL OR ${t.maxValue} IS NOT NULL) WHEN ${t.category} = 'COLOR' THEN ${t.colorId} IS NOT NULL AND ${t.optionId} IS NULL AND ${t.minValue} IS NULL AND ${t.maxValue} IS NULL WHEN ${t.category} = 'MARKET' THEN ${t.colorId} IS NULL AND ${t.optionId} IS NULL AND ${t.minValue} IS NULL AND ${t.maxValue} IS NULL ELSE ${t.optionId} IS NOT NULL AND ${t.colorId} IS NULL AND ${t.minValue} IS NULL AND ${t.maxValue} IS NULL END`)]);
