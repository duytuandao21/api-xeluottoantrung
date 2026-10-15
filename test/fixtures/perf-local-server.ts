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

const fixture = await createQueryCacheFixture();
// More than one viewport of inventory; all rows remain synthetic.
const audit = { actorProfileId: (await fixture.db.query.profiles.findFirst())!.id, ipAddress: '127.0.0.1', userAgent: 'perf-fixture', requestId: 'perf-fixture' };
const content = new ContentService(fixture.connection);
const collections = new CollectionsService(fixture.connection), carService = new CarsService(fixture.connection);
for (let i = 0; i < 3; i++) {
  const source = fixture.cars[i];
  const car = await carService.create({ name: `Local ${source.name}`, brandId: source.brandId, modelId: source.modelId,
    year: 2024, price: 420000000, originalPrice: 450000000, mileage: 30000, seatCount: 5, fuel: 'Xang' }, audit);
  await carService.publish(car.id, audit);
  await collections.create('slides', { title: `Local slide ${i}`, imageUrl: '/images/xe-moi-ve-banner.png', status: 'active' }, audit);
}
for (const [group, title] of [['thiet-lap-cac-buoc-ban-xe', 'Sell'], ['thiet-lap-cac-buoc-len-doi', 'Trade-in'], ['thiet-lap-quy-trinh-ban-xe', 'Process']])
  for (let i = 0; i < 3; i++) await content.createEntry({ group, key: `step-${i}`, title: `${title} ${i}`, body: '<p>Local benchmark content</p>' }, audit);
@Module({ imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }])],
  controllers: [PublicCatalogController, PublicCarsController, PublicContentController, PublicCollectionsController, PublicLookupsController, PublicSeoController],
  providers: [CatalogService, CarsService, ContentService, CollectionsService, LookupsService, SeoService,
    { provide: DatabaseService, useValue: fixture.connection },
    { provide: PublicResponseCache, useValue: new PublicResponseCache({ enabled: true }) }, ContentReadDiagnostics,
    { provide: APP_GUARD, useClass: PublicReadThrottlerGuard }, { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor }] })
class PerfLocalModule {}
const app = await NestFactory.create<NestFastifyApplication>(PerfLocalModule, new FastifyAdapter(), { logger: false });
app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
configureApiPerfDiagnostics(app.getHttpAdapter().getInstance(), process.env.PERF_DIAGNOSTICS === 'true');
await app.listen({ host: '127.0.0.1', port: 0 });
console.log(JSON.stringify({ event: 'perf_fixture_ready', url: await app.getUrl(), database: 'PGlite-memory', cars: 6, cache: true, rateLimit: 500 }));
const shutdown = async () => { await app.close(); await fixture.pg.close(); process.exit(0); };
process.on('SIGTERM', () => { void shutdown(); }); process.on('SIGINT', () => { void shutdown(); });
