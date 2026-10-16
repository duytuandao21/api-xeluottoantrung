import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, Global, Module, Patch, ServiceUnavailableException, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants.js';
import { PublicContentController } from '../src/modules/content/content.controller.js';
import { PublicHomeContentController } from '../src/modules/content/home-content.controller.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { PublicReadThrottlerGuard } from '../src/common/cache/public-read-throttler.guard.js';
import { PublicCacheInterceptor } from '../src/common/cache/public-cache.interceptor.js';
import { PublicResponseCache } from '../src/common/cache/public-cache.js';
import { publicCachePolicy } from '../src/common/cache/public-cache.policy.js';
import { homeContentGroups } from '../src/common/cache/home-content-read.js';
import { ContentReadDiagnostics } from '../src/common/cache/content-read-diagnostics.js';
import { Permissions } from '../src/modules/auth/auth.decorators.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { createQueryCacheFixture } from './fixtures/query-cache-fixture.js';
import { DatabaseService } from '../src/database/database.service.js';
import { ContentModule } from '../src/modules/content/content.module.js';
import { PublicCacheModule } from '../src/common/cache/public-cache.module.js';

async function fixture(enabled = true) {
  let now = Date.now(), revision = 1, failure: string | undefined, pending: (() => Promise<void>) | undefined;
  let active = 0, peak = 0;
  const loads = new Map<string, number>(), cache = new PublicResponseCache({ enabled, now: () => now, random: () => 1 });
  const diagnostics = new ContentReadDiagnostics();
  @Controller('admin/home-test') class AdminController {
    @Patch() @Permissions('content.update') mutate() { revision++; return { revision }; }
  }
  @Module({ imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 2 }])],
    controllers: [PublicContentController, PublicHomeContentController, AdminController], providers: [
      { provide: PublicResponseCache, useValue: cache }, { provide: ContentReadDiagnostics, useValue: diagnostics },
      { provide: ContentService, useValue: { entries: async (group: string) => {
        loads.set(group, (loads.get(group) || 0) + 1); const value = revision; active++; peak = Math.max(peak, active);
        try { await pending?.(); if (failure === group) throw new ServiceUnavailableException('private fixture details');
          return [{ key: 'fixture', title: group, revision: value }]; } finally { active--; }
      } } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => {
        if (!['admin', 'viewer'].includes(token)) throw new UnauthorizedException(); return { id: token };
      } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ permissions: id === 'admin' ? ['content.update'] : [] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
      { provide: APP_GUARD, useClass: PublicReadThrottlerGuard }, { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
    ] }) class TestModule {}
  const app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter({ trustProxy: ['127.0.0.1', '::1'] }), { logger: false });
  app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const send = (path = 'content/home', options: { method?: 'GET' | 'PATCH'; ip?: string; headers?: Record<string, string> } = {}) =>
    app.getHttpAdapter().getInstance().inject({ method: options.method || 'GET', url: `/api/v1/${path}`, remoteAddress: options.ip || '127.0.0.1', headers: options.headers });
  return { app, send, cache, loads, diagnostics, expire: () => { now += 300001; }, fail: (group?: string) => { failure = group; },
    hold: (wait?: () => Promise<void>) => { pending = wait; }, peak: () => peak };
}

test('home view shares exactly nine original keys/TTL; warm loopback reads remain exempt and public payloads match', async () => {
  const f = await fixture();
  try {
    const response = await f.send(); assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
    const groups = response.json().groups; assert.deepEqual(Object.keys(groups), [...homeContentGroups]);
    assert.equal(f.peak(), 1, 'Each composition occupies at most one origin read at a time');
    for (let round = 0; round < 10; round++) assert.equal((await f.send()).statusCode, 200);
    for (const group of homeContentGroups) {
      assert.deepEqual(groups[group], { ok: true, data: (await f.send(`content?group=${group}`)).json() });
      assert.equal(f.loads.get(group), 1);
      const policy = publicCachePolicy(`/api/v1/content?group=${group}`)!;
      assert.equal(policy.ttlMs, 300000); assert(f.cache.hasFresh(policy.key));
    }
    assert.equal(f.cache.snapshot().entries, 9); assert.equal(publicCachePolicy('/api/v1/content/home'), undefined);
    assert.equal((await f.send('content/home?group=admin-only')).statusCode, 400);
    assert.equal((await f.send('content/home?group=x&group=y')).statusCode, 400);
    assert.equal((await f.send('content/home?unknown=value')).statusCode, 429, 'Malformed queries cannot bypass rate limiting');
    assert.equal(f.cache.snapshot().entries, 9);
  } finally { await f.app.close(); }
});

test('composition and legacy reads spend the same cold/disabled/expiry group quotas, not a new handler budget', async () => {
  for (const enabled of [true, false]) {
    const f = await fixture(enabled);
    try {
      for (let i = 0; i < 2; i++) {
        if (enabled) f.cache.invalidate();
        assert(Object.values((await f.send()).json().groups).every((item) => (item as { ok: boolean }).ok));
      }
      if (enabled) f.expire();
      const blocked = (await f.send()).json().groups;
      for (const group of homeContentGroups) {
        assert.equal(blocked[group].ok, false); assert.equal(blocked[group].status, 429); assert(blocked[group].retryAfterSeconds > 0);
        assert.equal((await f.send(`content?group=${group}`)).statusCode, 429);
        assert.equal(f.loads.get(group), 2);
      }
    } finally { await f.app.close(); }
  }
});

test('external, forwarded and credentialed reads retain the original shared handler/IP budget and cannot bypass using the view', async () => {
  const cases: { ip?: string; headers?: Record<string, string> }[] = [{ ip: '198.51.100.40' }, { headers: { 'x-forwarded-for': '198.51.100.41' } },
    { headers: { cookie: 'fixture=private' } }, { headers: { authorization: 'Bearer fixture-public-reader' } }];
  for (const options of cases) {
    const f = await fixture();
    try {
      await f.send(); // Warm all groups as anonymous loopback.
      const groups = (await f.send('content/home', options)).json().groups;
      assert.equal(Object.values(groups).filter(item => (item as { ok: boolean }).ok).length, 2);
      assert.equal((await f.send(`content?group=${homeContentGroups[0]}`, options)).statusCode, 429);
    } finally { await f.app.close(); }
  }
});

test('an explicit limit on the source handler also protects warm composed reads', async () => {
  const handler = PublicContentController.prototype.list;
  Reflect.defineMetadata(THROTTLER_LIMIT + 'default', 1, handler);
  Reflect.defineMetadata(THROTTLER_TTL + 'default', 60000, handler);
  const f = await fixture();
  try {
    assert(Object.values((await f.send()).json().groups).every(item => (item as { ok: boolean }).ok));
    assert(Object.values((await f.send()).json().groups).every(item => (item as { status: number }).status === 429));
  } finally { Reflect.deleteMetadata(THROTTLER_LIMIT + 'default', handler); Reflect.deleteMetadata(THROTTLER_TTL + 'default', handler); await f.app.close(); }
});

test('Admin authentication/RBAC and synchronous mutation invalidation are unchanged; errors are per-source and never cached', async () => {
  const f = await fixture();
  try {
    await f.send();
    assert.equal((await f.send('admin/home-test', { method: 'PATCH' })).statusCode, 401);
    assert.equal((await f.send('admin/home-test', { method: 'PATCH', headers: { authorization: 'Bearer viewer' } })).statusCode, 403);
    assert.equal((await f.send('admin/home-test', { method: 'PATCH', headers: { authorization: 'Bearer admin' } })).statusCode, 200);
    f.fail(homeContentGroups[0]);
    const failed = await f.send(); assert.equal(failed.statusCode, 200);
    assert.deepEqual(failed.json().groups[homeContentGroups[0]], { ok: false, status: 503 });
    assert(!failed.body.includes('private fixture details'));
    assert.equal(failed.json().groups[homeContentGroups[1]].data[0].revision, 2);
    assert(!f.cache.hasFresh(publicCachePolicy(`/api/v1/content?group=${homeContentGroups[0]}`)!.key));
    f.fail();
    // Its two cold quota units are spent, so recovery is correctly rate-limited.
    assert.equal((await f.send()).json().groups[homeContentGroups[0]].status, 429);
  } finally { await f.app.close(); }
});

test('pending reads from before an Admin commit cannot repopulate the new epoch; post-commit view is fresh', async () => {
  const f = await fixture();
  try {
    let release!: () => void;
    const barrier = new Promise<void>(done => { release = done; }); f.hold(() => barrier);
    const first = f.send();
    for (let i = 0; f.loads.size < 1; i++) { assert(i < 100); await new Promise(done => setTimeout(done, 5)); }
    await f.send('admin/home-test', { method: 'PATCH', headers: { authorization: 'Bearer admin' } });
    f.hold(); release(); await first;
    const fresh = (await f.send()).json().groups;
    for (const group of homeContentGroups) assert.equal(fresh[group].data[0].revision, 2, group);
  } finally { await f.app.close(); }
});

test('real SQL/Admin writes immediately update the view, exclude inactive CMS, and preserve live cars/brands/accessories/SEO', async () => {
  const f = await createQueryCacheFixture();
  const api = await f.createApp(true, 0, true);
  const send = async (path: string, method = 'GET', body?: unknown, admin = false) => {
    const response = await fetch(`${api.url}/api/v1/${path}`, { method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(admin ? { authorization: 'Bearer phase3-local' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data: unknown = response.status === 204 ? null : await response.json();
    assert(response.ok, `${method} ${path}: ${response.status}`); return data as Record<string, unknown>;
  };
  try {
    const view = await send('content/home');
    const initial = view.groups as Record<string, { data: unknown }>;
    for (const group of homeContentGroups) assert.deepEqual(initial[group].data, await send(`content?group=${group}`));
    const group = 'thiet-lap-cac-buoc-mua-xe';
    await send('admin/content', 'POST', { group, key: 'composition-only', title: 'Private inactive fixture', status: 'inactive' }, true);
    assert(!JSON.stringify(await send('content/home')).includes('Private inactive fixture'));
    await send(`admin/content/${group}/composition-only`, 'PATCH', { status: 'active', title: 'Public revision two' }, true);
    assert(JSON.stringify(await send('content/home')).includes('Public revision two'));
    await send(`admin/content/${group}/composition-only`, 'DELETE', undefined, true);
    assert(!JSON.stringify(await send('content/home')).includes('Public revision two'));
    const target = f.cars[0];
    await send(`admin/cars/${target.id}`, 'PATCH', { price: 321000000, status: 'sold' }, true);
    const cars = await send('cars?limit=100');
    const changed = (cars.data as { slug: string; price: number; status: string }[]).find(car => car.slug === target.slug);
    assert.equal(changed?.price, 321000000);
    assert.equal(changed?.status, 'sold', 'Existing public listing includes sold cars with their updated status');
    const brands = await send('brands') as unknown as { slug: string; stockCount: number }[];
    assert(!brands.some(brand => brand.slug === f.brands[0].slug && brand.stockCount > 0));
    await send('admin/seo', 'PUT', { routePath: '/', metaTitle: 'Updated SEO after Admin' }, true);
    assert.equal((await send('seo?route=/')).metaTitle, 'Updated SEO after Admin');
    const accessoryBrand = await send('admin/collections/accessory-brands', 'POST', { name: 'Fixture accessory brand', status: 'active' }, true);
    const accessory = await send('admin/collections/accessories', 'POST', { name: 'Fixture accessory', brandId: accessoryBrand.id,
      price: 1000000, imageUrl: '/images/logo.png', status: 'active' }, true);
    await send('accessories');
    await send(`admin/collections/accessories/${accessory.id}`, 'PATCH', { price: 2000000 }, true);
    const accessories = await send('accessories');
    assert.equal((accessories.data as { id: string; price: number }[]).find(item => item.id === accessory.id)?.price, 2000000);
    const cmsCacheEntries = api.cache.snapshot().entries;
    await send('cars'); await send('brands'); await send('accessories');
    assert.equal(api.cache.snapshot().entries, cmsCacheEntries, 'Live reads do not gain cache entries');
  } finally { await api.app.close(); await f.pg.close(); }
});

test('production ContentModule wiring reuses one cache module/interceptor without a nested pending-read deadlock', async () => {
  const f = await createQueryCacheFixture();
  @Global() @Module({ providers: [{ provide: DatabaseService, useValue: f.connection }], exports: [DatabaseService] }) class IsolatedDatabaseModule {}
  @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => ({
    PUBLIC_CACHE_ENABLED: true, PUBLIC_CACHE_MODE: 'single-process', PUBLIC_CACHE_PROCESS_COUNT: 1,
  })] }), IsolatedDatabaseModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }]), PublicCacheModule, ContentModule],
    providers: [{ provide: APP_GUARD, useClass: PublicReadThrottlerGuard }] }) class WiringModule {}
  const app = await NestFactory.create<NestFastifyApplication>(WiringModule, new FastifyAdapter(), { logger: false });
  try {
    app.setGlobalPrefix('api/v1'); await app.init(); await app.getHttpAdapter().getInstance().ready();
    const response = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/api/v1/content/home', remoteAddress: '127.0.0.1' });
    assert.equal(response.statusCode, 200);
    assert.equal(Object.values(response.json().groups).filter(item => (item as { ok: boolean }).ok).length, 9);
    assert.equal(app.get(PublicResponseCache).snapshot().entries, 9);
    assert.equal(publicCachePolicy('/api/v1/content/home'), undefined);
  } finally { await app.close(); await f.pg.close(); }
});
