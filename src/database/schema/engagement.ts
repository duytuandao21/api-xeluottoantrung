import { index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';
import { profiles } from './auth.js';
import { cars } from './cars.js';

export const leadType = pgEnum('lead_type', ['sell', 'trade_in', 'callback', 'finance']);
export const leadStatus = pgEnum('lead_status', ['unread', 'read', 'replied']);

export const leads = pgTable('leads', {
  id: id(), type: leadType('type').notNull(), status: leadStatus('status').default('unread').notNull(),
  name: text('name'), phone: text('phone').notNull(), email: text('email'), content: text('content'),
  carId: uuid('car_id').references(() => cars.id, { onDelete: 'set null' }),
  carName: text('car_name'), currentCar: text('current_car'), desiredCar: text('desired_car'),
  offeredBrand: text('offered_brand'), offeredModel: text('offered_model'), offeredVersion: text('offered_version'),
  offeredYear: text('offered_year'), offeredMileage: text('offered_mileage'),
  financeAmount: text('finance_amount'), financeTerm: text('finance_term'),
  handledBy: uuid('handled_by').references(() => profiles.id), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [index('leads_type_status_created_idx').on(t.type, t.status, t.createdAt), index('leads_car_idx').on(t.carId)]);

export const newsletterSubscribers = pgTable('newsletter_subscribers', {
  id: id(), email: text('email').notNull(), status: text('status').default('active').notNull(),
  source: text('source'), createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('newsletter_subscribers_email_uq').on(t.email)]);

export const auditLogs = pgTable('audit_logs', {
  id: id(), actorProfileId: uuid('actor_profile_id').references(() => profiles.id, { onDelete: 'set null' }),
  action: text('action').notNull(), entityType: text('entity_type').notNull(), entityId: uuid('entity_id'),
  oldData: jsonb('old_data'), newData: jsonb('new_data'), ipAddress: text('ip_address'),
  userAgent: text('user_agent'), requestId: text('request_id'), createdAt: createdAt(),
}, (t) => [index('audit_logs_entity_created_idx').on(t.entityType, t.entityId, t.createdAt), index('audit_logs_actor_created_idx').on(t.actorProfileId, t.createdAt)]);
