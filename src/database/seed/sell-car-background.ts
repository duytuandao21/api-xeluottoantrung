import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

// Start with the current trade-in background, then manage selling independently.
// Existing replacements and deliberate removals are never overwritten.
async function main(): Promise<void> {
  const group = 'thiet-lap-text-ban-xe', key = 'background-image';
  const snapshot = JSON.parse(readFileSync(new URL('./website-settings.json', import.meta.url), 'utf8')) as {
    settings: Record<string, Record<string, string>>;
  };
  const value = snapshot.settings[group][key];
  if (!value || !/^https:\/\//.test(value)) throw new Error('Default selling background is missing');
  if (!process.argv.includes('--apply')) {
    console.log('Ready to initialize the independent selling background. Existing settings will be preserved.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8_000 });
  try {
    const result = await pool.query(
      `INSERT INTO site_settings ("group", "key", value, value_type, description)
       VALUES ($1, $2, COALESCE(NULLIF((SELECT value FROM site_settings
         WHERE "group" = 'thiet-lap-text-len-doi' AND "key" = $2), ''), $3), 'text', $4)
       ON CONFLICT ("group", "key") DO NOTHING RETURNING id`,
      [group, key, value, 'Ảnh nền phía sau biểu mẫu Bán xe; tự động làm mờ trên website.'],
    );
    console.log(result.rowCount ? 'Independent selling background initialized.' : 'Existing selling background preserved.');
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Selling background initialization failed');
  process.exitCode = 1;
});
