import 'dotenv/config';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { contentEntries, siteSettings } from '../schema/index.js';

// Content and assets captured from the working public website on 01/10/2026.
// This import never overwrites subsequent edits made in admin.
const snapshot = JSON.parse(readFileSync(new URL('./website-settings.json', import.meta.url), 'utf8')) as {
  settings: Record<string, Record<string, string>>;
  entries: Record<string, { key: string; title: string; imageUrl: string; link: string; sortOrder: number }[]>;
};

async function main() {
  const settings = Object.entries(snapshot.settings).flatMap(([group, values]) => Object.entries(values).map(([key, value]) => ({ group, key, value, valueType: 'text' })));
  const entries = Object.entries(snapshot.entries).flatMap(([group, values]) => values.map(value => ({ ...value, group, status: 'active' })));
  if (!process.argv.includes('--apply')) { console.log(`Ready to import ${settings.length} settings and ${entries.length} content entries.`); return; }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

  // Keep relative website assets previewable from the admin origin as well.
  const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
  const webRoot = resolve(workspace, 'web-xeluottoantrung/public');
  const adminRoot = resolve(workspace, 'admin-xeluottoantrung/public');
  const images = new Set([...settings.filter(row => /^(logo|logoDark|logoMobile|favicon|image)$/.test(row.key)).map(row => row.value), ...entries.map(row => row.imageUrl)]);
  for (const image of images) {
    if (!image.startsWith('/') || image.startsWith('//')) continue;
    const relative = decodeURIComponent(image.slice(1));
    const source = resolve(webRoot, relative), target = resolve(adminRoot, relative);
    if (!source.startsWith(webRoot + sep) || !target.startsWith(adminRoot + sep)) throw new Error('Asset path must stay inside public directories.');
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool);
    await db.transaction(async tx => {
      const saved = await tx.insert(siteSettings).values(settings).onConflictDoNothing({ target: [siteSettings.group, siteSettings.key] }).returning({ id: siteSettings.id });
      const added = await tx.insert(contentEntries).values(entries).onConflictDoNothing({ target: [contentEntries.group, contentEntries.key] }).returning({ id: contentEntries.id });
      console.log(`Imported ${saved.length} settings and ${added.length} entries. Existing admin edits were preserved.`);
    });
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
