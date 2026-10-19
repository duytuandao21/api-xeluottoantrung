import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';

const args = new Set(process.argv.slice(2));
if ([...args].some(arg => !['--apply', '--api-offline', '--rollback'].includes(arg))) {
  console.error('Usage: node scripts/place-imported-car-115.mjs [--rollback] [--apply --api-offline]');
  process.exit(1);
}
if (args.has('--apply') && !args.has('--api-offline')) {
  console.error('Stop the API first, then use --apply --api-offline. Restart it afterwards to clear its process cache.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required in the API environment.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
let client;
try {
  client = await pool.connect();
  const { rows } = await client.query(`SELECT id,name,created_at,listing_order_at FROM cars
    WHERE id IN ('1763061e-1a16-49c7-8864-0b95f24dcc3b','cf0b8914-8d73-4926-a175-cbd00909acdf','c8e62fba-60ad-4b95-b9e9-f790c16a3152')
    ORDER BY coalesce(listing_order_at,created_at) DESC,id ASC`);
  if (rows.length !== 3) throw new Error('Expected exactly the three imported cars; check the database before applying.');
  console.log(JSON.stringify({ mode: args.has('--apply') ? 'apply' : 'read-only preview', rollback: args.has('--rollback'), cars: rows }, null, 2));
  if (args.has('--apply')) {
    const filename = args.has('--rollback') ? 'rollback-imported-car-115.sql' : 'place-imported-car-115.sql';
    await client.query(await readFile(new URL(filename, import.meta.url), 'utf8'));
    console.log(JSON.stringify({ applied: true, rollback: args.has('--rollback'), restartApiRequired: true }));
  }
} catch (error) {
  if (client) await client.query('ROLLBACK').catch(() => {});
  // Never print the connection string, password or an error object with connection options.
  console.error(error.code ? `Operation failed (SQLSTATE/network code ${error.code}); no placement was committed on failure.` : error.message);
  process.exitCode = 1;
} finally {
  client?.release(); await pool.end();
}
