import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';

test('admin accessories appear on the public list with cover, price and gallery', async () => {
  const pg = new PGlite();
  try {
    for (const migration of ['0000_wild_carmella_unuscione', '0001_unusual_nomad', '0002_lonely_vance_astro', '0003_wonderful_stone_men', '0004_ambitious_dark_phoenix'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const collections = new CollectionsService({ db } as unknown as DatabaseService);
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'accessories' };
    const query = { page: 1, limit: 20 };
    const brand = await collections.create('accessory-brands', { name: '70mai', imageUrl: 'https://example.com/logo.png' }, audit);
    const category = await collections.create('accessory-categories', { name: 'Camera hành trình' }, audit);
    const created = await collections.create('accessories', {
      name: 'Camera hành trình', brandId: String(brand.id), categoryId: String(category.id), price: 1_500_000,
      imageUrl: 'https://example.com/cover.jpg', imageUrls: ['https://example.com/side.jpg'],
      description: '<p>Camera trước và sau</p>', status: 'active',
    }, audit);
    const publicList = await collections.list('accessories', query, true);
    assert.equal(publicList.meta.total, 1);
    assert.equal((await collections.detail('accessories', String(created.id), true)).name, 'Camera hành trình');
    assert.equal(publicList.data[0].brand, '70mai');
    assert.equal(publicList.data[0].categoryId, category.id);
    assert.equal((await collections.list('accessories', { ...query, brandId: String(brand.id) }, true)).meta.total, 1);
    assert.equal((await collections.list('accessories', { ...query, categoryId: String(category.id) }, true)).meta.total, 1);
    assert.equal((await collections.list('accessories', { ...query, search: '70mai' }, true)).meta.total, 1);
    assert.equal((await collections.list('accessories', { ...query, search: 'không có' }, true)).meta.total, 0);
    assert.equal((await collections.list('accessories', { ...query, sort: 'price-asc' }, true)).data[0].id, created.id);
    assert.equal(Number(publicList.data[0].price), 1_500_000);
    assert.deepEqual(publicList.data[0].imageUrls, ['https://example.com/side.jpg']);
    await collections.update('accessories', String(created.id), { imageUrls: [] }, audit);
    assert.deepEqual((await collections.list('accessories', query, true)).data[0].imageUrls, []);
    await collections.update('accessory-brands', String(brand.id), { name: '70mai Việt Nam' }, audit);
    assert.equal((await collections.list('accessories', query, true)).data[0].brand, '70mai Việt Nam');
    await collections.update('accessories', String(created.id), { status: 'inactive' }, audit);
    assert.equal((await collections.list('accessories', query, true)).meta.total, 0);
    await assert.rejects(() => collections.detail('accessories', String(created.id), true));
    assert.equal((await collections.list('accessories', query, false)).meta.total, 1);
    await collections.delete('accessories', String(created.id), audit);
    assert.equal((await collections.list('accessories', query, false)).meta.total, 0);
  } finally { await pg.close(); }
});
