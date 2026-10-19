import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import { StorageCleanupService } from '../src/modules/media/storage-cleanup.service.js';
import { queueRemovedImages } from '../src/modules/media/storage-cleanup.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { LookupsService } from '../src/modules/lookups/lookups.service.js';
import { SeoService } from '../src/modules/seo/seo.service.js';
import { PromotionsService } from '../src/modules/promotions/service.js';
import { CarsService } from '../src/modules/cars/cars.service.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { carMedia, profiles } from '../src/database/schema/index.js';

test('all admin image removals: committed intent, shared references, R2 retry and protected HTTP cleanup', async () => {
  const f = await createQueryCacheFixture();
  const [profile] = await f.db.select().from(profiles);
  const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'fixture', requestId: 'cleanup-test' };
  const cleanup = new StorageCleanupService(f.connection, f.storage);
  const collections = new CollectionsService(f.connection), content = new ContentService(f.connection);
  const catalog = new CatalogService(f.connection), lookups = new LookupsService(f.connection);
  const seo = new SeoService(f.connection), promotions = new PromotionsService(f.connection);
  const cars = new CarsService(f.connection), media = new MediaService(f.connection, f.storage);
  const image = () => {
    const key = `assets/${randomUUID()}.jpg`;
    f.objects.set(key, { mimeType: 'image/jpeg', sizeBytes: 100 });
    return { key, url: f.storage.publicUrl(key) };
  };
  try {
    const cover = image(), a = image(), b = image(), c = image(), nextCover = image();
    const brand = await collections.create('accessory-brands', { name: 'Cleanup brand' }, audit);
    const accessory = await collections.create('accessories', { name: 'Test accessory', brandId: String(brand.id), price: 1000,
      imageUrl: cover.url, imageUrls: [a.url, b.url] }, audit);
    await collections.update('accessories', String(accessory.id), { price: 2000 }, audit);
    await cleanup.flush();
    assert(f.objects.has(cover.key) && f.objects.has(a.key) && f.objects.has(b.key), 'Unrelated edits keep every image');
    await collections.update('accessories', String(accessory.id), { imageUrls: [a.url, c.url] }, audit);
    await cleanup.flush();
    assert(!f.objects.has(b.key), 'Only the explicitly removed gallery image is deleted');
    assert(f.objects.has(a.key) && f.objects.has(c.key) && f.objects.has(cover.key));

    await content.upsertSetting('thiet-lap-logo', 'shared', { value: cover.url }, audit);
    await seo.upsert({ routePath: '/shared', ogImageUrl: cover.url }, audit);
    await catalog.updateBrand(f.brands[0].id, { imageUrl: cover.url });
    await collections.update('accessories', String(accessory.id), { imageUrl: nextCover.url }, audit);
    await cleanup.flush();
    assert(f.objects.has(cover.key), 'Shared logo/SEO/brand references protect the old cover');
    await content.upsertSetting('thiet-lap-logo', 'shared', { value: '' }, audit);
    await seo.delete('/shared', audit); await cleanup.flush();
    assert(f.objects.has(cover.key), 'Last brand reference still protects the image');
    await catalog.updateBrand(f.brands[0].id, { imageUrl: null }); await cleanup.flush();
    assert(!f.objects.has(cover.key), 'Removal of the final reference deletes the shared file');

    const other = await collections.create('accessories', { name: 'Other accessory', brandId: String(brand.id), price: 1, imageUrl: a.url }, audit);
    await collections.delete('accessories', String(accessory.id), audit); await cleanup.flush();
    assert(!f.objects.has(nextCover.key) && !f.objects.has(c.key));
    assert(f.objects.has(a.key), 'Deleting a product does not delete another product’s cover');
    await collections.delete('accessories', String(other.id), audit); await cleanup.flush();
    assert(!f.objects.has(a.key));

    const entryImage = image(), inline = image();
    await content.createEntry({ group: 'cleanup', key: 'test', title: 'Test', imageUrl: entryImage.url, body: `<img src="${inline.url}">` }, audit);
    await content.updateEntry('cleanup', 'test', { imageUrl: null }, audit); await cleanup.flush();
    assert(!f.objects.has(entryImage.key) && f.objects.has(inline.key));
    await content.deleteEntry('cleanup', 'test', audit); await cleanup.flush(); assert(!f.objects.has(inline.key));
    const faqImage = image();
    const faq = await collections.create('faqs', { question: 'Shared inline image', answer: `<img src="${faqImage.url}">`, imageUrl: faqImage.url }, audit);
    await collections.update('faqs', String(faq.id), { imageUrl: null }, audit); await cleanup.flush();
    assert(f.objects.has(faqImage.key), 'FAQ answer HTML protects an image removed from the cover field');
    await collections.delete('faqs', String(faq.id), audit); await cleanup.flush(); assert(!f.objects.has(faqImage.key));
    const banner = image();
    await content.upsertSetting('banner', 'image', { value: JSON.stringify({ desktop: banner.url }), valueType: 'json' }, audit);
    await content.upsertSetting('banner', 'image', { value: '{}' }, audit); await cleanup.flush(); assert(!f.objects.has(banner.key));
    const articleImage = image();
    const article = await collections.create('articles', { title: 'Cleanup article', slug: 'cleanup-article', content: `<img src="${articleImage.url}">` }, audit);
    await collections.delete('articles', String(article.id), audit); await cleanup.flush(); assert(!f.objects.has(articleImage.key));
    const lookupImage = image();
    const style = await lookups.create('body-styles', { name: 'Cleanup style', imageUrl: lookupImage.url }, audit);
    await lookups.update('body-styles', String(style.id), { imageUrl: null }, audit); await cleanup.flush(); assert(!f.objects.has(lookupImage.key));
    const promotionImage = image();
    const promotion = await promotions.create({ title: 'Cleanup promo', imageUrl: promotionImage.url, startsAt: '2026-01-01', endsAt: '2026-12-31' }, audit);
    await promotions.delete(promotion.id, audit); await cleanup.flush(); assert(!f.objects.has(promotionImage.key));
    const modelImage = image();
    await catalog.updateModel(f.models[0].id, { imageUrl: modelImage.url });
    await catalog.updateModel(f.models[0].id, { imageUrl: null }); await cleanup.flush(); assert(!f.objects.has(modelImage.key));

    const foreign = image();
    const foreignUrl = foreign.url.replace('fixture.invalid', 'foreign.invalid');
    await f.connection.db.transaction(async tx => { await queueRemovedImages(tx, { imageUrl: foreignUrl }, null, audit); });
    await cleanup.flush(); assert(f.objects.has(foreign.key), 'Foreign host cannot delete the same path in our bucket');
    await assert.rejects(f.connection.db.transaction(async tx => {
      await queueRemovedImages(tx, { imageUrl: foreign.url }, null, audit); throw new Error('rollback');
    }), /rollback/);
    await cleanup.flush(); assert(f.objects.has(foreign.key), 'Failed save/transaction does not authorize deletion');
    const notConfigured = new StorageCleanupService(f.connection, { ...f.storage, publicUrl: () => { throw new Error('not configured'); } });
    await f.connection.db.transaction(async tx => { await queueRemovedImages(tx, { imageUrl: foreign.url }, null, audit); });
    await notConfigured.flush();
    assert(f.objects.has(foreign.key), 'Configuration failure leaves the intent pending, never marks it retained');
    await cleanup.flush(); assert(!f.objects.has(foreign.key));
    const legacyKey = 'uploads/legacy photo.png', legacyUrl = f.storage.publicUrl(legacyKey);
    f.objects.set(legacyKey, { mimeType: 'image/png', sizeBytes: 100 });
    await content.upsertSetting('legacy', 'image', { value: legacyUrl }, audit);
    await content.upsertSetting('legacy', 'image', { value: '' }, audit); await cleanup.flush();
    assert(!f.objects.has(legacyKey), 'Owned legacy paths are resolved without a UUID or a car storageKey');

    const car = f.cars[0];
    const keys = [1, 2, 3].map(() => `cars/${car.id}/${randomUUID()}.jpg`);
    const rows = [];
    for (const key of keys) {
      f.objects.set(key, { mimeType: 'image/jpeg', sizeBytes: 100 });
      const [row] = await f.db.insert(carMedia).values({ carId: car.id, storageKey: key, publicUrl: f.storage.publicUrl(key) }).returning(); rows.push(row);
    }
    await media.delete(car.id, rows[0].id, audit); await cleanup.flush();
    assert(!f.objects.has(keys[0]) && f.objects.has(keys[1]) && f.objects.has(keys[2]), 'Deleting one car image preserves the rest');
    f.failDelete(true);
    await cars.delete(car.id, audit); await cleanup.flush();
    assert(f.objects.has(keys[1]) && f.objects.has(keys[2]));
    assert((await f.db.select().from(carMedia).where(eq(carMedia.id, rows[1].id)))[0].deletionPendingAt);
    f.failDelete(false);
    const restartedWorker = new StorageCleanupService(f.connection, f.storage);
    await restartedWorker.flush();
    assert(!f.objects.has(keys[1]) && !f.objects.has(keys[2]), 'Retry survives worker restart and removes every deleted-car image');

    // The real global interceptor runs after authenticated mutations, including warm public cache invalidation.
    const app = await f.createApp(true, 0, true);
    try {
      const server = app.app.getHttpAdapter().getInstance();
      const target = f.cars[1], key = `cars/${target.id}/${randomUUID()}.jpg`;
      f.objects.set(key, { mimeType: 'image/jpeg', sizeBytes: 100 });
      await f.db.insert(carMedia).values({ carId: target.id, storageKey: key, publicUrl: f.storage.publicUrl(key) });
      const request = (token?: string) => server.inject({ method: 'DELETE', url: `/api/v1/admin/cars/${target.id}`,
        headers: token ? { authorization: `Bearer ${token}` } : {} });
      await server.inject({ method: 'GET', url: '/api/v1/cars/menu?section=new-arrivals' });
      assert.equal((await request()).statusCode, 401); assert(f.objects.has(key));
      assert.equal((await request('invalid')).statusCode, 401); assert(f.objects.has(key));
      assert.equal((await request('phase3-local')).statusCode, 204); assert(!f.objects.has(key));
      const menu = await server.inject({ method: 'GET', url: '/api/v1/cars/menu?section=new-arrivals' });
      assert(!menu.json().data.some((row: { slug: string }) => row.slug === target.slug));
      assert.equal((await server.inject({ method: 'GET', url: `/api/v1/cars/${target.slug}` })).statusCode, 404);
    } finally { await app.app.close(); }
    const pending = await f.db.execute(sql`SELECT count(*)::int AS n FROM audit_logs p WHERE action = 'storage.delete_pending'
      AND NOT EXISTS (SELECT 1 FROM audit_logs d WHERE d.entity_id = p.entity_id AND d.action IN ('storage.deleted', 'storage.retained'))`);
    assert.equal(pending.rows[0].n, 0);
  } finally { cleanup.onModuleDestroy(); await f.pg.close(); }
});
