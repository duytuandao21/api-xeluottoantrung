import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { recruitments } from '../schema/index.js';

// Import the existing website article once; reruns preserve admin edits and visibility.
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const article = JSON.parse(readFileSync(new URL('./recruitment-article.json', import.meta.url), 'utf8')) as typeof recruitments.$inferInsert;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const added = await drizzle(pool).insert(recruitments).values(article).onConflictDoNothing({ target: recruitments.slug }).returning({ id: recruitments.id });
    console.log(`Imported ${added.length} recruitment article; existing admin records were preserved.`);
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
