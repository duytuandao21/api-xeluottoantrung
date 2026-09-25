import 'dotenv/config';
import { Pool } from 'pg';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is missing');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000 });
  try {
    await pool.query('SELECT 1');
    console.log('DATABASE_OK');
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN';
    const syscall = error && typeof error === 'object' && 'syscall' in error ? String(error.syscall) : 'none';
    throw new Error(`DATABASE_CONNECTION_FAILED (${code}; syscall=${syscall})`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'DATABASE_CONNECTION_FAILED'); process.exitCode = 1; });
