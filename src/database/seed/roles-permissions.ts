import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { permissions, rolePermissions, roles } from '../schema/index.js';
import { VALUATION_PERMISSIONS } from '../../modules/valuation/domain.js';

const roleNames: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', CONTENT_EDITOR: 'Content Editor',
  INVENTORY_MANAGER: 'Inventory Manager', SALES: 'Sales', SEO_MANAGER: 'SEO Manager',
};

const resourceActions: Record<string, string[]> = {
  car: ['read', 'create', 'update', 'delete', 'publish'],
  brand: ['read', 'create', 'update', 'delete'],
  model: ['read', 'create', 'update', 'delete'],
  version: ['read', 'create', 'update', 'delete'],
  body_style: ['read', 'create', 'update', 'delete'],
  transmission: ['read', 'create', 'update', 'delete'],
  color: ['read', 'create', 'update', 'delete'],
  region: ['read', 'create', 'update', 'delete'],
  filter: ['read', 'create', 'update', 'delete'],
  media: ['read', 'create', 'update', 'delete'],
  branch: ['read', 'create', 'update', 'delete'],
  content: ['read', 'create', 'update', 'delete', 'publish'],
  seo: ['read', 'update'],
  lead: ['read', 'update', 'delete'],
  customer: ['read', 'create', 'update', 'delete'],
  user: ['read', 'create', 'update', 'delete', 'assign_role'],
  audit: ['read'],
  dashboard: ['read'],
  auspicious_date: ['read', 'settings.update', 'rules.read', 'rules.update', 'content.update', 'sources.manage', 'versions.manage', 'publish', 'simulate', 'audit.read'],
};

const permissionCodes = [...Object.entries(resourceActions).flatMap(([resource, actions]) => actions.map((action) => `${resource}.${action}`)), ...VALUATION_PERMISSIONS];
const assigned: Record<string, string[]> = {
  ADMIN: permissionCodes.filter((code) => !code.startsWith('user.assign_role')),
  CONTENT_EDITOR: permissionCodes.filter((code) => code.startsWith('content.') ||
    ['media.read', 'media.create', 'media.update', 'dashboard.read', 'auspicious_date.read', 'auspicious_date.rules.read', 'auspicious_date.content.update'].includes(code)),
  INVENTORY_MANAGER: permissionCodes.filter((code) => ['car.', 'brand.', 'model.', 'version.', 'body_style.', 'transmission.',
    'color.', 'region.', 'filter.', 'media.', 'branch.', 'dashboard.'].some((prefix) => code.startsWith(prefix))),
  SALES: ['car.read', 'brand.read', 'model.read', 'version.read', 'lead.read', 'lead.update', 'customer.read', 'dashboard.read', 'valuation.read', 'valuation.history.read', 'valuation.history.update'],
  SEO_MANAGER: ['content.read', 'seo.read', 'seo.update', 'car.read', 'dashboard.read'],
  SUPER_ADMIN: permissionCodes,
};

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for seed');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = drizzle(pool);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(roles).values(Object.entries(roleNames).map(([code, name]) => ({ code, name }))).onConflictDoNothing({ target: roles.code });
      await tx.insert(permissions).values(permissionCodes.map((code) => ({ code }))).onConflictDoNothing({ target: permissions.code });
      const allRoles = await tx.select().from(roles);
      const allPermissions = await tx.select().from(permissions);
      const roleByCode = new Map(allRoles.map((role) => [role.code, role.id]));
      const permissionByCode = new Map(allPermissions.map((permission) => [permission.code, permission.id]));
      const links = Object.entries(assigned).flatMap(([roleCode, codes]) => codes.map((code) => {
        const roleId = roleByCode.get(roleCode);
        const permissionId = permissionByCode.get(code);
        if (!roleId || !permissionId) throw new Error(`Missing seed reference: ${roleCode} / ${code}`);
        return { roleId, permissionId };
      }));
      await tx.insert(rolePermissions).values(links).onConflictDoNothing({ target: [rolePermissions.roleId, rolePermissions.permissionId] });
    });
    console.log(`Seeded ${Object.keys(roleNames).length} roles and ${permissionCodes.length} permissions`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
