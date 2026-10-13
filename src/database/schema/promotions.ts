import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';

export const promotions = pgTable('promotions', {
  id: id(), title: text('title').notNull(), kind: text('kind').default('promotion').notNull(),
  imageUrl: text('image_url').notNull(), content: text('content').default('').notNull(),
  startsAt: date('starts_at', { mode: 'string' }).notNull(),
  endsAt: date('ends_at', { mode: 'string' }).notNull(),
  isPublished: boolean('is_published').default(true).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, table => [
  index('promotions_public_dates_idx').on(table.isPublished, table.startsAt, table.endsAt).where(sql`${table.deletedAt} IS NULL`),
  check('promotions_date_order', sql`${table.endsAt} >= ${table.startsAt}`),
  check('promotions_kind', sql`${table.kind} IN ('promotion','event')`),
  check('promotions_title', sql`length(trim(${table.title})) BETWEEN 1 AND 240`),
]);

// One pointer, rather than independent flags, makes choosing two ads impossible.
export const promotionPopup = pgTable('promotion_popup', {
  id: integer('id').primaryKey().default(1),
  promotionId: uuid('promotion_id').references(() => promotions.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
}, table => [check('promotion_popup_singleton', sql`${table.id} = 1`)]);
