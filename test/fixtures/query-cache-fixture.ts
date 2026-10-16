import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/database/schema/index.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { PublicResponseCache } from '../../src/common/cache/public-cache.js';
import { PublicCacheInterceptor } from '../../src/common/cache/public-cache.interceptor.js';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../../src/modules/auth/admin-access.service.js';
import { PublicCatalogController, AdminBrandsController, AdminModelsController } from '../../src/modules/catalog/catalog.controller.js';
import { CatalogService } from '../../src/modules/catalog/catalog.service.js';
import { PublicCarsController, AdminCarsController, SaleCarsController } from '../../src/modules/cars/cars.controller.js';
import { CarsService } from '../../src/modules/cars/cars.service.js';
import { PublicLookupsController, AdminLookupsController } from '../../src/modules/lookups/lookups.controller.js';
import { LookupsService } from '../../src/modules/lookups/lookups.service.js';
import { LookupPermissionsGuard } from '../../src/modules/lookups/lookups.guard.js';
import { PublicContentController, AdminContentController, AdminSettingsController } from '../../src/modules/content/content.controller.js';
import { ContentService } from '../../src/modules/content/content.service.js';
import { PublicCollectionsController, AdminCollectionsController } from '../../src/modules/content/collections.controller.js';
import { CollectionsService } from '../../src/modules/content/collections.service.js';
import { PublicSeoController, AdminSeoController } from '../../src/modules/seo/seo.controller.js';
import { SeoService } from '../../src/modules/seo/seo.service.js';
import { SearchController } from '../../src/modules/search/search.controller.js';
import { SearchService } from '../../src/modules/search/search.service.js';
import { CarMediaController, MediaUploadController } from '../../src/modules/media/media.controller.js';
import { MediaService } from '../../src/modules/media/media.service.js';
import { STORAGE_SERVICE, type StorageService, type StoredObject } from '../../src/modules/media/storage.service.js';
import { ThrottlerModule } from '@nestjs/throttler';
import { PublicReadThrottlerGuard } from '../../src/common/cache/public-read-throttler.guard.js';
import { ContentReadDiagnostics } from '../../src/common/cache/content-read-diagnostics.js';
import { PublicHomeContentController } from '../../src/modules/content/home-content.controller.js';

// Dedicated local database. No dotenv, pg.Pool, Supabase or real R2 connection.
export async function createQueryCacheFixture() {
  const pg = new PGlite();
  const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries)
    await pg.exec((await readFile(`drizzle/${tag}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
  const db = drizzle(pg, { schema });
  const connection = { db } as unknown as DatabaseService;
  const [profile] = await db.insert(schema.profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Local verification' }).returning();
  const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'local-fixture', requestId: 'cache-verification' };
  const catalog = new CatalogService(connection), cars = new CarsService(connection), lookups = new LookupsService(connection);
  const content = new ContentService(connection), collections = new CollectionsService(connection), seo = new SeoService(connection);
  const region = await lookups.create('branch-regions', { name: 'Local region' }, audit);
  const branch = await lookups.create('branches', { name: 'Showroom Toan Trung 10', address: 'Local fixture', phone: '0000000000', regionId: String(region.id) }, audit);
  const style = await lookups.create('body-styles', { name: 'Sedan' }, audit);
  const transmission = await lookups.create('transmissions', { name: 'Automatic', slug: 'so-tu-dong' }, audit);
  const color = await lookups.create('car-colors', { name: 'Black', slug: 'den' }, audit);
  await lookups.create('filter-options', { group: 'budget', name: 'Budget', minValue: 0, maxValue: 500 }, audit);
  await lookups.create('filter-options', { group: 'mileage', name: 'Mileage', minValue: 0, maxValue: 999999 }, audit);
  const brands = [], models = [], seededCars = [];
  for (const [index, [brandName, modelName]] of [['Toyota', 'Vios'], ['Honda', 'City'], ['Chevrolet', 'Spark']].entries()) {
    const brand = await catalog.createBrand({ name: brandName });
    const model = await catalog.createModel({ name: modelName, brandId: brand.id, bodyStyleId: String(style.id) });
    const version = await lookups.create('car-versions', { name: 'Standard', modelId: model.id }, audit);
    const car = await cars.create({ name: `${brandName} ${modelName} 2025`, brandId: brand.id, modelId: model.id, versionId: String(version.id),
      year: 2025, price: 400_000_000 + index * 30_000_000, originalPrice: 450_000_000 + index * 30_000_000,
      mileage: 20000, fuel: 'Xang', seatCount: 5, transmissionId: String(transmission.id), colorId: String(color.id), branchId: String(branch.id) }, audit);
    await cars.publish(car.id, audit);
    await db.update(schema.cars).set({ createdAt: new Date(Date.now() - (index + 1) * 86400000) }).where(eq(schema.cars.id, car.id));
    await db.insert(schema.carMedia).values({ carId: car.id, publicUrl: `https://fixture.invalid/${car.slug}.jpg`, isCover: true });
    brands.push(brand); models.push(model); seededCars.push(car);
  }
  await content.createEntry({ group: 'thiet-lap-cac-buoc-mua-xe', key: 'step-one', title: 'Local first step', body: 'Local content' }, audit);
  await content.createEntry({ group: 'thiet-lap-chinh-sach-dieu-kien', key: 'policy', title: 'Local policy', body: 'Local policy text' }, audit);
  await content.upsertSetting('thiet-lap-logo', 'logo', { value: '/images/logo.png' }, audit);
  await content.upsertSetting('thiet-lap-thong-tin', 'site_name', { value: 'Toan Trung local fixture' }, audit);
  await seo.upsert({ routePath: '/', metaTitle: 'Local home', robotsIndex: true, robotsFollow: true }, audit);
  await seo.upsert({ routePath: '/san-pham', metaTitle: 'Local inventory' }, audit);
  await seo.upsert({ routePath: `/${seededCars[0].slug}`, metaTitle: 'Local car' }, audit);
  await collections.create('articles', { title: 'Local article', slug: 'local-article', content: '<p>Local article</p>', status: 'published' }, audit);
  await collections.create('faqs', { question: 'Local FAQ', answer: 'Local answer' }, audit);
  const objects = new Map<string, StoredObject>();
  let failStorageDelete = false;
  const storage: StorageService = { head: async key => objects.get(key) ?? null, delete: async key => {
    if (failStorageDelete) throw new Error('Simulated storage failure'); objects.delete(key);
  }, presignPut: async key => `https://fixture.invalid/upload/${key}`, publicUrl: key => `https://fixture.invalid/${key}`, ping: async () => {} };

  async function createApp(enabled: boolean, port = 0, composition = false) {
    const metrics = { selects: 0, queries: 0, requests: 0, bytes: 0, statuses: {} as Record<string, number> };
    const measuredDb = drizzle(pg, { schema, logger: { logQuery: sql => { metrics.queries++; if (/^select\b/i.test(sql)) metrics.selects++; } } });
    const measuredConnection = { db: measuredDb } as unknown as DatabaseService;
    const clock = { now: Date.now() };
    const cache = new PublicResponseCache({ enabled, now: () => clock.now });
    const permissions = ['brand', 'model', 'car', 'body_style', 'transmission', 'color', 'region', 'branch', 'filter', 'version', 'content', 'seo', 'media']
      .flatMap(resource => ['read', 'create', 'update', 'delete', 'publish'].map(action => `${resource}.${action}`));
    @Module({ imports: composition ? [ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }])] : [], controllers: [PublicCatalogController, AdminBrandsController, AdminModelsController, PublicCarsController, AdminCarsController, SaleCarsController,
      PublicLookupsController, AdminLookupsController, PublicContentController, AdminContentController, AdminSettingsController,
      PublicCollectionsController, AdminCollectionsController, PublicSeoController, AdminSeoController, SearchController, CarMediaController, MediaUploadController,
      ...(composition ? [PublicHomeContentController] : [])],
      providers: [CatalogService, CarsService, LookupsService, ContentService, CollectionsService, SeoService, SearchService, MediaService, LookupPermissionsGuard,
        { provide: DatabaseService, useValue: measuredConnection }, { provide: STORAGE_SERVICE, useValue: storage },
        { provide: PublicResponseCache, useValue: cache }, { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
        { provide: JwtVerifierService, useValue: { verify: async (token: string) => {
          if (token !== 'phase3-local') throw new UnauthorizedException(); return { id: profile.authUserId };
        } } },
        { provide: AdminAccessService, useValue: { forAuthUser: async () => ({ profile, roles: ['ADMIN', 'SALES'], permissions }) } },
        { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
        ...(composition ? [ContentReadDiagnostics, { provide: APP_GUARD, useClass: PublicReadThrottlerGuard }] : []),
      ] })
    class LocalVerificationModule {}
    const app = await NestFactory.create<NestFastifyApplication>(LocalVerificationModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const server = app.getHttpAdapter().getInstance();
    server.addHook('onSend', (_request, _reply, payload, done) => {
      if (typeof payload === 'string') metrics.bytes += Buffer.byteLength(payload);
      done(null, payload);
    });
    server.addHook('onResponse', (_request, reply, done) => {
      metrics.requests++; metrics.statuses[reply.statusCode] = (metrics.statuses[reply.statusCode] ?? 0) + 1; done();
    });
    await app.listen({ host: '127.0.0.1', port });
    const url = await app.getUrl();
    return { app, url, cache, clock, metrics, connection: measuredConnection };
  }
  return { pg, db, connection, createApp, brands, models, cars: seededCars, objects, failDelete: (fail: boolean) => { failStorageDelete = fail; } };
}
