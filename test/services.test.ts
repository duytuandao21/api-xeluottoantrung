import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';

test('admin service visibility controls public list and article detail', async () => {
  const pg = new PGlite();
  try {
    for (const migration of ['0000_wild_carmella_unuscione', '0001_unusual_nomad', '0002_lonely_vance_astro', '0003_wonderful_stone_men', '0004_ambitious_dark_phoenix', '0005_lazy_slyde', '0006_married_ghost_rider'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const collections = new CollectionsService({ db } as unknown as DatabaseService);
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'services' };
    const query = { page: 1, limit: 20 };
    const created = await collections.create('services', { title: 'Vận chuyển xe', description: '<p>Dịch vụ vận chuyển xe toàn quốc.</p>', status: 'active' }, audit);
    const id = String(created.id);
    assert.equal(created.slug, 'van-chuyen-xe');

    assert.equal((await collections.list('services', query, true)).meta.total, 1);
    assert.equal((await collections.detail('services', 'van-chuyen-xe', true, true)).title, 'Vận chuyển xe');
    assert.equal((await collections.detail('services', id, true)).title, 'Vận chuyển xe');

    const duplicate = await collections.create('services', { title: 'Vận chuyển xe', description: '<p>Dịch vụ thứ hai.</p>', status: 'inactive' }, audit);
    assert.equal(duplicate.slug, 'van-chuyen-xe-2');

    await collections.update('services', id, { status: 'inactive' }, audit);
    assert.equal((await collections.list('services', query, true)).meta.total, 0);
    await assert.rejects(() => collections.detail('services', 'van-chuyen-xe', true, true));
    assert.equal((await collections.list('services', query, false)).meta.total, 2);

    await collections.update('services', id, { status: 'active' }, audit);
    assert.equal((await collections.list('services', query, true)).meta.total, 1);
    assert.equal((await collections.detail('services', 'van-chuyen-xe', true, true)).description, '<p>Dịch vụ vận chuyển xe toàn quốc.</p>');
    const renamed = await collections.update('services', id, { title: 'Dịch vụ vận chuyển xe' }, audit);
    assert.equal(renamed.slug, 'dich-vu-van-chuyen-xe');
    await assert.rejects(() => collections.detail('services', 'van-chuyen-xe', true, true));
    assert.equal((await collections.detail('services', 'dich-vu-van-chuyen-xe', true, true)).title, 'Dịch vụ vận chuyển xe');
  } finally { await pg.close(); }
});

test('migration gives existing Vietnamese services distinct readable slugs', async () => {
  const pg = new PGlite();
  try {
    for (const migration of ['0000_wild_carmella_unuscione', '0001_unusual_nomad', '0002_lonely_vance_astro', '0003_wonderful_stone_men', '0004_ambitious_dark_phoenix'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    await pg.query(`INSERT INTO services (title, description) VALUES ('Vận chuyển nhanh', 'Bài thứ nhất'), ('Vận chuyển nhanh', 'Bài thứ hai'), ('Bảo hiểm ô tô', 'Bài thứ ba')`);
    for (const migration of ['0005_lazy_slyde', '0006_married_ghost_rider'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const result = await pg.query<{ slug: string }>('SELECT slug FROM services ORDER BY slug');
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows.some(row => row.slug === 'bao-hiem-o-to'), true);
    assert.equal(result.rows.filter(row => row.slug.startsWith('van-chuyen-nhanh-')).length, 2);
    assert.equal(new Set(result.rows.map(row => row.slug)).size, 3);
  } finally { await pg.close(); }
});
