import 'dotenv/config';
import { Pool } from 'pg';

const authUserId = process.argv[2];
if (!authUserId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authUserId)) {
  throw new Error('Usage: npm run admin:check-user -- <auth-user-uuid>');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const result = await pool.query<{ found: boolean }>('SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = $1) AS found', [authUserId]);
  console.log(result.rows[0].found ? 'AUTH_USER_EXISTS' : 'AUTH_USER_NOT_FOUND');
  if (result.rows[0].found) {
    const access = await pool.query<{ status: string; active: boolean; roles: string[]; permission_count: number }>(`
      SELECT p.status, p.deleted_at IS NULL AS active,
        array_remove(array_agg(DISTINCT r.code), NULL) AS roles,
        COUNT(DISTINCT perm.code)::int AS permission_count
      FROM profiles p
      LEFT JOIN user_roles ur ON ur.profile_id = p.id
      LEFT JOIN roles r ON r.id = ur.role_id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      LEFT JOIN permissions perm ON perm.id = rp.permission_id
      WHERE p.auth_user_id = $1
      GROUP BY p.id
    `, [authUserId]);
    if (access.rowCount === 0) console.log('ADMIN_PROFILE_MISSING');
    else {
      const row = access.rows[0];
      console.log(`PROFILE_STATUS=${row.status} NOT_DELETED=${row.active} ROLES=${row.roles.join(',')} PERMISSION_COUNT=${row.permission_count}`);
    }
  }
} finally {
  await pool.end();
}
