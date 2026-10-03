import 'dotenv/config';
import { readFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { seoMetadata } from '../schema/index.js';

const snapshot = JSON.parse(readFileSync(new URL('./seo-website.json', import.meta.url), 'utf8')) as typeof seoMetadata.$inferInsert[];
const aliases: Record<string, string> = { '/mua-xe': '/san-pham', '/danh-gia-khach-hang': '/cam-nhan', '/tin-tuc': '/bai-viet', '/cau-hoi-thuong-gap': '/cau-hoi' };
async function main() {
  if (!process.argv.includes('--apply')) { console.log(`Ready to import SEO for ${snapshot.length} public pages.`); return; }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle(pool);
    const old = await db.select().from(seoMetadata);
    const migrated = old.filter(row => aliases[row.routePath]).map(({ id, createdAt, updatedAt, routePath, ...row }) => {
      void id; void createdAt; void updatedAt;
      const next = aliases[routePath];
      return { ...row, routePath: next, canonicalUrl: row.canonicalUrl?.replace(new RegExp(`${routePath}(?=[?#]|$)`), next) || null };
    });
    await db.transaction(async tx => {
      if (migrated.length) await tx.insert(seoMetadata).values(migrated).onConflictDoNothing({ target: seoMetadata.routePath });
      const added = await tx.insert(seoMetadata).values(snapshot).onConflictDoNothing({ target: seoMetadata.routePath }).returning({ route: seoMetadata.routePath });
      console.log(`Imported ${added.length} missing SEO records. Existing admin edits were preserved.`);
    });
    // Allow previews of relative public OG images in admin.
    const workspace = fileURLToPath(new URL('../../../../', import.meta.url));
    const webRoot = resolve(workspace, 'web-xeluottoantrung/public');
    const adminRoot = resolve(workspace, 'admin-xeluottoantrung/public');
    for (const row of snapshot) {
      const image = row.ogImageUrl;
      if (!image?.startsWith('/') || image.startsWith('//')) continue;
      const source = resolve(webRoot, decodeURIComponent(image.slice(1))), target = resolve(adminRoot, decodeURIComponent(image.slice(1)));
      if (!source.startsWith(webRoot + sep) || !target.startsWith(adminRoot + sep)) throw new Error('Image path must stay in the public directory.');
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(source, target);
    }
  } finally { await pool.end(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
