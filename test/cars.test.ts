import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { ConflictException, Module, NotFoundException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { CatalogService } from '../src/modules/catalog/catalog.service.js';
import { CarsService } from '../src/modules/cars/cars.service.js';
import { AdminCarsController, PublicCarsController, SaleCarsController } from '../src/modules/cars/cars.controller.js';
import { PERMISSIONS_KEY } from '../src/modules/auth/auth.decorators.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import type { ListCarsQuery } from '../src/modules/cars/cars.dto.js';
import { DatabaseService } from '../src/database/database.service.js';
import { auditLogs, branches, carVersions, profiles } from '../src/database/schema/index.js';
import * as schema from '../src/database/schema/index.js';

test('catalog and car lifecycle, filtering, pagination and audit', async () => {
  const pg = new PGlite();
  try {
    const migration = await readFile('drizzle/0000_wild_carmella_unuscione.sql', 'utf8');
    await pg.exec(migration.replaceAll('--> statement-breakpoint', ''));
    await pg.exec(await readFile('drizzle/0001_unusual_nomad.sql', 'utf8'));
    const db = drizzle(pg, { schema });
    const connection = { db } as unknown as DatabaseService;
    const catalog = new CatalogService(connection);
    const service = new CarsService(connection);
    const [profile] = await db.insert(profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Test admin' }).returning();
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'test-1' };
    const brand = await catalog.createBrand({ name: 'Toyota' });
    await assert.rejects(catalog.createBrand({ name: 'Toyota' }), ConflictException);
    const model = await catalog.createModel({ brandId: brand.id, name: 'Vios' });
    const secondBrand = await catalog.createBrand({ name: 'Honda' });
    const secondModel = await catalog.createModel({ brandId: secondBrand.id, name: 'City' });
    const [version] = await db.insert(carVersions).values({ modelId: model.id, name: 'G CVT', slug: 'g-cvt' }).returning();
    const [branch] = await db.insert(branches).values({ name: 'Showroom Toàn Trung 10', slug: 'showroom-toan-trung-10',
      address: 'Gia Lai', phone: '0777393913', mapUrl: 'https://maps.app.goo.gl/test-branch' }).returning();
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, AdminCarsController.prototype.create), ['car.create']);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, AdminCarsController.prototype.publish), ['car.publish']);
    assert.deepEqual((await catalog.publicBrands()).map((row) => row.slug), ['honda', 'toyota']);
    assert.deepEqual((await catalog.publicModels('toyota')).map((row) => row.slug), ['vios']);

    const car = await service.create({ name: 'Toyota Vios 2022', brandId: brand.id, modelId: model.id, versionId: version.id, year: 2022,
      price: 450_000_000, mileage: 20_000, seatCount: 5, branchId: branch.id, licensePlate: '30A-00000' }, audit);
    assert.equal((await catalog.adminBrands()).find(row => row.id === brand.id)?.count, 1);
    assert.equal((await catalog.adminBrands()).find(row => row.id === secondBrand.id)?.count, 0);
    assert.equal((await catalog.adminModels()).find(row => row.id === model.id)?.count, 1);
    assert.equal((await catalog.adminModels(secondBrand.id)).find(row => row.id === secondModel.id)?.count, 0);
    await assert.rejects(catalog.deleteBrand(brand.id), ConflictException);
    await assert.rejects(service.create({ name: 'Toyota Vios 2022', brandId: brand.id, modelId: model.id, year: 2022,
      price: 450_000_000 }, audit), ConflictException);
    assert.equal(car.slug, 'toyota-vios-2022');
    const query = (extra: Partial<ListCarsQuery> = {}): ListCarsQuery => ({ page: 1, limit: 20, sort: 'newest', ...extra });
    assert.equal((await service.list(query())).meta.total, 0);
    assert.equal((await service.list(query(), true)).meta.total, 1);
    assert.equal((await service.list(query({ version: 'g-cvt' }), true)).meta.total, 1);
    assert.equal((await service.list(query({ version: 'other' }), true)).meta.total, 0);
    assert.equal((await service.list(query({ featured: 'true' }), true)).meta.total, 0);
    await service.update(car.id, { featured: true }, audit);
    assert.equal((await service.list(query({ featured: 'true' }), true)).meta.total, 1);
    await assert.rejects(service.publicDetail(car.slug), NotFoundException);
    await service.publish(car.id, audit);
    await assert.rejects(catalog.updateModel(model.id, { brandId: secondBrand.id }), ConflictException);
    const publicList = await service.list(query({ brand: 'toyota', model: 'vios', year_from: 2020, price_max: 500_000_000 }));
    assert.equal((await service.list(query({ brand: 'toyota,ford' }))).meta.total, 1);
    assert.equal(publicList.meta.total, 1);
    assert.equal(publicList.data[0].slug, car.slug);
    assert.equal(publicList.data[0].seatCount, 5);
    assert.equal(publicList.data[0].branch, 'Showroom Toàn Trung 10');
    assert.equal('licensePlate' in publicList.data[0], false);
    assert.equal('description' in publicList.data[0], false);
    const detail = await service.publicDetail(car.slug);
    assert.equal(detail.price, 450_000_000);
    assert.equal(detail.seatCount, 5);
    assert.equal(detail.branch?.mapUrl, branch.mapUrl);
    assert.equal('licensePlate' in detail, false);
    assert.deepEqual(await service.saleLicensePlates([car.slug]), { [car.slug]: '30A-00000' });
    assert.deepEqual(detail.media, []);
    await catalog.updateBrand(brand.id, { status: 'inactive', name: 'Toyota updated' });
    assert.equal((await service.list(query())).meta.total, 0);
    await catalog.updateBrand(brand.id, { status: 'active' });
    assert.equal((await service.list(query())).meta.total, 1);
    assert.equal((await catalog.adminBrand(brand.id)).slug, 'toyota');

    await service.update(car.id, { price: 430_000_000, status: 'deposit', name: 'Toyota Vios updated' }, audit);
    assert.equal((await service.adminDetail(car.id)).slug, car.slug);
    assert.equal((await service.list(query({ price_max: 440_000_000, status: 'deposit' }))).meta.total, 1);
    assert.equal((await service.list(query({ price_min: 440_000_001 }))).meta.total, 0);
    const secondCar = await service.create({ name: 'Honda City 2023', brandId: secondBrand.id, modelId: secondModel.id,
      year: 2023, price: 500_000_000 }, audit);
    await service.publish(secondCar.id, audit);
    const page = await service.list(query({ limit: 1, page: 2, sort: 'price_asc' }));
    assert.equal(page.meta.total, 2);
    assert.equal(page.meta.totalPages, 2);
    assert.equal(page.data.length, 1);
    assert.equal(page.data[0].slug, secondCar.slug);
    await db.update(schema.cars).set({ createdAt: new Date('2025-01-01T00:00:00Z'), updatedAt: new Date('2026-03-01T00:00:00Z') }).where(eq(schema.cars.id, car.id));
    await db.update(schema.cars).set({ createdAt: new Date('2026-02-01T00:00:00Z'), updatedAt: new Date('2026-02-01T00:00:00Z') }).where(eq(schema.cars.id, secondCar.id));
    assert.deepEqual((await service.list(query())).data.map(row => row.slug), [car.slug, secondCar.slug]);
    assert.deepEqual((await service.list(query({ sort: 'price_desc' }))).data.map(row => row.slug), [secondCar.slug, car.slug]);
    await assert.rejects(service.create({ name: 'Invalid', brandId: secondBrand.id, modelId: model.id, year: 2023, price: 1 }, audit), /modelId/);
    await service.unpublish(car.id, audit);
    assert.equal((await service.list(query())).meta.total, 1);
    assert.equal((await service.list(query({ search: '30A' }), false, true)).meta.total, 0);
    await service.delete(car.id, audit);
    assert.equal((await catalog.adminBrands()).find(row => row.id === brand.id)?.count, 0);
    assert.equal((await catalog.adminModels()).find(row => row.id === model.id)?.count, 0);
    await assert.rejects(service.adminDetail(car.id), NotFoundException);
    const actions = (await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, car.id))).map((row) => row.action);
    assert.ok(['car.create', 'car.publish', 'car.update', 'car.price_change', 'car.status_change', 'car.unpublish', 'car.delete'].every((action) => actions.includes(action)));

    let granted: string[] = [];
    let assignedRoles: string[] = [];
    @Module({
      controllers: [AdminCarsController, PublicCarsController, SaleCarsController],
      providers: [
        { provide: DatabaseService, useValue: connection }, CarsService,
        { provide: JwtVerifierService, useValue: { verify: async () => ({ id: profile.authUserId }) } },
        { provide: AdminAccessService, useValue: { forAuthUser: async () => ({ profile: {
          id: profile.id, authUserId: profile.authUserId, fullName: profile.fullName, email: null, phone: null,
          status: 'active', createdAt: profile.createdAt, updatedAt: profile.updatedAt,
        }, roles: assignedRoles, permissions: granted }) } },
        { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
      ],
    })
    class TestCarsModule {}
    const app = await NestFactory.create<NestFastifyApplication>(TestCarsModule, new FastifyAdapter(), { logger: false });
    try {
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.init();
      const server = app.getHttpAdapter().getInstance();
      const body = { name: 'HTTP Car', brandId: brand.id, modelId: model.id, year: 2020, price: 200_000_000, licensePlate: '43A-12345' };
      const send = (payload: object, token = true) => server.inject({ method: 'POST', url: '/api/v1/admin/cars',
        headers: token ? { authorization: 'Bearer test-token' } : {}, payload });
      assert.equal((await send(body, false)).statusCode, 401);
      assert.equal((await send(body)).statusCode, 403);
      granted = ['car.create'];
      assert.equal((await send({ ...body, price: -1 })).statusCode, 400);
      const created = await send(body);
      assert.equal(created.statusCode, 201);
      const createdId = created.json().id as string;
      assert.ok(createdId);
      granted = ['car.publish'];
      assert.equal((await server.inject({ method: 'POST', url: `/api/v1/admin/cars/${createdId}/publish`,
        headers: { authorization: 'Bearer test-token' } })).statusCode, 201);
      const publicDetail = await server.inject({ method: 'GET', url: '/api/v1/cars/http-car' });
      assert.equal(publicDetail.statusCode, 200);
      assert.equal(publicDetail.json().price, body.price);
      assert.equal('licensePlate' in publicDetail.json(), false);
      const plateUrl = '/api/v1/sale/cars/license-plates?slugs=http-car';
      assert.equal((await server.inject({ method: 'GET', url: plateUrl })).statusCode, 401);
      assert.equal((await server.inject({ method: 'GET', url: plateUrl, headers: { authorization: 'Bearer test-token' } })).statusCode, 403);
      const searchUrl = '/api/v1/sale/cars?search=43A-123.45';
      assert.equal((await server.inject({ method: 'GET', url: searchUrl })).statusCode, 401);
      assert.equal((await server.inject({ method: 'GET', url: searchUrl, headers: { authorization: 'Bearer test-token' } })).statusCode, 403);
      assert.equal((await server.inject({ method: 'GET', url: '/api/v1/cars?search=43A-123.45' })).json().meta.total, 0);
      assignedRoles = ['SALES'];
      const saleSearch = await server.inject({ method: 'GET', url: searchUrl, headers: { authorization: 'Bearer test-token' } });
      assert.equal(saleSearch.statusCode, 200);
      assert.equal(saleSearch.json().meta.total, 1);
      assert.equal(saleSearch.json().data[0].slug, 'http-car');
      assert.equal('licensePlate' in saleSearch.json().data[0], false);
      assert.equal((await server.inject({ method: 'GET', url: '/api/v1/sale/cars?search=12345&brand=honda',
        headers: { authorization: 'Bearer test-token' } })).json().meta.total, 0);
      const salePlates = await server.inject({ method: 'GET', url: plateUrl, headers: { authorization: 'Bearer test-token' } });
      assert.equal(salePlates.statusCode, 200);
      assert.deepEqual(salePlates.json(), { 'http-car': '43A-12345' });
      assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/cars', headers: { authorization: 'Bearer test-token' } })).statusCode, 403);
    } finally {
      await app.close();
    }
  } finally {
    await pg.close();
  }
});
