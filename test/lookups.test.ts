import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { brands, carModels, cars, profiles } from '../src/database/schema/index.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminLookupsController, PublicLookupsController } from '../src/modules/lookups/lookups.controller.js';
import { LookupPermissionsGuard } from '../src/modules/lookups/lookups.guard.js';
import { LookupsService } from '../src/modules/lookups/lookups.service.js';

test('phase 7 lookup CRUD, public visibility, relation checks, and per-resource RBAC', async () => {
  const pg = new PGlite();
  try {
    for (const migration of ['0000_wild_carmella_unuscione', '0001_unusual_nomad'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
    const connection = { db } as unknown as DatabaseService;
    const [profile] = await db.insert(profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'lookups' };
    const service = new LookupsService(connection);
    const query = { page: 1, limit: 20 };
    const region = await service.create('branch-regions', { name: 'Miền Nam' }, audit);
    const branch = await service.create('branches', { name: 'Toàn Trung', regionId: String(region.id),
      address: 'Quận 12', phone: '0900000000' }, audit);
    assert.equal(branch.slug, 'toan-trung');
    assert.equal((await service.list('branches', query, true)).meta.total, 1);
    assert.equal((await service.detail('branches', String(branch.id), true)).regionId, region.id);
    const central = await service.create('branch-regions', { name: 'Miền Trung' }, audit);
    await service.update('branches', String(branch.id), { regionId: String(central.id) }, audit);
    assert.equal((await service.list('branches', { ...query, regionId: String(region.id) }, true)).meta.total, 0);
    assert.equal((await service.list('branches', { ...query, regionId: String(central.id) }, true)).data[0].id, branch.id);
    await service.update('branches', String(branch.id), { status: 'inactive' }, audit);
    assert.equal((await service.list('branches', query, true)).meta.total, 0);
    assert.equal((await service.list('branches', query, false)).meta.total, 1);
    await assert.rejects(service.create('filter-options', { group: 'budget', name: 'Sai', minValue: 100, maxValue: 10 }, audit), BadRequestException);
    const filter = await service.create('filter-options', { group: 'budget', name: 'Dưới 500 triệu', minValue: 0, maxValue: 500 }, audit);
    assert.equal((await service.list('filter-options', { ...query, group: 'budget' }, true)).data[0].id, filter.id);
    await assert.rejects(service.create('filter-options', { group: 'budget', name: 'Equal', minValue: 500, maxValue: 500 }, audit), BadRequestException);
    await assert.rejects(service.create('filter-options', { group: 'budget', name: 'Missing', minValue: 500 }, audit), BadRequestException);
    await assert.rejects(service.update('filter-options', String(filter.id), { maxValue: 0 }, audit), BadRequestException);
    const high = await service.create('filter-options', { group: 'budget', name: 'High', minValue: 1200, maxValue: 1500, sortOrder: -10 }, audit);
    assert.equal(high.name, '1200 - 1500 triệu');
    await db.insert(schema.filterOptions).values({ group: 'budget', name: '1 - 1.2 tỷ', slug: 'legacy-budget' });
    await db.insert(schema.filterOptions).values({ group: 'budget', name: '800 triệu - 1 tỷ', slug: 'legacy-mixed' });
    for (const publicOnly of [true, false]) {
      const sorted = await service.list('filter-options', { page: 1, limit: 10, group: 'budget' }, publicOnly);
      assert.deepEqual(sorted.data.map(row => row.minValue), [0, 800, 1000, 1200]);
      assert.deepEqual(sorted.data.map(row => row.maxValue), [500, 1000, 1200, 1500]);
      const second = await service.list('filter-options', { page: 2, limit: 2, group: 'budget' }, publicOnly);
      assert.deepEqual(second.data.map(row => row.minValue), [1000, 1200]);
    }
    await assert.rejects(service.list('branches', { ...query, group: 'budget' }, false), BadRequestException);
    const [brand] = await db.insert(brands).values({ name: 'Toyota', slug: 'toyota' }).returning();
    const [firstModel] = await db.insert(carModels).values({ brandId: brand.id, name: 'Vios', slug: 'vios' }).returning();
    const [secondModel] = await db.insert(carModels).values({ brandId: brand.id, name: 'Camry', slug: 'camry' }).returning();
    const version = await service.create('car-versions', { name: 'G', modelId: firstModel.id }, audit);
    const [linkedCar] = await db.insert(cars).values({ name: 'Xe', slug: 'xe', brandId: brand.id, modelId: firstModel.id,
      versionId: String(version.id), year: 2022, price: 100_000_000 }).returning();
    const emptyVersion = await service.create('car-versions', { name: 'E', modelId: firstModel.id }, audit);
    const versionRows = (await service.list('car-versions', query, false)).data;
    assert.equal(versionRows.find(row => row.id === version.id)?.count, 1);
    assert.equal(versionRows.find(row => row.id === emptyVersion.id)?.count, 0);
    assert.equal('count' in (await service.list('car-versions', query, true)).data[0], false);
    await assert.rejects(service.update('car-versions', String(version.id), { modelId: secondModel.id }, audit), /cannot move/);
    await db.update(cars).set({ deletedAt: new Date() }).where(eq(cars.id, linkedCar.id));
    assert.equal((await service.list('car-versions', query, false)).data.find(row => row.id === version.id)?.count, 0);

    let granted: string[] = [];
    @Module({ controllers: [AdminLookupsController, PublicLookupsController], providers: [
      { provide: DatabaseService, useValue: connection }, LookupsService, LookupPermissionsGuard,
      { provide: JwtVerifierService, useValue: { verify: async () => ({ id: profile.authUserId }) } },
      { provide: AdminAccessService, useValue: { forAuthUser: async () => ({ profile, roles: ['TEST'], permissions: granted }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ] })
    class LookupsTestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(LookupsTestModule, new FastifyAdapter(), { logger: false });
    try {
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.init();
      const server = app.getHttpAdapter().getInstance();
      assert.equal((await server.inject({ method: 'GET', url: '/api/v1/branches' })).statusCode, 200);
      assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/lookups/branches' })).statusCode, 401);
      const request = () => server.inject({ method: 'GET', url: '/api/v1/admin/lookups/branches', headers: { authorization: 'Bearer test' } });
      assert.equal((await request()).statusCode, 403);
      granted = ['version.read'];
      assert.equal((await request()).statusCode, 403);
      granted = ['branch.read'];
      assert.equal((await request()).statusCode, 200);
      granted = ['body_style.create'];
      const created = await server.inject({ method: 'POST', url: '/api/v1/admin/lookups/body-styles',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Sedan', slug: 'sedan', imageUrl: 'https://example.com/sedan.png', status: 'active' } });
      assert.equal(created.statusCode, 201, created.body);
      assert.equal(created.json().name, 'Sedan');
      const unsupported = await server.inject({ method: 'POST', url: '/api/v1/admin/lookups/body-styles',
        headers: { authorization: 'Bearer test' }, payload: { name: 'Sai', group: 'budget' } });
      assert.equal(unsupported.statusCode, 400, unsupported.body);
      granted = ['body_style.update'];
      const updated = await server.inject({ method: 'PATCH', url: `/api/v1/admin/lookups/body-styles/${created.json().id}`,
        headers: { authorization: 'Bearer test' }, payload: { name: 'Sedan 4 cửa' } });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().name, 'Sedan 4 cửa');
      const empty = await server.inject({ method: 'PATCH', url: `/api/v1/admin/lookups/body-styles/${created.json().id}`,
        headers: { authorization: 'Bearer test' }, payload: {} });
      assert.equal(empty.statusCode, 400, empty.body);
    } finally { await app.close(); }
  } finally { await pg.close(); }
});
