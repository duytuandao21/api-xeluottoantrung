import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { bodyStyles, brands, branches, carColors, carModels, carVersions, transmissions } from './catalog.js';

export const carStatus = pgEnum('car_status', ['active', 'deposit', 'sold', 'inactive']);
export const carMediaType = pgEnum('car_media_type', ['image', 'video']);

export const cars = pgTable('cars', {
  id: id(), legacyId: text('legacy_id'), sku: text('sku'), slug: text('slug').notNull(),
  name: text('name').notNull(), brandId: uuid('brand_id').notNull().references(() => brands.id),
  modelId: uuid('model_id').notNull().references(() => carModels.id),
  versionId: uuid('version_id').references(() => carVersions.id),
  bodyStyleId: uuid('body_style_id').references(() => bodyStyles.id),
  branchId: uuid('branch_id').references(() => branches.id),
  year: integer('year').notNull(), price: bigint('price', { mode: 'number' }).notNull(),
  originalPrice: bigint('original_price', { mode: 'number' }), mileage: integer('mileage'),
  transmissionId: uuid('transmission_id').references(() => transmissions.id),
  fuel: text('fuel'), colorId: uuid('color_id').references(() => carColors.id),
  licensePlate: text('license_plate'), condition: text('condition'), seatCount: integer('seat_count'),
  description: text('description'), status: carStatus('status').default('inactive').notNull(),
  featured: boolean('featured').default(false).notNull(), installment: boolean('installment').default(false).notNull(),
  newArrival: boolean('new_arrival').default(false).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  sourceUrl: text('source_url'), sourceKind: text('source_kind'),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('cars_slug_uq').on(t.slug), uniqueIndex('cars_legacy_id_uq').on(t.legacyId),
  uniqueIndex('cars_sku_uq').on(t.sku), uniqueIndex('cars_source_url_uq').on(t.sourceUrl),
  index('cars_status_created_idx').on(t.status, t.createdAt),
  index('cars_brand_status_idx').on(t.brandId, t.status),
  index('cars_model_idx').on(t.modelId), index('cars_version_idx').on(t.versionId),
  index('cars_body_style_idx').on(t.bodyStyleId), index('cars_branch_idx').on(t.branchId),
  index('cars_price_idx').on(t.price), index('cars_year_idx').on(t.year),
  check('cars_year_valid', sql`${t.year} BETWEEN 1886 AND 2100`),
  check('cars_price_nonnegative', sql`${t.price} >= 0`),
  check('cars_mileage_nonnegative', sql`${t.mileage} IS NULL OR ${t.mileage} >= 0`),
  check('cars_seats_positive', sql`${t.seatCount} IS NULL OR ${t.seatCount} > 0`),
]);

export const carMedia = pgTable('car_media', {
  id: id(), carId: uuid('car_id').notNull().references(() => cars.id, { onDelete: 'cascade' }),
  type: carMediaType('type').default('image').notNull(), storageKey: text('storage_key'),
  publicUrl: text('public_url').notNull(), altText: text('alt_text'),
  sortOrder: integer('sort_order').default(0).notNull(), isCover: boolean('is_cover').default(false).notNull(),
  width: integer('width'), height: integer('height'), sizeBytes: bigint('size_bytes', { mode: 'number' }),
  mimeType: text('mime_type'), createdAt: createdAt(),
  deletionPendingAt: timestamp('deletion_pending_at', { withTimezone: true }),
}, (t) => [
  index('car_media_car_order_idx').on(t.carId, t.sortOrder),
  uniqueIndex('car_media_storage_key_uq').on(t.storageKey),
  uniqueIndex('car_media_one_cover_uq').on(t.carId).where(sql`${t.isCover} = true`),
  check('car_media_size_nonnegative', sql`${t.sizeBytes} IS NULL OR ${t.sizeBytes} >= 0`),
]);

// Legacy details show additional named specifications beyond admin Product fields.
export const carSpecifications = pgTable('car_specifications', {
  id: id(), carId: uuid('car_id').notNull().references(() => cars.id, { onDelete: 'cascade' }),
  key: text('key').notNull(), label: text('label').notNull(), value: text('value').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(), createdAt: createdAt(),
}, (t) => [uniqueIndex('car_specifications_car_key_uq').on(t.carId, t.key)]);
