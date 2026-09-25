import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './common.js';

// auth_user_id is the UUID owned by Supabase auth.users. Authentication lifecycle stays in Supabase.
export const profiles = pgTable('profiles', {
  id: id(), authUserId: uuid('auth_user_id').notNull(), fullName: text('full_name').notNull(),
  email: text('email'), phone: text('phone'), status: text('status').default('active').notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(), deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [uniqueIndex('profiles_auth_user_id_uq').on(t.authUserId)]);

export const roles = pgTable('roles', {
  id: id(), code: text('code').notNull(), name: text('name').notNull(), description: text('description'),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (t) => [uniqueIndex('roles_code_uq').on(t.code)]);

export const permissions = pgTable('permissions', {
  id: id(), code: text('code').notNull(), description: text('description'), createdAt: createdAt(),
}, (t) => [uniqueIndex('permissions_code_uq').on(t.code)]);

export const userRoles = pgTable('user_roles', {
  id: id(), profileId: uuid('profile_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('user_roles_pair_uq').on(t.profileId, t.roleId), index('user_roles_role_idx').on(t.roleId)]);

export const rolePermissions = pgTable('role_permissions', {
  id: id(), roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('role_permissions_pair_uq').on(t.roleId, t.permissionId), index('role_permissions_permission_idx').on(t.permissionId)]);

export const customers = pgTable('customers', {
  id: id(), authUserId: uuid('auth_user_id'), name: text('name').notNull(), email: text('email').notNull(),
  phone: text('phone').notNull(), address: text('address'), status: text('status').default('active').notNull(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }), createdAt: createdAt(), updatedAt: updatedAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (t) => [uniqueIndex('customers_auth_user_id_uq').on(t.authUserId), index('customers_email_idx').on(t.email)]);
