import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import { SearchController } from '../src/modules/search/search.controller.js';
import { SearchService, normalizeSearch } from '../src/modules/search/search.service.js';
import * as schema from '../src/database/schema/index.js';

test('public search: visibility, Vietnamese names, combined limit, ranking, pagination and validation', async () => {
  const pg = new PGlite();
  let app: NestFastifyApplication | undefined;
  try {
    await pg.exec((await readFile('drizzle/0000_wild_carmella_unuscione.sql', 'utf8')).replaceAll('--> statement-breakpoint', ''));
    await pg.exec(await readFile('drizzle/0001_unusual_nomad.sql', 'utf8'));
    await pg.exec(await readFile('drizzle/0003_wonderful_stone_men.sql', 'utf8'));
    await pg.exec(await readFile('drizzle/0004_ambitious_dark_phoenix.sql', 'utf8'));
    const db = drizzle(pg, { schema });
    const connection = { db } as unknown as DatabaseService;
    const search = new SearchService(connection);
    const [brand, hiddenBrand] = await db.insert(schema.brands).values([
      { name: 'Toyota', slug: 'toyota' }, { name: 'Hidden', slug: 'hidden', status: 'inactive' },
    ]).returning();
    const [model, hiddenModel] = await db.insert(schema.carModels).values([
      { name: 'Vios', slug: 'vios', brandId: brand.id },
      { name: 'Hidden', slug: 'hidden', brandId: brand.id, status: 'inactive' },
    ]).returning();
    const base = { brandId: brand.id, modelId: model.id, year: 2024, price: 400_000_000, publishedAt: new Date(), status: 'active' as const };
    const carRows = await db.insert(schema.cars).values([
      { ...base, name: 'Toyota Vios', slug: 'toyota-vios', featured: true },
      { ...base, name: 'Toyota Vios 2024', slug: 'vios-2024' },
      { ...base, name: 'Toyota Vios 2023', slug: 'vios-2023', status: 'deposit', featured: true },
      { ...base, name: 'Toyota Vios sold', slug: 'vios-sold', status: 'sold', featured: true },
      { ...base, name: 'Toyota Vios draft', slug: 'vios-draft', publishedAt: null, featured: true },
      { ...base, name: 'Toyota Vios inactive', slug: 'vios-inactive', status: 'inactive', featured: true },
      { ...base, name: 'Toyota Vios deleted', slug: 'vios-deleted', deletedAt: new Date(), featured: true },
      { ...base, name: 'Toyota Vios hidden brand', slug: 'vios-hidden-brand', brandId: hiddenBrand.id, featured: true },
      { ...base, name: 'Toyota Vios hidden model', slug: 'vios-hidden-model', modelId: hiddenModel.id, featured: true },
    ]).returning();
    await db.insert(schema.carMedia).values({ carId: carRows[0].id, publicUrl: '/car-cover.jpg', isCover: true });
    const accessories = await db.insert(schema.accessories).values([
      { name: 'Giảm xóc Toyota Vios', price: 1_200_000, status: 'active', imageUrl: '/accessory.jpg' },
      { name: 'Thảm sàn Toyota Vios', price: 500_000, status: 'active' },
      { name: 'Ốp Toyota Vios', price: 100_000, status: 'active' },
      { name: 'Đèn Toyota Vios', price: 200_000, status: 'active' },
      { name: 'Toyota Vios hidden accessory', price: 1, status: 'inactive' },
      { name: 'Phụ kiện 100%_test', price: 1, status: 'active' },
    ].map(item => ({ brand: 'Test brand', imageUrl: '/accessory.jpg', ...item }))).returning();
    assert.equal(normalizeSearch('  ĐÈN  Ô TÔ '), 'den o to');
    const keywords = await search.keywords();
    for (const tag of ['Toyota Vios', 'Toyota', 'Test brand', 'Giảm xóc Toyota Vios']) assert(keywords.includes(tag), tag);
    assert(keywords.every(tag => tag.length <= 42 && !/hidden|draft|inactive|deleted|sold|2023/i.test(tag)));
    assert((await search.keywords('giam xoc')).includes('Giảm xóc Toyota Vios'));
    const initial = await search.suggestions();
    assert.deepEqual(initial.items.map(item => item.kind), ['car', 'accessory', 'car', 'accessory']);
    assert(initial.items.every(item => !/sold|draft|inactive|deleted|hidden/i.test(item.name)));
    assert.equal(initial.items.filter(item => item.kind === 'car' && item.id === carRows[0].id).length, 1);
    assert.equal((await search.suggestions('test brand')).total, 5);
    const suggestions = await search.suggestions('toyota vios');
    assert.equal(suggestions.total, 8);
    assert.equal(suggestions.items.length, 5);
    assert.equal(suggestions.items[0].name, 'Toyota Vios');
    assert.equal(suggestions.items[0].href, '/toyota-vios');
    assert.equal(suggestions.items[0].imageUrl, '/car-cover.jpg');
    assert.equal(suggestions.items[0].price, 400_000_000);
    assert.equal('description' in suggestions.items[0], false);
    const pages = await Promise.all([1, 2, 3].map(page => search.list({ q: 'vios toyota', page, limit: 3 })));
    const all = pages.flatMap(page => page.data);
    assert.equal(all.length, 8);
    assert.equal(new Set(all.map(item => `${item.kind}:${item.id}`)).size, 8);
    assert(all.some(item => item.kind === 'accessory'));
    assert(all.every(item => !/draft|inactive|deleted|hidden/i.test(item.name)));
    assert.equal(pages[0].meta.totalPages, 3);
    const accentless = await search.suggestions('giam xoc');
    assert.equal(accentless.items[0].id, accessories[0].id);
    assert.equal(accentless.items[0].href, `/phu-kien-o-to/${accessories[0].id}`);
    assert.deepEqual((await search.suggestions('GIẢM XÓC')).items, accentless.items);
    assert.equal((await search.suggestions('den')).items[0].name, 'Đèn Toyota Vios');
    assert.equal((await search.suggestions('%_')).total, 1);
    assert.equal((await search.suggestions("' OR 1=1 --")).total, 0);
    assert.equal((await search.suggestions('not-found')).items.length, 0);
    assert.equal((await search.suggestions('  ')).items.length, 4);
    assert((await search.suggestions()).keywords.length <= 8);

    @Module({ controllers: [SearchController], providers: [SearchService, { provide: DatabaseService, useValue: connection }] })
    class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=vios' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().meta.limit, 12);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/search/suggestions?q=giam%20xoc' })).json().items.length, 1);
    for (const path of ['/search?page=0', '/search?limit=25', '/search?page=x', `/search/suggestions?q=${'x'.repeat(121)}`, '/search?q[]=vios', '/search?private=true']) {
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1${path}` })).statusCode, 400, path);
    }
  } finally { await app?.close(); await pg.close(); }
});
