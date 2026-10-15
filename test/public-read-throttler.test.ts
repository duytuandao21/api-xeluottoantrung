import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, Get, Module, Patch, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants.js';
import { PublicReadThrottlerGuard } from '../src/common/cache/public-read-throttler.guard.js';
import { PublicResponseCache } from '../src/common/cache/public-cache.js';
import { PublicCacheInterceptor } from '../src/common/cache/public-cache.interceptor.js';
import { PublicLookupsController } from '../src/modules/lookups/lookups.controller.js';
import { LookupsService } from '../src/modules/lookups/lookups.service.js';
import { PublicLeadsController } from '../src/modules/leads/leads.controller.js';
import { LeadsService } from '../src/modules/leads/leads.service.js';
import { ValuationPublicController } from '../src/modules/valuation/valuation-public.controller.js';
import { RecommendationPublicController } from '../src/modules/car-recommendations/controller.js';
import { OwnershipPublicController } from '../src/modules/ownership/controller.js';
import { Public, Permissions } from '../src/modules/auth/auth.decorators.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { PublicContentController } from '../src/modules/content/content.controller.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { ContentReadDiagnostics } from '../src/common/cache/content-read-diagnostics.js';

async function fixture(enabled = true, original = false) {
  let now = Date.now(), revision = 1;
  const cache = new PublicResponseCache({ enabled, now: () => now, random: () => 1 });
  const loads = new Map<string, number>();
  const diagnostics = new ContentReadDiagnostics();
  @Controller() class OtherController {
    @Public() @Get('cars') cars() { return { revision }; }
    @Public() @Get('services') services() { return { revision }; }
    @Public() @Get('articles') @Throttle({ default: { limit: 2, ttl: 60000 } }) articles() { return { revision }; }
    @Get('admin/fixture') @Permissions('car.read') admin() { return { revision }; }
    @Patch('admin/fixture') @Permissions('car.read') mutate() { return { revision: ++revision }; }
  }
  @Module({ imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 2 }])], controllers: [PublicLookupsController, PublicLeadsController, PublicContentController, OtherController], providers: [
    { provide: PublicResponseCache, useValue: cache },
    { provide: ContentReadDiagnostics, useValue: diagnostics },
    { provide: ContentService, useValue: { entries: async (group?: string) => {
      loads.set(`content:${group}`, (loads.get(`content:${group}`) ?? 0) + 1);
      return revision === 1 ? [{ key: 'fixture', title: group, revision }] : [];
    } } },
    { provide: LookupsService, useValue: { list: async (resource: string, query: { page: number; limit: number }) => {
      loads.set(resource, (loads.get(resource) ?? 0) + 1);
      return { data: [{ id: resource, name: `revision-${revision}`, slug: resource }], meta: { page: query.page, limit: query.limit, total: 1, totalPages: 1 } };
    } } },
    { provide: LeadsService, useValue: { create: () => ({ ok: true }), subscribe: () => ({ ok: true }) } },
    { provide: JwtVerifierService, useValue: { verify: async (token: string) => {
      if (!['admin', 'reader'].includes(token)) throw new UnauthorizedException(); return { id: token };
    } } },
    { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ permissions: id === 'admin' ? ['car.read'] : [] }) } },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: original ? ThrottlerGuard : PublicReadThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
  ] }) class TestModule {}
  const app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter({ trustProxy: ['127.0.0.1', '::1'] }), { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  const send = (path: string, options: { method?: 'GET' | 'POST' | 'PATCH'; headers?: Record<string, string>; ip?: string } = {}) =>
    app.getHttpAdapter().getInstance().inject({ method: options.method ?? 'GET', url: `/api/v1/${path}`,
      headers: options.headers, remoteAddress: options.ip ?? '127.0.0.1', ...(options.method === 'POST' ? {
        payload: path === 'leads' ? { type: 'callback', phone: '0900000000' } : { email: 'fixture@example.test' },
      } : {}) });
  return { app, cache, loads, diagnostics, send, expire: () => { now += 900001; } };
}

test('reproduces original guard: different lookup resources share the handler bucket and even cache hits get 429', async () => {
  const f = await fixture(true, true);
  try {
    assert.equal((await f.send('lookups/branches')).statusCode, 200);
    assert.equal((await f.send('lookups/body-styles')).statusCode, 200);
    assert.equal((await f.send('lookups/branches')).statusCode, 429);
    assert.equal(f.loads.get('branches'), 1);
  } finally { await f.app.close(); }
});

test('all SSR content groups warm independently and repeated renders do not exhaust the shared loopback quota', async () => {
  const f = await fixture();
  const groups = ['thiet-lap-chinh-sach-dieu-kien', 'thiet-lap-nut-goi', 'thiet-lap-mang-xa-hoi', 'thiet-lap-ung-dung',
    'thiet-lap-quy-trinh-ban-xe', 'thiet-lap-cac-buoc-mua-xe', 'thiet-lap-cac-buoc-ban-xe', 'thiet-lap-cac-buoc-len-doi',
    'thiet-lap-banner-dong-xe', 'thiet-lap-goi-y-nam-san-xuat', 'thiet-lap-tai-sao-chon', 'quan-ly-gioi-thieu'];
  try {
    for (let render = 0; render < 60; render++) for (const group of groups)
      assert.equal((await f.send(`content?group=${group}`)).statusCode, 200, `${group}, render ${render}`);
    for (const group of groups) assert.equal(f.loads.get(`content:${group}`), 1, group);
    // External readers retain the original shared controller/handler/IP bucket.
    for (let i = 0; i < 3; i++) assert.equal((await f.send(`content?group=${groups[i]}`, { ip: '198.51.100.30' })).statusCode, i < 2 ? 200 : 429);
    assert.equal((await f.send('admin/fixture', { method: 'PATCH', headers: { authorization: 'Bearer admin' } })).statusCode, 200);
    assert.deepEqual((await f.send(`content?group=${groups[0]}`)).json(), [], 'Disabled policies disappear immediately after Admin mutation');
    assert.equal(f.loads.get(`content:${groups[0]}`), 2);
    for (let i = 0; i < 20; i++) assert.deepEqual((await f.send(`content?group=${groups[0]}`)).json(), []);
    f.expire();
    assert.equal((await f.send(`content?group=${groups[0]}`)).statusCode, 429, 'Expired content still needs origin quota');
  } finally { await f.app.close(); }
});

test('fresh public cache hits survive shared SSR IP; misses/resources/expiry/invalidation stay guarded', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 30; i++) for (const resource of ['branches', 'body-styles'])
      assert.equal((await f.send(`lookups/${resource}`)).statusCode, 200);
    assert.equal(f.loads.get('branches'), 1); assert.equal(f.loads.get('body-styles'), 1);
    assert.equal((await f.send('lookups/branches?page=2')).statusCode, 200);
    const blocked = await f.send('lookups/branches?page=3');
    assert.equal(blocked.statusCode, 429); assert.ok(Number(blocked.headers['retry-after']) > 0);
    assert.equal((await f.send('lookups/branches')).statusCode, 200, 'Warm data remains usable after miss budget is exhausted');
    assert.equal((await f.send('lookups/transmissions')).statusCode, 200, 'A different resource has an independent bounded bucket');
    f.expire();
    assert.equal((await f.send('lookups/branches')).statusCode, 429, 'Expired entries cannot exempt an origin read');
    const before = await f.send('lookups/body-styles', { ip: '192.0.2.10' });
    assert.equal(before.json().data[0].name, 'revision-1');
    assert.equal((await f.send('admin/fixture', { method: 'PATCH', headers: { authorization: 'Bearer admin' } })).statusCode, 200);
    assert.equal(f.cache.snapshot().entries, 0);
    assert.equal((await f.send('lookups/body-styles', { ip: '192.0.2.11' })).json().data[0].name, 'revision-2');
  } finally { await f.app.close(); }
});

test('cache disabled still isolates resources without raising global limit', async () => {
  const f = await fixture(false);
  try {
    for (let i = 0; i < 2; i++) for (const resource of ['branches', 'body-styles'])
      assert.equal((await f.send(`lookups/${resource}`)).statusCode, 200);
    for (const resource of ['branches', 'body-styles']) assert.equal((await f.send(`lookups/${resource}`)).statusCode, 429);
  } finally { await f.app.close(); }
});

test('content cache off, credentials, unknown groups and forwarded external IPs retain limits and explain 429 safely', async () => {
  for (const enabled of [false, true]) {
    const f = await fixture(enabled);
    try {
      const path = 'content?group=thiet-lap-nut-goi';
      if (!enabled) {
        for (const group of ['thiet-lap-nut-goi', 'thiet-lap-chinh-sach-dieu-kien'])
          for (let i = 0; i < 3; i++) assert.equal((await f.send(`content?group=${group}`)).statusCode, i < 2 ? 200 : 429);
        const rows = f.diagnostics.drain()!.rows;
        assert.equal(rows.length, 2);
        assert(rows.every(row => row.received === 3 && row.charged === 3 && row.blocked === 1 && row.reasons.disabled === 3 && row.cache.bypass === 2 && row.limit === 2));
        continue;
      }
      await f.send(path);
      for (let i = 0; i < 3; i++) assert.equal((await f.send(path, { headers: { 'x-forwarded-for': '198.51.100.71' } })).statusCode, i < 2 ? 200 : 429,
        'Trusted proxy forwarding an external tracker cannot exempt cache hits');
      for (let i = 0; i < 3; i++) assert.equal((await f.send(path, { headers: { cookie: 'customer=secret-cookie' } })).statusCode, i < 2 ? 200 : 429);
      for (let i = 0; i < 3; i++) assert.equal((await f.send(`content?group=unknown-${i}`)).statusCode, 429, 'Unknown groups share the exhausted handler/IP bucket with credentialed requests');
      const metrics = f.diagnostics.drain()!;
      assert(metrics.rows.some(row => row.reasons.credentials === 3 && row.blocked === 1));
      assert(metrics.rows.some(row => row.trackerScope === 'external' && row.blocked === 1));
      assert(metrics.rows.some(row => row.group === 'other' && row.reasons['no-policy'] === 3));
      assert(!/198\.51|127\.0|secret-cookie|customer|unknown-/.test(JSON.stringify(metrics)));
      assert.equal(f.diagnostics.drain(), undefined, 'Draining a window does not repeat old counts');
    } finally { await f.app.close(); }
  }
});

test('content diagnostics distinguish warm hits, expiry and active mutation', async () => {
  const f = await fixture();
  try {
    const path = 'content?group=thiet-lap-chinh-sach-dieu-kien';
    await f.send(path); await f.send(path);
    const warm = f.diagnostics.drain()!.rows[0];
    assert.equal(warm.cache.miss, 1); assert.equal(warm.cache.hit, 1);
    assert.equal(warm.charged, 1); assert.equal(warm.exempt, 1);
    assert.equal(warm.ttlMs, 300000); assert(warm.maxRemainingMs > 0 && warm.maxRemainingMs <= 300000);
    f.expire(); await f.send(path);
    assert.equal(f.diagnostics.drain()!.rows[0].reasons.expired, 1);
    f.cache.beginMutation();
    assert.equal((await f.send(path)).statusCode, 429);
    f.cache.endMutation();
    assert.equal(f.diagnostics.drain()!.rows[0].reasons.mutating, 1);
  } finally { await f.app.close(); }
});

test('cookies/auth/search/live reads/explicit GET limits/Admin and public POST limits cannot bypass via cache or spoofed XFF', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.send('lookups/branches')).statusCode, 200);
    const privateHeaders: Record<string, string>[] = [{ cookie: 'session=private' }, { authorization: 'Bearer private' }, {}];
    for (const [index, headers] of privateHeaders.entries()) {
      const path = index === 2 ? 'lookups/branches?search=private' : 'lookups/branches';
      for (let i = 0; i < 3; i++) assert.equal((await f.send(path, { headers, ip: `192.0.2.${index + 20}` })).statusCode, i < 2 ? 200 : 429);
    }
    for (const path of ['cars', 'articles']) for (let i = 0; i < 3; i++)
      assert.equal((await f.send(path, { headers: { 'x-forwarded-for': `203.0.113.${i}` }, ip: '198.51.100.20' })).statusCode, i < 2 ? 200 : 429);
    for (let i = 0; i < 3; i++) assert.equal((await f.send('services', { ip: '198.51.100.21' })).statusCode, i < 2 ? 200 : 429,
      'External anonymous cache hits retain their original limit');
    assert.equal((await f.send('admin/fixture')).statusCode, 401);
    assert.equal((await f.send('admin/fixture', { headers: { authorization: 'Bearer reader' } })).statusCode, 403);
    for (let i = 0; i < 3; i++) assert.equal((await f.send('admin/fixture', { headers: { authorization: 'Bearer admin' } })).statusCode, i < 2 ? 200 : 429);
    for (const path of ['leads', 'newsletter-subscriptions']) {
      for (let i = 0; i < 6; i++) assert.equal((await f.send(path, { method: 'POST' })).statusCode, i < 5 ? 201 : 429);
    }
  } finally { await f.app.close(); }
});

test('production spam-sensitive endpoint overrides remain exactly unchanged', () => {
  const expected: [object, string, number][] = [
    [PublicLeadsController.prototype, 'create', 5], [PublicLeadsController.prototype, 'subscribe', 5],
    [ValuationPublicController.prototype, 'estimate', 20], [ValuationPublicController.prototype, 'contact', 5],
    [RecommendationPublicController.prototype, 'submit', 20], [RecommendationPublicController.prototype, 'resume', 30],
    [RecommendationPublicController.prototype, 'results', 30], [RecommendationPublicController.prototype, 'event', 60],
    [OwnershipPublicController.prototype, 'config', 40], [OwnershipPublicController.prototype, 'calculate', 15],
  ];
  for (const [prototype, method, limit] of expected) {
    const handler: unknown = Reflect.get(prototype, method);
    assert.equal(typeof handler, 'function', method);
    assert.equal(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler as object), limit, method);
    assert.equal(Reflect.getMetadata(THROTTLER_TTL + 'default', handler as object), 60000, method);
  }
});
