import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import * as schema from '../src/database/schema/index.js';

test('public brand order follows current stock and excludes unavailable cars', async () => {
  const pg = new PGlite();
  try {
    await pg.exec((await readFile('drizzle/0000_wild_carmella_unuscione.sql', 'utf8')).replaceAll('--> statement-breakpoint', ''));
    await pg.exec(await readFile('drizzle/0001_unusual_nomad.sql', 'utf8'));
    const db = drizzle(pg, { schema });
    const catalog = new CatalogService({ db } as unknown as DatabaseService);
    const [toyota, honda, ford, bmw, hidden] = await db.insert(schema.brands).values([
      { name: 'Toyota', slug: 'toyota', sortOrder: 99 },
      { name: 'Honda', slug: 'honda', sortOrder: 0 },
      { name: 'Ford', slug: 'ford', sortOrder: 0 },
      { name: 'BMW', slug: 'bmw', sortOrder: 1 },
      { name: 'Hidden', slug: 'hidden', status: 'inactive' },
    ]).returning();
    const models = await db.insert(schema.carModels).values([toyota, honda, ford, bmw, hidden]
      .map(brand => ({ brandId: brand.id, name: 'Model', slug: 'model' }))).returning();
    const [hiddenModel] = await db.insert(schema.carModels).values({ brandId: honda.id, name: 'Hidden model', slug: 'hidden-model', status: 'inactive' }).returning();
    const base = { brandId: toyota.id, modelId: models[0].id, year: 2024, price: 100, status: 'active' as const, publishedAt: new Date() };
    const rows = await db.insert(schema.cars).values([
      { ...base, name: 'Toyota active', slug: 'toyota-active' },
      { ...base, name: 'Toyota deposit', slug: 'toyota-deposit', status: 'deposit' },
      { ...base, brandId: honda.id, modelId: models[1].id, name: 'Honda active', slug: 'honda-active' },
      { ...base, brandId: honda.id, modelId: models[1].id, name: 'Honda sold', slug: 'honda-sold', status: 'sold' },
      { ...base, brandId: honda.id, modelId: models[1].id, name: 'Honda draft', slug: 'honda-draft', publishedAt: null },
      { ...base, brandId: honda.id, modelId: models[1].id, name: 'Honda inactive', slug: 'honda-inactive', status: 'inactive' },
      { ...base, brandId: honda.id, modelId: models[1].id, name: 'Honda deleted', slug: 'honda-deleted', deletedAt: new Date() },
      { ...base, brandId: honda.id, modelId: hiddenModel.id, name: 'Honda hidden model', slug: 'honda-hidden-model' },
      { ...base, brandId: hidden.id, modelId: models[4].id, name: 'Hidden brand car', slug: 'hidden-brand-car' },
    ]).returning();
    const stock = async () => (await catalog.publicBrands()).map(brand => [brand.slug, brand.stockCount]);
    assert.deepEqual(await stock(), [['toyota', 2], ['honda', 1], ['ford', 0], ['bmw', 0]]);
    // Tie order remains stable and follows the existing admin ordering.
    await db.update(schema.cars).set({ status: 'sold' }).where(eq(schema.cars.id, rows[1].id));
    assert.deepEqual(await stock(), [['honda', 1], ['toyota', 1], ['ford', 0], ['bmw', 0]]);
    await db.update(schema.cars).set({ publishedAt: null }).where(eq(schema.cars.id, rows[0].id));
    assert.deepEqual(await stock(), [['honda', 1], ['ford', 0], ['bmw', 0], ['toyota', 0]]);
    // An admin can publish a car later; no stored counts need updating.
    await db.update(schema.cars).set({ publishedAt: new Date() }).where(eq(schema.cars.id, rows[4].id));
    assert.deepEqual(await stock(), [['honda', 2], ['ford', 0], ['bmw', 0], ['toyota', 0]]);
    // The management list keeps its own order and total-car counts.
    const admin = await catalog.adminBrands();
    assert.equal(admin.find(brand => brand.id === honda.id)?.count, 5);
    assert.equal(admin.find(brand => brand.id === hidden.id)?.count, 1);
    assert.equal(admin.at(-1)?.slug, 'toyota');
  } finally { await pg.close(); }
});
