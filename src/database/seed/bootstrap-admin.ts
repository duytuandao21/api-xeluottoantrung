import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { profiles, roles, userRoles } from '../schema/index.js';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main(): Promise<void> {
  const [authUserId, fullName] = process.argv.slice(2);
  if (!authUserId || !USER_ID.test(authUserId) || !fullName?.trim()) throw new Error('Usage: npm run admin:bootstrap -- <auth-user-uuid> "Full Name"');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const db = drizzle(pool);
  try {
    const authUser = await pool.query<{ id: string; email: string | null }>('SELECT id, email FROM auth.users WHERE id = $1', [authUserId]);
    if (authUser.rowCount !== 1) throw new Error('Supabase Auth user not found');
    await db.transaction(async (tx) => {
      const [superAdmin] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, 'SUPER_ADMIN'));
      if (!superAdmin) throw new Error('SUPER_ADMIN role is missing; run npm run db:seed first');
      await tx.insert(profiles).values({ authUserId, fullName: fullName.trim(), email: authUser.rows[0].email }).onConflictDoNothing({ target: profiles.authUserId });
      const [profile] = await tx.select({ id: profiles.id, status: profiles.status, deletedAt: profiles.deletedAt }).from(profiles).where(eq(profiles.authUserId, authUserId));
      if (!profile || profile.status !== 'active' || profile.deletedAt) throw new Error('Admin profile exists but is inactive or deleted');
      await tx.insert(userRoles).values({ profileId: profile.id, roleId: superAdmin.id }).onConflictDoNothing({ target: [userRoles.profileId, userRoles.roleId] });
    });
    console.log('SUPER_ADMIN profile linked to the Supabase Auth user');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Bootstrap failed'); process.exitCode = 1; });
