import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

// Initialize only this new setting. Preserve saved replacements and deliberate removals.
async function main(): Promise<void> {
  const group = 'thiet-lap-text-len-doi', key = 'background-image';
  const snapshot = JSON.parse(readFileSync(new URL('./website-settings.json', import.meta.url), 'utf8')) as {
    settings: Record<string, Record<string, string>>;
  };
  const value = snapshot.settings[group][key];
  if (!value || !/^https:\/\//.test(value)) throw new Error('Default trade-in background is missing');
  if (!process.argv.includes('--apply')) {
    console.log('Ready to initialize the independent trade-in background. Existing settings will be preserved.');
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 8_000 });
  try {
    const result = await pool.query(
      `INSERT INTO site_settings ("group", "key", value, value_type, description)
       VALUES ($1, $2, $3, 'text', 'Ảnh nền phía sau biểu mẫu Lên đời; tự động làm mờ trên website.')
       ON CONFLICT ("group", "key") DO NOTHING RETURNING id`,
      [group, key, value],
    );
    console.log(result.rowCount ? 'Independent trade-in background initialized.' : 'Existing trade-in background preserved.');
  } finally { await pool.end(); }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Trade-in background initialization failed');
  process.exitCode = 1;
});
