import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { profiles } from './auth.js';
import { CLASSIFICATIONS, EFFECTS, PRIORITIES, PURPOSES, SOURCE_STATUSES, VERSION_STATUSES, type Purpose, type ReferenceExpectation, type RuleParameters, type ValidationReport } from '../../modules/auspicious-date/domain.js';

export const auspiciousPurpose = pgEnum('auspicious_purpose', PURPOSES);
export const auspiciousPriority = pgEnum('auspicious_priority', PRIORITIES);
export const auspiciousEffect = pgEnum('auspicious_effect', EFFECTS);
export const auspiciousVersionStatus = pgEnum('auspicious_version_status', VERSION_STATUSES);
export const auspiciousSourceStatus = pgEnum('auspicious_source_status', SOURCE_STATUSES);
export const auspiciousClassification = pgEnum('auspicious_classification', CLASSIFICATIONS);

export const auspiciousSettings = pgTable('auspicious_date_settings', {
  id: integer('id').primaryKey().default(1), isEnabled: boolean('is_enabled').notNull().default(false),
  name: text('name').notNull().default('Xem ngày mua xe'), maxSearchDays: integer('max_search_days').notNull().default(90),
  defaultPurpose: auspiciousPurpose('default_purpose').notNull().default('BUY_CAR'),
  supportedPurposes: jsonb('supported_purposes').$type<Purpose[]>().notNull().default([...PURPOSES]),
  showLunarDate: boolean('show_lunar_date').notNull().default(true), showCanChi: boolean('show_can_chi').notNull().default(true),
  showGoodHours: boolean('show_good_hours').notNull().default(false), showExplanation: boolean('show_explanation').notNull().default(true), showScore: boolean('show_score').notNull().default(false),
  disclaimer: text('disclaimer').notNull().default('Thông tin được tổng hợp theo hệ thống lịch và các quan niệm truyền thống, chỉ mang tính tham khảo.'),
  ctaLabel: text('cta_label').notNull().default('Xem xe đang bán tại Toàn Trung'),
  seoTitle: text('seo_title').notNull().default('Xem ngày mua xe | Xe Lướt Toàn Trung'),
  seoDescription: text('seo_description').notNull().default('Tham khảo ngày mua xe, nhận xe và ký hợp đồng theo lịch Việt Nam.'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [check('auspicious_settings_singleton', sql`${t.id} = 1`), check('auspicious_settings_range', sql`${t.maxSearchDays} between 1 and 90`)]);

export const auspiciousRuleSets = pgTable('auspicious_rule_sets', {
  id: id(), code: text('code').notNull(), name: text('name').notNull(), purpose: auspiciousPurpose('purpose').notNull(), version: text('version').notNull(),
  status: auspiciousVersionStatus('status').notNull().default('DRAFT'), revision: integer('revision').notNull().default(1),
  validatedRevision: integer('validated_revision'), validationReport: jsonb('validation_report').$type<ValidationReport>(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }), publishedAt: timestamp('published_at', { withTimezone: true }),
  createdBy: uuid('created_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('auspicious_version_purpose_uq').on(t.purpose, t.version),
  uniqueIndex('auspicious_one_published_uq').on(t.purpose).where(sql`${t.status} = 'PUBLISHED'`)]);

export const auspiciousRules = pgTable('auspicious_rules', {
  id: id(), ruleSetId: uuid('rule_set_id').notNull().references(() => auspiciousRuleSets.id, { onDelete: 'cascade' }),
  code: text('code').notNull(), category: text('category').notNull(), priority: auspiciousPriority('priority').notNull(), effect: auspiciousEffect('effect').notNull(),
  weight: integer('weight').notNull().default(0), hardExclusion: boolean('hard_exclusion').notNull().default(false), isEnabled: boolean('is_enabled').notNull().default(true),
  engineHandler: text('engine_handler').notNull(), parameters: jsonb('parameters').$type<RuleParameters>().notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('auspicious_rules_code_uq').on(t.ruleSetId, t.code),
  check('auspicious_rules_weight', sql`${t.weight} between 0 and 50`),
  check('auspicious_rules_critical_exclusion', sql`not ${t.hardExclusion} or (${t.priority} = 'CRITICAL' and ${t.effect} = 'NEGATIVE')`)]);

export const auspiciousRuleContents = pgTable('auspicious_rule_contents', {
  id: id(), ruleId: uuid('rule_id').notNull().references(() => auspiciousRules.id, { onDelete: 'cascade' }), locale: text('locale').notNull().default('vi-VN'),
  title: text('title').notNull(), shortDescription: text('short_description').notNull(), detailDescription: text('detail_description').notNull().default(''),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('auspicious_rule_content_locale_uq').on(t.ruleId, t.locale)]);

export const auspiciousRuleSources = pgTable('auspicious_rule_sources', {
  id: id(), ruleId: uuid('rule_id').notNull().references(() => auspiciousRules.id, { onDelete: 'cascade' }), title: text('title').notNull(),
  author: text('author').notNull().default(''), publisher: text('publisher').notNull().default(''), edition: text('edition').notNull().default(''),
  publishedYear: integer('published_year'), pageReference: text('page_reference').notNull().default(''), url: text('url').notNull().default(''), note: text('note').notNull().default(''),
  verificationStatus: auspiciousSourceStatus('verification_status').notNull().default('UNVERIFIED'),
  verifiedBy: uuid('verified_by').references(() => profiles.id), verifiedAt: timestamp('verified_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index('auspicious_sources_rule_idx').on(t.ruleId)]);

export const auspiciousReferenceCases = pgTable('auspicious_reference_cases', {
  id: id(), ruleSetId: uuid('rule_set_id').notNull().references(() => auspiciousRuleSets.id, { onDelete: 'cascade' }), name: text('name').notNull(),
  birthDate: date('birth_date').notNull(), gender: text('gender'), purpose: auspiciousPurpose('purpose').notNull(), targetDate: date('target_date').notNull(),
  expected: jsonb('expected').$type<ReferenceExpectation>().notNull(), ruleSetVersion: text('rule_set_version').notNull(), sourceNote: text('source_note').notNull(),
  isActive: boolean('is_active').notNull().default(true), createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index('auspicious_cases_set_idx').on(t.ruleSetId)]);

export const auspiciousChangeLogs = pgTable('auspicious_change_logs', {
  id: id(), adminUserId: uuid('admin_user_id').notNull().references(() => profiles.id),
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(), ruleSetId: uuid('rule_set_id').references(() => auspiciousRuleSets.id),
  action: text('action').notNull(), beforeData: jsonb('before_data'), afterData: jsonb('after_data'), reason: text('reason').notNull(),
  createdAt: createdAt(),
}, t => [index('auspicious_audit_created_idx').on(t.createdAt)]);
