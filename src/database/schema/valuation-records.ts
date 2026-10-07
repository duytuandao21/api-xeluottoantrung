import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id, createdAt, updatedAt } from './common.js';
import { valuationPolicies } from './valuation.js';
import { brands, carModels } from './catalog.js';
import { leads } from './engagement.js';
import { VALUATION_LEAD_STATUSES, type HistorySnapshot } from '../../modules/valuation/history.types.js';
export const valuationLeadStatus = pgEnum('valuation_lead_status', VALUATION_LEAD_STATUSES);
export const valuationRecords = pgTable('valuation_records', {
  id: id(), createdAt: createdAt(), updatedAt: updatedAt(),
  policyId: uuid('policy_id').references(() => valuationPolicies.id, { onDelete: 'set null' }), policyVersion: text('policy_version').notNull(),
  brandId: uuid('brand_id').references(() => brands.id, { onDelete: 'set null' }), modelId: uuid('model_id').references(() => carModels.id, { onDelete: 'set null' }),
  vehicleName: text('vehicle_name').notNull(), modelYear: integer('model_year').notNull(), odometerKm: integer('odometer_km'),
  estimatedMarketValue: bigint('estimated_market_value', { mode: 'number' }),
  marketMin: bigint('market_min', { mode: 'number' }), marketMax: bigint('market_max', { mode: 'number' }),
  buyingMin: bigint('buying_min', { mode: 'number' }), buyingMax: bigint('buying_max', { mode: 'number' }),
  confidenceScore: integer('confidence_score').notNull(), resultStatus: text('result_status').notNull(),
  snapshot: jsonb('snapshot').$type<HistorySnapshot>().notNull(),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }), leadStatus: valuationLeadStatus('lead_status'),
  leadTokenHash: text('lead_token_hash').notNull(), leadTokenExpiresAt: timestamp('lead_token_expires_at', { withTimezone: true }).notNull(),
}, t => [index('valuation_records_created_idx').on(t.createdAt, t.id), index('valuation_records_vehicle_idx').on(t.brandId, t.modelId, t.createdAt),
  index('valuation_records_status_idx').on(t.leadStatus, t.createdAt), index('valuation_records_value_idx').on(t.estimatedMarketValue),
  uniqueIndex('valuation_records_lead_uq').on(t.leadId),
  check('valuation_records_score', sql`${t.confidenceScore} BETWEEN 0 AND 100`),
  check('valuation_records_year', sql`${t.modelYear} BETWEEN 1886 AND 2100`),
  check('valuation_records_odo', sql`${t.odometerKm} IS NULL OR ${t.odometerKm} >= 0`),
  check('valuation_records_prices', sql`(${t.estimatedMarketValue} IS NULL OR ${t.estimatedMarketValue} > 0) AND (${t.marketMin} IS NULL AND ${t.marketMax} IS NULL OR ${t.marketMin} IS NOT NULL AND ${t.marketMax} IS NOT NULL AND ${t.marketMin} > 0 AND ${t.marketMax} >= ${t.marketMin}) AND (${t.buyingMin} IS NULL AND ${t.buyingMax} IS NULL OR ${t.buyingMin} IS NOT NULL AND ${t.buyingMax} IS NOT NULL AND ${t.buyingMin} > 0 AND ${t.buyingMax} >= ${t.buyingMin})`),
  check('valuation_records_result_status', sql`${t.resultStatus} IN ('ESTIMATED','MANUAL_INSPECTION','MISSING_REFERENCE','INSUFFICIENT_DATA')`),
]);
