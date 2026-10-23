import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { profiles } from './auth.js';

// Current content is edited directly. Snapshot/approval columns remain only for
// compatibility with earlier migrations; the about-story service does not read them.
export const aboutStoryPages = pgTable('about_story_pages', {
  id: id(),
  revision: integer('revision').default(0).notNull(),
  publishedRevision: integer('published_revision'),
  publishedSnapshot: jsonb('published_snapshot'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  updatedBy: uuid('updated_by').references(() => profiles.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [check('about_story_revision_nonnegative', sql`${t.revision} >= 0`)]);

export const aboutStorySections = pgTable('about_story_sections', {
  id: id(),
  chapterKey: text('chapter_key').notNull(),
  title: text('title').notNull(), subtitle: text('subtitle'), body: text('body'),
  ctaLabel: text('cta_label'), ctaHref: text('cta_href'), visible: boolean('visible').default(true).notNull(),
  updatedAt: updatedAt(),
}, t => [uniqueIndex('about_story_sections_chapter_uq').on(t.chapterKey),
  check('about_story_chapter_key_ck', sql`${t.chapterKey} IN ('opening','milestones','stories','people','future')`)]);

export const aboutMilestones = pgTable('about_milestones', {
  id: id(), slug: text('slug').notNull(), periodLabel: text('period_label').notNull(),
  eventDate: text('event_date'), stage: text('stage').notNull(), title: text('title').notNull(),
  summary: text('summary').notNull(), body: text('body'), featured: boolean('featured').default(false).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  verificationStatus: text('verification_status').default('needs_review').notNull(),
  publishStatus: text('publish_status').default('draft').notNull(),
  sourceNote: text('source_note'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('about_milestones_slug_uq').on(t.slug), index('about_milestones_order_idx').on(t.sortOrder),
  check('about_milestone_stage_ck', sql`${t.stage} IN ('1997-2017','2018-2022','2024-2025','2026')`),
  check('about_milestone_verification_ck', sql`${t.verificationStatus} IN ('verified','needs_review')`),
  check('about_milestone_publish_ck', sql`${t.publishStatus} IN ('draft','published')`)]);

export const aboutCustomerStories = pgTable('about_customer_stories', {
  id: id(), title: text('title').notNull(), body: text('body').notNull(), quote: text('quote'),
  displayName: text('display_name'), consentStatus: text('consent_status').default('missing').notNull(),
  consentReference: text('consent_reference'), publishStatus: text('publish_status').default('draft').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [index('about_customer_stories_order_idx').on(t.sortOrder),
  check('about_story_consent_ck', sql`${t.consentStatus} IN ('missing','granted','revoked')`),
  check('about_story_publish_ck', sql`${t.publishStatus} IN ('draft','published')`)]);

export const aboutStoryAssets = pgTable('about_story_assets', {
  id: id(), ownerType: text('owner_type').notNull(), ownerKey: text('owner_key').notNull(),
  placement: text('placement').notNull(), storageKey: text('storage_key').notNull(),
  publicUrl: text('public_url').notNull(), mimeType: text('mime_type').notNull(), sizeBytes: integer('size_bytes').notNull(),
  width: integer('width').notNull(), height: integer('height').notNull(), altText: text('alt_text').notNull(),
  rightsStatus: text('rights_status').default('needs_review').notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, t => [uniqueIndex('about_story_asset_key_uq').on(t.storageKey),
  index('about_story_asset_owner_idx').on(t.ownerType, t.ownerKey),
  check('about_story_asset_owner_ck', sql`${t.ownerType} IN ('section','milestone','story')`),
  check('about_story_asset_placement_ck', sql`${t.placement} IN ('desktop','mobile','gallery')`),
  check('about_story_asset_rights_ck', sql`${t.rightsStatus} IN ('verified','needs_review')`),
  check('about_story_asset_size_ck', sql`${t.sizeBytes} > 0 AND ${t.width} > 0 AND ${t.height} > 0`)]);
