import { index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';

export const bodyStyles = pgTable('body_styles', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull(), imageUrl: text('image_url'),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('body_styles_slug_uq').on(t.slug)]);

export const brands = pgTable('brands', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull(), imageUrl: text('image_url'),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('brands_slug_uq').on(t.slug)]);

export const carModels = pgTable('car_models', {
  id: id(), brandId: uuid('brand_id').notNull().references(() => brands.id),
  bodyStyleId: uuid('body_style_id').references(() => bodyStyles.id), name: text('name').notNull(),
  slug: text('slug').notNull(), imageUrl: text('image_url'), sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('active').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('car_models_brand_slug_uq').on(t.brandId, t.slug), index('car_models_body_style_idx').on(t.bodyStyleId)]);

export const carVersions = pgTable('car_versions', {
  id: id(), modelId: uuid('model_id').notNull().references(() => carModels.id), name: text('name').notNull(),
  slug: text('slug').notNull(), imageUrl: text('image_url'), sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('active').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('car_versions_model_slug_uq').on(t.modelId, t.slug)]);

export const branchRegions = pgTable('branch_regions', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('branch_regions_slug_uq').on(t.slug)]);

export const branches = pgTable('branches', {
  id: id(), regionId: uuid('region_id').references(() => branchRegions.id), name: text('name').notNull(),
  slug: text('slug').notNull(), address: text('address').notNull(), phone: text('phone').notNull(),
  mapUrl: text('map_url'), imageUrl: text('image_url'), sortOrder: integer('sort_order').default(0).notNull(),
  status: text('status').default('active').notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('branches_slug_uq').on(t.slug), index('branches_region_idx').on(t.regionId)]);

export const carColors = pgTable('car_colors', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull(), colorCode: text('color_code'),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('car_colors_slug_uq').on(t.slug)]);

export const transmissions = pgTable('transmissions', {
  id: id(), name: text('name').notNull(), slug: text('slug').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('transmissions_slug_uq').on(t.slug)]);

// UI-managed filter chips/ranges: year, budget, mileage, plate type, condition, year suggestion.
export const filterOptions = pgTable('filter_options', {
  id: id(), group: text('group').notNull(), name: text('name').notNull(), slug: text('slug').notNull(),
  minValue: integer('min_value'), maxValue: integer('max_value'),
  sortOrder: integer('sort_order').default(0).notNull(), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('filter_options_group_slug_uq').on(t.group, t.slug)]);
