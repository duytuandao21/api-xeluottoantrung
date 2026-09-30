import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { profiles } from './auth.js';

export const articleCategories = pgTable('article_categories', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('article_categories_slug_uq').on(t.slug)]);

export const articles = pgTable('articles', {
  id: id(), legacyId: text('legacy_id'), title: text('title').notNull(), slug: text('slug').notNull(),
  categoryId: uuid('category_id').references(() => articleCategories.id),
  excerpt: text('excerpt'), content: text('content').notNull(), imageUrl: text('image_url'),
  authorId: uuid('author_id').references(() => profiles.id), authorName: text('author_name'),
  featured: boolean('featured').default(false).notNull(), status: text('status').default('draft').notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [uniqueIndex('articles_slug_uq').on(t.slug), uniqueIndex('articles_legacy_id_uq').on(t.legacyId), index('articles_status_published_idx').on(t.status, t.publishedAt)]);

export const pages = pgTable('pages', {
  id: id(), path: text('path').notNull(), title: text('title').notNull(), body: text('body'),
  status: text('status').default('draft').notNull(), publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [uniqueIndex('pages_path_uq').on(t.path)]);

export const faqs = pgTable('faqs', {
  id: id(), question: text('question').notNull(), answer: text('answer').notNull(),
  featured: boolean('featured').default(false).notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('active').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index('faqs_status_order_idx').on(t.status, t.sortOrder)]);

export const testimonials = pgTable('testimonials', {
  id: id(), name: text('name').notNull(), content: text('content').notNull(),
  rating: integer('rating').notNull(), avatarUrl: text('avatar_url'), carBought: text('car_bought'),
  purchaseDate: date('purchase_date'),
  featured: boolean('featured').default(false).notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('active').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index('testimonials_status_order_idx').on(t.status, t.sortOrder), check('testimonials_rating_range', sql`${t.rating} BETWEEN 1 AND 5`)]);

export const services = pgTable('services', {
  id: id(), title: text('title').notNull(), slug: text('slug').notNull(), description: text('description').notNull(),
  imageUrl: text('image_url'), icon: text('icon'), sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('active').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('services_slug_uq').on(t.slug)]);

export const recruitments = pgTable('recruitments', {
  id: id(), title: text('title').notNull(), imageUrl: text('image_url'), description: text('description').notNull(),
  requirements: text('requirements').notNull(), salary: text('salary'), location: text('location').notNull(),
  deadline: timestamp('deadline', { withTimezone: true }), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
});

export const slides = pgTable('slides', {
  id: id(), title: text('title').notNull(), imageUrl: text('image_url').notNull(), link: text('link'),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index('slides_status_order_idx').on(t.status, t.sortOrder)]);

export const accessoryBrands = pgTable('accessory_brands', {
  id: id(), name: text('name').notNull(), imageUrl: text('image_url'),
  status: text('status').default('active').notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('accessory_brands_name_uq').on(sql`lower(btrim(${t.name}))`), index('accessory_brands_status_order_idx').on(t.status, t.sortOrder)]);

export const accessoryCategories = pgTable('accessory_categories', {
  id: id(), name: text('name').notNull(),
  status: text('status').default('active').notNull(), sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('accessory_categories_name_uq').on(sql`lower(btrim(${t.name}))`), index('accessory_categories_status_order_idx').on(t.status, t.sortOrder)]);

export const accessories = pgTable('accessories', {
  id: id(), name: text('name').notNull(), brand: text('brand').notNull(),
  brandId: uuid('brand_id').references(() => accessoryBrands.id),
  categoryId: uuid('category_id').references(() => accessoryCategories.id),
  price: bigint('price', { mode: 'number' }).notNull(),
  imageUrl: text('image_url').notNull(), imageUrls: text('image_urls').array().default(sql`'{}'::text[]`).notNull(),
  description: text('description'), status: text('status').default('active').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index('accessories_status_order_idx').on(t.status, t.sortOrder), index('accessories_brand_idx').on(t.brandId), index('accessories_category_idx').on(t.categoryId)]);

// Ordered admin-managed blocks: introduction, steps, social links, call buttons, banners, colors excluded.
export const contentEntries = pgTable('content_entries', {
  id: id(), group: text('group').notNull(), key: text('key').notNull(), title: text('title').notNull(),
  body: text('body'), imageUrl: text('image_url'), link: text('link'), phone: text('phone'),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  updatedBy: uuid('updated_by').references(() => profiles.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('content_entries_group_key_uq').on(t.group, t.key), index('content_entries_group_order_idx').on(t.group, t.sortOrder)]);

export const siteSettings = pgTable('site_settings', {
  id: id(), group: text('group').notNull(), key: text('key').notNull(),
  value: text('value'), valueType: text('value_type').default('text').notNull(),
  description: text('description'), updatedBy: uuid('updated_by').references(() => profiles.id),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('site_settings_group_key_uq').on(t.group, t.key)]);

// Route is the stable public URL; entity association can be resolved through route/slug.
export const seoMetadata = pgTable('seo_metadata', {
  id: id(), routePath: text('route_path').notNull(), metaTitle: text('meta_title'),
  metaDescription: text('meta_description'), keywords: text('keywords'),
  ogTitle: text('og_title'), ogDescription: text('og_description'), ogImageUrl: text('og_image_url'),
  canonicalUrl: text('canonical_url'), robotsIndex: boolean('robots_index').default(true).notNull(),
  robotsFollow: boolean('robots_follow').default(true).notNull(), structuredData: jsonb('structured_data'),
  updatedBy: uuid('updated_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('seo_metadata_route_path_uq').on(t.routePath)]);
