// Isolated local benchmark only. Does not load .env or connect to remote DB.
import 'reflect-metadata';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerModule } from '@nestjs/throttler';
import { createQueryCacheFixture } from './query-cache-fixture.js';
import { PublicCatalogController } from '../../src/modules/catalog/catalog.controller.js';
import { CatalogService } from '../../src/modules/catalog/catalog.service.js';
import { PublicCarsController } from '../../src/modules/cars/cars.controller.js';
import { CarsService } from '../../src/modules/cars/cars.service.js';
import { PublicContentController } from '../../src/modules/content/content.controller.js';
import { ContentService } from '../../src/modules/content/content.service.js';
import { PublicCollectionsController } from '../../src/modules/content/collections.controller.js';
import { CollectionsService } from '../../src/modules/content/collections.service.js';
import { PublicLookupsController } from '../../src/modules/lookups/lookups.controller.js';
import { LookupsService } from '../../src/modules/lookups/lookups.service.js';
import { PublicSeoController } from '../../src/modules/seo/seo.controller.js';
import { SeoService } from '../../src/modules/seo/seo.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { PublicReadThrottlerGuard } from '../../src/common/cache/public-read-throttler.guard.js';
import { PublicCacheInterceptor } from '../../src/common/cache/public-cache.interceptor.js';
import { PublicResponseCache } from '../../src/common/cache/public-cache.js';
import { ContentReadDiagnostics } from '../../src/common/cache/content-read-diagnostics.js';
import { configureApiPerfDiagnostics } from '../../src/common/perf-transport.js';
import * as schema from '../../src/database/schema/index.js';
import { eq } from 'drizzle-orm';

const fixture = await createQueryCacheFixture();
// More than one viewport of inventory; all rows remain synthetic.
const audit = { actorProfileId: (await fixture.db.query.profiles.findFirst())!.id, ipAddress: '127.0.0.1', userAgent: 'perf-fixture', requestId: 'perf-fixture' };
const content = new ContentService(fixture.connection);
const collections = new CollectionsService(fixture.connection), carService = new CarsService(fixture.connection);
for (let i = 0; i < 21; i++) {
  const source = fixture.cars[i % 3];
  const car = await carService.create({ name: `Local ${source.name} ${i}`, brandId: source.brandId, modelId: source.modelId,
    versionId: source.versionId ?? undefined, branchId: source.branchId ?? undefined,
    transmissionId: source.transmissionId ?? undefined, colorId: source.colorId ?? undefined,
    year: 2022 + i % 4, price: 420000000 + i * 1000000, originalPrice: 450000000 + i * 1000000, mileage: 30000, seatCount: 5, fuel: 'Xang' }, audit);
  await carService.publish(car.id, audit);
  await fixture.db.update(schema.cars).set({ createdAt: new Date(Date.UTC(2026, 8, 1, 0, i)), newArrival: i % 2 === 0 }).where(eq(schema.cars.id, car.id));
  await fixture.db.insert(schema.carMedia).values([0, 1, 2].map(index => ({ carId: car.id,
    publicUrl: `https://fixture.invalid/vehicles/${car.slug}-${index}.webp`, isCover: index === 0, sortOrder: index })));
}
for (let i = 0; i < 5; i++) await collections.create('slides', { title: `Local slide ${i}`, imageUrl: '/images/xe-moi-ve-banner.png', status: 'active' }, audit);
for (const [group, title] of [['thiet-lap-cac-buoc-ban-xe', 'Sell'], ['thiet-lap-cac-buoc-len-doi', 'Trade-in'], ['thiet-lap-quy-trinh-ban-xe', 'Process'],
  ['thiet-lap-cac-buoc-mua-xe', 'Buy'], ['thiet-lap-banner-dong-xe', 'Banner'], ['thiet-lap-nut-goi', 'Contact'],
  ['thiet-lap-mang-xa-hoi', 'Social'], ['thiet-lap-ung-dung', 'App']])
  for (let i = 0; i < 3; i++) await content.createEntry({ group, key: `step-${i}`, title: `${title} ${i}`, body: '<p>Local benchmark content</p>' }, audit);
for (let i = 0; i < 6; i++) await collections.create('testimonials', { name: `Local customer ${i}`, content: 'Synthetic customer experience for local performance verification.', rating: 5, featured: true, status: 'active', avatarUrl: '/images/logo.png' }, audit);
for (let i = 0; i < 3; i++) {
  await collections.create('services', { title: `Local service ${i}`, description: '<p>Local service details.</p>', status: 'active' }, audit);
  await collections.create('articles', { title: `Local article ${i}`, slug: `local-article-${i}`, content: '<p>Local news details.</p>', imageUrl: '/images/xe-moi-ve-banner.png', status: 'published' }, audit);
}
const accessoryBrand = await collections.create('accessory-brands', { name: 'Local', status: 'active' }, audit);
for (let i = 0; i < 12; i++) await collections.create('accessories', { name: `Local accessory ${i}`, brandId: String(accessoryBrand.id), price: 2800000 + i * 100000,
  imageUrl: '/images/xe-moi-ve-banner.png', description: '<p>Synthetic accessory.</p>', status: 'active' }, audit);
@Module({ imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }])],
  controllers: [PublicCatalogController, PublicCarsController, PublicContentController, PublicCollectionsController, PublicLookupsController, PublicSeoController],
  providers: [CatalogService, CarsService, ContentService, CollectionsService, LookupsService, SeoService,
    { provide: DatabaseService, useValue: fixture.connection },
    { provide: PublicResponseCache, useValue: new PublicResponseCache({ enabled: true }) }, ContentReadDiagnostics,
    { provide: APP_GUARD, useClass: PublicReadThrottlerGuard }, { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor }] })
class PerfLocalModule {}
const app = await NestFactory.create<NestFastifyApplication>(PerfLocalModule, new FastifyAdapter(), { logger: false });
app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
const recorder = configureApiPerfDiagnostics(app.getHttpAdapter().getInstance(), process.env.PERF_DIAGNOSTICS === 'true');
process.on('message', message => { if (message === 'perf:flush') { recorder.flush(); process.send?.({ event: 'perf_flushed' }); } });
await app.listen({ host: '127.0.0.1', port: 0 });
console.log(JSON.stringify({ event: 'perf_fixture_ready', url: await app.getUrl(), database: 'PGlite-memory', cars: 24, slides: 5, accessories: 12, cache: true, rateLimit: 500 }));
const shutdown = async () => { await app.close(); await fixture.pg.close(); process.exit(0); };
process.on('SIGTERM', () => { void shutdown(); }); process.on('SIGINT', () => { void shutdown(); });
