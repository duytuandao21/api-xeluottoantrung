import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const formSubmissions = pgTable('form_submissions', {
  id: uuid('id').primaryKey(),
  form: text('form').notNull(),
  payloadHash: text('payload_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('form_submissions_expires_idx').on(table.expiresAt)]);

export const formDedupe = pgTable('form_dedupe', {
  fingerprint: text('fingerprint').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, table => [index('form_dedupe_expires_idx').on(table.expiresAt)]);

export const formRateEvents = pgTable('form_rate_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  bucket: text('bucket').notNull(),
  ipHash: text('ip_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [index('form_rate_events_lookup_idx').on(table.bucket, table.ipHash, table.createdAt)]);
