import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { profiles } from './auth.js';
import { cars } from './cars.js';
import type { Answers, Assessments, Criteria, RecommendationConfig, Snapshot } from '../../modules/car-recommendations/domain.js';
export const recommendationSettings = pgTable('recommendation_settings', {
  id: integer('id').primaryKey().default(1), enabled: boolean('enabled').default(true).notNull(),
  config: jsonb('config').$type<RecommendationConfig>().notNull(), retentionDays: integer('retention_days').default(180).notNull(),
  updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [check('recommendation_settings_singleton', sql`${t.id} = 1`), check('recommendation_retention_valid', sql`${t.retentionDays} BETWEEN 1 AND 730`)]).enableRLS();
export const carRecommendationProfiles = pgTable('car_recommendation_profiles', {
  carId: uuid('car_id').primaryKey().references(() => cars.id, { onDelete: 'cascade' }),
  assessments: jsonb('assessments').$type<Assessments>().notNull().default({}), updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}).enableRLS();
export const recommendationSessions = pgTable('recommendation_sessions', {
  id: id(), requestId: uuid('request_id').notNull(), capabilityHash: text('capability_hash').notNull(), answersHash: text('answers_hash').notNull(),
  answers: jsonb('answers').$type<Answers>().notNull(), criteria: jsonb('criteria').$type<Criteria>().notNull(), snapshot: jsonb('snapshot').$type<Snapshot>().notNull(),
  resultCount: integer('result_count').notNull(), topScore: integer('top_score'), completionMs: integer('completion_ms').notNull(),
  status: text('status').default('completed').notNull(), createdAt: createdAt(), expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [uniqueIndex('recommendation_request_uq').on(t.requestId), index('recommendation_sessions_created_idx').on(t.createdAt), index('recommendation_sessions_expiry_idx').on(t.expiresAt), index('recommendation_sessions_criteria_idx').using('gin', t.criteria),
  check('recommendation_session_valid', sql`${t.resultCount} BETWEEN 0 AND 5000 AND ${t.completionMs} BETWEEN 0 AND 86400000 AND ${t.status} = 'completed' AND (${t.topScore} IS NULL OR ${t.topScore} BETWEEN 0 AND 100)`),
  check('recommendation_session_hashes', sql`${t.capabilityHash} ~ '^[0-9a-f]{64}$' AND ${t.answersHash} ~ '^[0-9a-f]{64}$'`)]).enableRLS();
export const recommendationEvents = pgTable('recommendation_events', {
  id: id(), sessionId: uuid('session_id').notNull().references(() => recommendationSessions.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), carId: uuid('car_id'), dedupeKey: text('dedupe_key').notNull(), createdAt: createdAt(),
}, t => [uniqueIndex('recommendation_event_dedupe_uq').on(t.sessionId, t.dedupeKey), index('recommendation_events_session_idx').on(t.sessionId, t.createdAt), index('recommendation_events_type_idx').on(t.type, t.createdAt),
  check('recommendation_event_type', sql`${t.type} IN ('result_viewed','car_clicked','contact_clicked','quiz_restarted')`),
  check('recommendation_event_car', sql`(${t.type} <> 'car_clicked' OR ${t.carId} IS NOT NULL) AND (${t.type} NOT IN ('result_viewed','quiz_restarted') OR ${t.carId} IS NULL)`)]).enableRLS();
