import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { id } from './common.js';
import { cars } from './cars.js';
import type { Policy, SettingsConfig } from '../../modules/ownership/domain.js';
const updatedAt = () => timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow();
const createdAt = () => timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow();
export const ownershipSettings = pgTable('vehicle_ownership_settings', {
  id: integer('id').primaryKey().default(1), enabled: boolean('enabled').notNull().default(true), config: jsonb('config').$type<SettingsConfig>().notNull(), updatedAt: updatedAt(),
}, t => [check('ownership_settings_singleton', sql`${t.id} = 1`)]);
// JSON policies use bounded integer VND, never floating currency fields.
export const ownershipProfiles = pgTable('vehicle_ownership_profiles', {
  id: id(), scope: text('scope').notNull(), target: text('target').notNull(), name: text('name').notNull(), policy: jsonb('policy').$type<Policy>().notNull(), updatedAt: updatedAt(),
}, t => [uniqueIndex('ownership_profile_target_uq').on(t.scope, t.target), check('ownership_profile_scope', sql`${t.scope} IN ('car','version','model','body','fuel')`)]);
export const ownershipSurveys = pgTable('vehicle_ownership_surveys', {
  id: id(), interactionId: uuid('interaction_id').notNull(), capabilityHash: text('capability_hash').notNull(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastRequestId: uuid('last_request_id').notNull(), revision: integer('revision').notNull().default(1), answersHash: text('answers_hash').notNull(),
  vehicleId: uuid('vehicle_id').notNull().references(() => cars.id),
  vehicleSnapshot: jsonb('vehicle_snapshot').$type<{ name: string; brand: string; model: string; year: number; price: number; mileage: number | null }>().notNull(),
  monthlyKm: integer('monthly_km').notNull(), driving: text('driving_type').notNull(), fuel: text('fuel_type').notNull(), energyPrice: bigint('energy_price', { mode: 'number' }).notNull(),
  parking: bigint('parking_monthly', { mode: 'number' }).notNull(), wash: bigint('wash_monthly', { mode: 'number' }).notNull(), toll: bigint('toll_monthly', { mode: 'number' }).notNull(),
  insurance: text('insurance_choice').notNull(), financed: boolean('is_financed').notNull(), downPct: numeric('down_payment_pct', { precision: 7, scale: 4 }), termMonths: integer('loan_term_months'), annualRate: numeric('annual_interest_rate', { precision: 7, scale: 4 }),
  years: integer('ownership_years').notNull(), region: text('region').notNull(), transaction: text('transaction_case').notNull(),
  operatingMonthly: bigint('estimated_monthly_operating_cost', { mode: 'number' }).notNull(), cashMonthly: bigint('estimated_monthly_cash_outflow', { mode: 'number' }).notNull(),
  tco: bigint('estimated_tco', { mode: 'number' }).notNull(), resale: bigint('estimated_resale_value', { mode: 'number' }).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [
  uniqueIndex('ownership_interaction_uq').on(t.interactionId), index('ownership_surveys_date_idx').on(t.createdAt, t.id),
  index('ownership_surveys_car_date_idx').on(t.vehicleId, t.createdAt), index('ownership_surveys_finance_date_idx').on(t.financed, t.createdAt),
  check('ownership_survey_bounds', sql`${t.monthlyKm} BETWEEN 0 AND 20000 AND ${t.years} BETWEEN 1 AND 20 AND ${t.energyPrice} BETWEEN 1 AND 100000 AND ${t.parking} BETWEEN 0 AND 20000000 AND ${t.wash} BETWEEN 0 AND 20000000 AND ${t.toll} BETWEEN 0 AND 20000000`),
  check('ownership_survey_money', sql`${t.operatingMonthly} >= 0 AND ${t.cashMonthly} >= 0 AND ${t.tco} >= 0 AND ${t.resale} >= 0`),
  check('ownership_survey_choices', sql`${t.driving} IN ('city','mixed','highway') AND ${t.fuel} IN ('gasoline','diesel','electric') AND ${t.insurance} IN ('mandatory','comprehensive')`),
  check('ownership_survey_finance', sql`(NOT ${t.financed} AND ${t.downPct} IS NULL AND ${t.termMonths} IS NULL AND ${t.annualRate} IS NULL) OR (${t.financed} AND ${t.downPct} IS NOT NULL AND ${t.downPct} BETWEEN 0 AND 100 AND ${t.termMonths} IS NOT NULL AND ${t.termMonths} BETWEEN 1 AND 240 AND ${t.annualRate} IS NOT NULL AND ${t.annualRate} BETWEEN 0 AND 40)`),
]);
