import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';
import { PublicCollectionsController } from '../src/modules/content/collections.controller.js';
import { SearchService } from '../src/modules/search/search.service.js';

test('accessory slug migration preserves data/SEO and supports legacy writers, stable URLs and public visibility', async () => {
  const pg = new PGlite();
  let app: NestFastifyApplication | undefined;
  try {
    for (const tag of ['0000_wild_carmella_unuscione', '0001_unusual_nomad', '0002_lonely_vance_astro', '0003_wonderful_stone_men', '0004_ambitious_dark_phoenix'])
      await pg.exec(await readFile(`drizzle/${tag}.sql`, 'utf8'));
    const names = ['Camera hành trình 70mai', 'Camera hành trình 70mai', 'Camera hành trình 70mai-2',
      'ĐÈN ĐỎ', 'Đèn đỏ', '###', '00000000-0000-4000-8000-000000000007', 'A'.repeat(400), '   '];
    const ids = names.map((_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    for (const [i, name] of names.entries()) await pg.query(`INSERT INTO accessories
      (id, name, brand, price, image_url, image_urls, status, created_at) VALUES ($1,$2,'Legacy',123456,'https://fixture.test/cover.jpg',ARRAY['https://fixture.test/side.jpg'],$3,$4)`,
      [ids[i], name, i === 1 ? 'inactive' : 'active', `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`]);
    const oldRoute = `/phu-kien-o-to/${ids[0]}`;
    const oldCanonical = `https://xeluottoantrung.com${oldRoute}`;
    const meta = (await pg.query<{ id: string }>(`INSERT INTO seo_metadata (route_path, meta_title, canonical_url, robots_index, structured_data)
      VALUES ($1,'SEO cũ được giữ',$2,false,'{"custom":true}') RETURNING id`, [oldRoute, oldCanonical])).rows[0];
    await pg.query(`INSERT INTO seo_metadata (route_path, meta_title, canonical_url) VALUES ($1,'External','https://external.test/custom'),($2,'Old retained',NULL),($3,'New wins',NULL)`,
      [`/phu-kien-o-to/${ids[1]}`, `/phu-kien-o-to/${ids[2]}`, '/phu-kien-o-to/camera-hanh-trinh-70mai-2-2']);
    await pg.query('INSERT INTO seo_metadata (route_path,canonical_url) VALUES ($1,$2)', [`/phu-kien-o-to/${ids[4]}`, `https://external.test/phu-kien-o-to/${ids[4]}`]);
    const before = (await pg.query('SELECT * FROM accessories ORDER BY id')).rows;
    const migration = await readFile('drizzle/0023_accessory_slugs.sql', 'utf8');
    await pg.exec(`BEGIN; ${migration} COMMIT;`);
    const after = (await pg.query<Record<string, unknown>>('SELECT * FROM accessories ORDER BY id')).rows;
    assert.deepEqual(after.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'slug'))), before, 'Only the slug is added; prices, images, states and timestamps remain intact');
    assert.deepEqual(after.map(row => row.slug), ['camera-hanh-trinh-70mai', 'camera-hanh-trinh-70mai-2', 'camera-hanh-trinh-70mai-2-2',
      'den-do', 'den-do-2', 'phu-kien', `phu-kien-${ids[6]}`, 'a'.repeat(80), 'phu-kien-2']);
    const migratedSeo = (await pg.query<Record<string, unknown>>('SELECT * FROM seo_metadata WHERE id=$1', [meta.id])).rows[0];
    assert.equal(migratedSeo.route_path, '/phu-kien-o-to/camera-hanh-trinh-70mai');
    assert.equal(migratedSeo.canonical_url, 'https://xeluottoantrung.com/phu-kien-o-to/camera-hanh-trinh-70mai');
    assert.equal(migratedSeo.meta_title, 'SEO cũ được giữ');
    assert.equal(migratedSeo.robots_index, false);
    assert.deepEqual(migratedSeo.structured_data, { custom: true });
    const seo = (await pg.query<{ route_path: string; meta_title: string; canonical_url: string }>('SELECT * FROM seo_metadata')).rows;
    assert(seo.some(row => row.route_path === '/phu-kien-o-to/camera-hanh-trinh-70mai-2' && row.canonical_url === 'https://external.test/custom'));
    assert(seo.some(row => row.route_path === '/phu-kien-o-to/den-do-2' && row.canonical_url === `https://external.test/phu-kien-o-to/${ids[4]}`));
    assert(seo.some(row => row.route_path === `/phu-kien-o-to/${ids[2]}` && row.meta_title === 'Old retained'));
    assert(seo.some(row => row.route_path === '/phu-kien-o-to/camera-hanh-trinh-70mai-2-2' && row.meta_title === 'New wins'));
    // An old API can still insert without knowing the new column.
    const legacy = (await pg.query<{ id: string; slug: string }>(`INSERT INTO accessories (name,brand,price,image_url)
      VALUES ('ĐÈN ĐỎ','Legacy',1,'https://fixture.test/a.jpg') RETURNING id,slug`)).rows[0];
    assert.equal(legacy.slug, 'den-do-3');
    const db = drizzle(pg, { schema });
    const connection = { db } as unknown as DatabaseService;
    const collections = new CollectionsService(connection);
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Slug Admin' }).returning();
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'slug-test', requestId: 'accessory-slugs' };
    const brand = await collections.create('accessory-brands', { name: '70mai' }, audit);
    const input = { name: 'Camera A810', brandId: String(brand.id), price: 1500000, imageUrl: 'https://fixture.test/a.jpg' };
    const created = await collections.create('accessories', input, audit);
    assert.equal(created.slug, 'camera-a810');
    await collections.update('accessories', String(created.id), { name: 'Camera đổi tên', price: 1600000, status: 'inactive' }, audit);
    const updated = await collections.detail('accessories', String(created.id), false);
    assert.equal(updated.slug, created.slug);
    assert.equal(Number(updated.price), 1600000);
    const duplicate = await collections.create('accessories', input, audit);
    assert.equal(duplicate.slug, 'camera-a810-2', 'Hidden records retain their URLs');
    await assert.rejects(collections.update('accessories', String(created.id), { slug: 'changed' }, audit), BadRequestException);
    await assert.rejects(collections.create('accessories', { ...input, slug: 'injected' }, audit), BadRequestException);
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => collections.create('accessories', { ...input, name: 'Đèn đồng thời' }, audit)));
    assert.deepEqual(concurrent.map(row => row.slug).sort(), ['den-dong-thoi', 'den-dong-thoi-2', 'den-dong-thoi-3', 'den-dong-thoi-4', 'den-dong-thoi-5', 'den-dong-thoi-6']);
    for (const row of concurrent) assert.equal((await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, String(row.id)))).length, 1);
    const batch = await pg.query<{ slug: string }>(`INSERT INTO accessories (name,brand,price,image_url)
      VALUES ('Batch duplicate','B',1,'/a'),('Batch duplicate','B',1,'/a') RETURNING slug`);
    assert.deepEqual(batch.rows.map(row => row.slug), ['batch-duplicate', 'batch-duplicate-2']);
    await assert.rejects(pg.query(`INSERT INTO accessories (name,brand,price,image_url,slug) VALUES ('X','B',1,'/a','camera-a810')`));
    for (const slug of ['BAD', 'bad_slug', ids[0], 'a'.repeat(101)])
      await assert.rejects(pg.query(`INSERT INTO accessories (name,brand,price,image_url,slug) VALUES ('X','B',1,'/a',$1)`, [slug]));
    const search = new SearchService(connection);
    const found = await search.list({ q: 'Camera A810', page: 1, limit: 12 });
    assert(found.data.some(row => row.href === '/phu-kien-o-to/camera-a810-2'));
    assert(!found.data.some(row => row.id === created.id));
    @Module({ controllers: [PublicCollectionsController], providers: [CollectionsService, { provide: DatabaseService, useValue: connection }] })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    for (const key of [duplicate.slug, duplicate.id, String(duplicate.id).toUpperCase()]) {
      const response: { statusCode: number; json: () => { slug: string } } = await app.inject({ method: 'GET', url: `/api/v1/accessories/${key}` });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().slug, duplicate.slug);
    }
    for (const key of [created.slug, created.id, 'missing-slug'])
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/accessories/${key}` })).statusCode, 404);
    for (const key of ['bad_slug', 'BAD'])
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/accessories/${key}` })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/accessories/${'a'.repeat(101)}` })).statusCode, 414);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v1/accessories/${after[7].slug}` })).statusCode, 200, 'Long names get a short, routable slug');
    await collections.update('accessories', String(created.id), { status: 'active' }, audit);
    assert.equal((await collections.detail('accessories', String(created.slug), true, true)).id, created.id);
  } finally { await app?.close(); await pg.close(); }
});
