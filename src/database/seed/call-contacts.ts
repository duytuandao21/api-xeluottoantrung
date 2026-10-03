import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { contentEntries } from '../schema/index.js';

// Snapshot of the website's existing call menu, preserving contact details and order.
const contacts = JSON.parse(readFileSync(new URL('./call-contacts.json', import.meta.url), 'utf8')) as {
  key: string; title: string; body: string; phone: string; sortOrder: number;
}[];
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const db = drizzle(pool);
  try {
    const existing = await db.select().from(contentEntries).where(eq(contentEntries.group, 'thiet-lap-nut-goi'));
    console.log('Existing contacts:', JSON.stringify(existing.map(({ key, title, body, phone, status }) => ({ key, title, body, phone, status }))));
    if (!process.argv.includes('--apply')) return;
    const added = await db.insert(contentEntries).values(contacts.map(contact => ({
      ...contact, group: 'thiet-lap-nut-goi', status: 'active',
    }))).onConflictDoNothing({ target: [contentEntries.group, contentEntries.key] }).returning({ key: contentEntries.key });
    console.log(`Imported ${added.length} contacts; existing admin records were preserved.`);
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
