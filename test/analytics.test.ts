import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AnalyticsService } from '../src/modules/dashboard/analytics.service.js';
import { ANALYTICS_TTL_MS } from '../src/modules/dashboard/analytics.types.js';
import { CloudflareClient, type GraphResult, type Schema, type SchemaType } from '../src/modules/dashboard/cloudflare.client.js';
import { AdminAnalyticsController } from '../src/modules/dashboard/analytics.controller.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { validateEnv } from '../src/config/env.js';
import { AnalyticsCarsService } from '../src/modules/dashboard/analytics-cars.service.js';
import type { AnalyticsRow } from '../src/modules/dashboard/analytics.types.js';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';

const noCarLabels = { resolve: async () => [] } as unknown as AnalyticsCarsService;

// Small schema fixture follows the live introspection; no external API or database.
function schemaFixture(): Schema {
  const schema: Schema = new Map();
  const field = (name: string, type = 'string') => ({ name, type: { name: type }, args: [] });
  const type = (name: string, fields: string[] = []): SchemaType => {
    const result = { name, fields: fields.map(name => field(name)), inputFields: [], enumValues: [] };
    schema.set(name, result); return result;
  };
  type('Settings', ['enabled', 'notOlderThan', 'maxDuration', 'maxPageSize', 'maxNumberOfFields', 'availableFields']);
  type('ZoneSettings', ['httpRequestsAdaptiveGroups', 'firewallEventsAdaptiveGroups']);
  type('AccountSettings', ['rumPageloadEventsAdaptiveGroups']);
  for (const [scope, node, model, dimensions, sums] of [
    ['zone', 'httpRequestsAdaptiveGroups', 'Http', ['clientRequestHTTPHost', 'requestSource', 'cacheStatus', 'clientCountryName', 'clientRequestPath', 'datetimeMinute', 'datetimeHour', 'date'], ['edgeResponseBytes', 'visits']],
    ['zone', 'firewallEventsAdaptiveGroups', 'Firewall', ['clientRequestHTTPHost', 'action'], []],
    ['account', 'rumPageloadEventsAdaptiveGroups', 'Rum', ['requestHost', 'requestPath', 'deviceType', 'countryName', 'datetimeMinute', 'datetimeHour'], ['visits']],
  ] as const) {
    if (!schema.has(scope)) type(scope);
    schema.get(scope)!.fields.push({ name: node, type: { name: null, ofType: { name: null, ofType: { name: null, ofType: { name: model } } } }, args: [
      { name: 'limit', type: { name: 'uint64' } }, { name: 'filter', type: { name: `${model}Filter` } },
      { name: 'orderBy', type: { name: `${model}Order` } },
    ] });
    const modelType = type(model, ['count']);
    modelType.fields.push(field('dimensions', `${model}Dimensions`), field('sum', `${model}Sum`), field('avg', `${model}Avg`));
    type(`${model}Dimensions`, [...dimensions]); type(`${model}Sum`, [...sums]); type(`${model}Avg`, ['sampleInterval']);
    type(`${model}Filter`).inputFields = [...dimensions, 'datetime_geq', 'datetime_lt'].map(name => ({ name, type: { name: 'string' } }));
    type(`${model}Order`).enumValues = ['count_DESC', 'datetimeMinute_ASC', 'datetimeHour_ASC', 'date_ASC'].map(name => ({ name }));
  }
  return schema;
}
class FakeCloudflare extends CloudflareClient {
  schema = schemaFixture();
  calls: { query: string; variables: Record<string, unknown> }[] = [];
  discoveryCalls = 0;
  denied = new Set(['firewallEventsAdaptiveGroups']);
  missing = new Set<string>();
  maxDuration = 2592000;
  retention = 2678400;
  failHttp = false;
  partial = false;
  emptyRum = false;
  rumTraffic = [{ count: 30, dimensions: { datetimeMinute: '2026-10-20T00:00:00Z', datetimeHour: '2026-10-20T00:00:00Z' }, sum: { visits: 9 } }];
  constructor() { super(new ConfigService({ CLOUDFLARE_API_TOKEN: 'secret-fixture', CLOUDFLARE_ZONE_ID: 'a'.repeat(32), CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) })); }
  override async accountId() { return this.account; }
  override async types(names: string[]): Promise<Schema> {
    this.discoveryCalls++;
    return new Map(names.filter(name => this.schema.has(name)).map(name => [name, this.schema.get(name)!]));
  }
  override async graphql<T>(query: string, variables: Record<string, unknown>): Promise<GraphResult<T>> {
    this.calls.push({ query, variables });
    const scope = query.includes('accounts(') ? 'accounts' : 'zones';
    const fields = new Set(['count']);
    for (const type of this.schema.values()) for (const f of type.fields) {
      if (type.name.endsWith('Dimensions')) fields.add(`dimensions_${f.name}`);
      if (type.name.endsWith('Sum')) fields.add(`sum_${f.name}`);
      if (type.name.endsWith('Avg')) fields.add(`avg_${f.name}`);
    }
    const data: Record<string, unknown> = {};
    if (query.includes('{settings{')) {
      data.settings = Object.fromEntries(['httpRequestsAdaptiveGroups', 'firewallEventsAdaptiveGroups', 'rumPageloadEventsAdaptiveGroups'].map(node => [node, {
        enabled: !this.denied.has(node), maxDuration: this.maxDuration, notOlderThan: this.retention,
        maxNumberOfFields: 40, maxPageSize: 10000, availableFields: [...fields].filter(field => !this.missing.has(field)),
      }]));
    } else {
      const filter = variables.filter as Record<string, unknown>;
      assert.equal(filter[scope === 'zones' ? 'clientRequestHTTPHost' : 'requestHost'], 'xeluottoantrung.com');
      assert.equal(Date.parse(String(filter.datetime_lt)) - Date.parse(String(filter.datetime_geq)) <= this.maxDuration * 1000, true);
      if (scope === 'zones' && query.includes('httpRequestsAdaptiveGroups')) {
        if (this.failHttp) throw new Error('secret-fixture must never leak');
        assert.equal(filter.requestSource, 'eyeball');
        data.total = [{ count: 120, sum: { edgeResponseBytes: 2048, visits: 15 }, avg: { sampleInterval: 2 } }];
        data.trend = [{ count: 120, dimensions: { datetimeMinute: '2026-10-20T00:00:00Z', datetimeHour: '2026-10-20T00:00:00Z', date: '2026-10-20' } }];
        data.countries = [{ count: 120, dimensions: { clientCountryName: 'VN' } }];
        data.paths = [{ count: 120, dimensions: { clientRequestPath: '/san-pham' } }];
        data.cache = [{ count: 80, dimensions: { cacheStatus: 'hit' } }, { count: 20, dimensions: { cacheStatus: 'miss' } }, { count: 20, dimensions: { cacheStatus: 'dynamic' } }];
        if (this.partial) delete data.paths;
      } else if (scope === 'accounts') {
        data.total = this.emptyRum ? [] : [{ count: 30, sum: { visits: 9 } }];
        data.trend = this.emptyRum ? [] : this.rumTraffic;
        data.devices = this.emptyRum ? [] : [{ count: 20, dimensions: { deviceType: 'mobile' } }, { count: 10, dimensions: { deviceType: 'desktop' } }];
        data.countries = this.emptyRum ? [] : [{ count: 30, dimensions: { countryName: 'VN' } }];
        data.pages = this.emptyRum ? [] : [{ count: 20, dimensions: { requestPath: '/toyota-vios-2025' } }, { count: 10, dimensions: { requestPath: '/' } }];
      } else {
        data.total = [{ count: 3 }]; data.actions = [{ count: 3, dimensions: { action: 'block' } }];
      }
    }
    return { data: { viewer: { [scope]: [data] } } as T, errors: this.partial ? [{ message: 'upstream-sensitive-error' }] : null };
  }
}

test('analytics: exact hostname, truthful metric sources, 10-minute cache and cold single-flight', async context => {
  let now = Date.now(); context.mock.method(Date, 'now', () => now);
  const client = new FakeCloudflare(), service = new AnalyticsService(client, noCarLabels);
  const results = await Promise.all(Array.from({ length: 15 }, () => service.snapshot('24h')));
  assert(results.every(value => value === results[0]));
  const value = results[0];
  assert.equal(value.http.requests, 120); assert.equal(value.http.bytes, 2048);
  assert.equal(value.http.visits, 15); assert.equal(value.webAnalytics.pageViews, 30); assert.equal(value.webAnalytics.visits, 9);
  assert.equal(value.webAnalytics.uniqueVisitors, null);
  assert.equal(value.webAnalytics.trend?.[0].count, 30, 'Customer trend uses RUM page views, never 120 HTTP requests');
  assert.equal(value.webAnalytics.trend?.[0].visits, 9);
  assert.equal(value.webAnalytics.devices?.[0].name, 'mobile');
  assert.equal(value.webAnalytics.countries?.[0].name, 'VN');
  assert.equal(value.webAnalytics.pages?.[0].name, '/toyota-vios-2025');
  assert(!JSON.stringify(value.webAnalytics.pages).includes('/san-pham'), 'Do not reuse HTTP path counts as page views');
  assert.equal(value.http.cacheHitRatio, 80 / 120);
  assert.equal(value.security.events, null); assert.match(value.security.reason!, /không được cấp quyền/);
  assert.equal(client.calls.filter(call => call.query.includes('total:httpRequests')).length, 1);
  assert(!client.calls.some(call => call.query.includes('total:firewall')));
  assert(!JSON.stringify(value).includes('secret-fixture'));
  now += ANALYTICS_TTL_MS - 1; await service.snapshot('24h');
  assert.equal(client.calls.filter(call => call.query.includes('total:httpRequests')).length, 1);
  now += 2; await service.snapshot('24h');
  assert.equal(client.calls.filter(call => call.query.includes('total:httpRequests')).length, 2);
});

test('analytics: actual plan limits constrain options and WAF can be available for a different token', async () => {
  const client = new FakeCloudflare(); client.maxDuration = 86400; client.retention = 172800; client.denied.clear();
  const service = new AnalyticsService(client, noCarLabels), data = await service.snapshot();
  assert.deepEqual(data.availableRanges.map(row => row.id), ['1h', '6h', '24h']);
  assert.equal(data.security.events, 3); assert.equal(data.security.actions?.[0].name, 'block');
  await assert.rejects(service.snapshot('7d'), BadRequestException);
  await assert.rejects(service.snapshot('365d'), BadRequestException);
});

test('analytics: unsupported fields never queried; missing hostname filter fails closed', async () => {
  const client = new FakeCloudflare(); client.missing.add('dimensions_cacheStatus'); client.missing.add('sum_edgeResponseBytes');
  const value = await new AnalyticsService(client, noCarLabels).snapshot('1h');
  assert.equal(value.http.cache, null); assert.equal(value.http.bytes, null);
  const query = client.calls.find(call => call.query.includes('total:httpRequests'))!.query;
  assert(!query.includes('cache:')); assert(!query.includes('edgeResponseBytes'));
  const unsafe = new FakeCloudflare(); unsafe.schema.get('HttpFilter')!.inputFields = [];
  const denied = await new AnalyticsService(unsafe, noCarLabels).snapshot();
  assert.match(denied.http.reason!, /hostname/); assert.equal(denied.http.requests, null);
  assert(!unsafe.calls.some(call => call.query.includes('total:httpRequests')));
});

test('analytics: upstream failure and partial data remain N/A; independent RUM survives', async () => {
  const client = new FakeCloudflare(); client.failHttp = true;
  const failed = await new AnalyticsService(client, noCarLabels).snapshot();
  assert.equal(failed.http.requests, null); assert.equal(failed.webAnalytics.pageViews, 30);
  assert(!JSON.stringify(failed).includes('secret-fixture'));
  const partial = new FakeCloudflare(); partial.partial = true; partial.emptyRum = true;
  const value = await new AnalyticsService(partial, noCarLabels).snapshot();
  assert.equal(value.http.requests, 120); assert.equal(value.http.paths, null);
  assert.equal(value.webAnalytics.pageViews, null); assert.match(value.webAnalytics.reason!, /Chưa có dữ liệu/);
});

test('analytics: absent credentials do not break other modules and never trigger Cloudflare', async () => {
  const client = new CloudflareClient(new ConfigService({}));
  client.graphql = async () => { throw new Error('Must not call remote'); };
  const data = await new AnalyticsService(client, noCarLabels).snapshot();
  assert.equal(data.http.requests, null); assert.equal(data.security.events, null); assert.deepEqual(data.availableRanges, []);
  assert.match(data.http.reason!, /Chưa cấu hình/);
});

test('analytics: RUM missing fields stay N/A; DB label failure does not discard visits or pages', async () => {
  const client = new FakeCloudflare(); client.missing.add('dimensions_deviceType');
  const lookup = { resolve: async () => { throw new Error('DB details must not leak'); } } as unknown as AnalyticsCarsService;
  const data = await new AnalyticsService(client, lookup).snapshot('1h');
  assert.equal(data.webAnalytics.devices, null);
  const query = client.calls.find(call => call.query.includes('total:rumPageloadEvents'))!.query;
  assert(!query.includes('devices:'));
  assert.equal(data.webAnalytics.pageViews, 30); assert.equal(data.webAnalytics.visits, 9);
  assert.equal(data.webAnalytics.pages?.[0].count, 20);
  assert.equal(data.webAnalytics.cars, null); assert.match(data.webAnalytics.carsReason!, /Chưa đối chiếu/);
  assert(!JSON.stringify(data).includes('DB details'));
});

test('analytics: daily visits/page views use Vietnamese day boundaries and do not sum uniques', async () => {
  const client = new FakeCloudflare();
  client.rumTraffic = [
    { count: 3, dimensions: { datetimeMinute: '', datetimeHour: '2026-10-19T16:00:00Z' }, sum: { visits: 1 } },
    { count: 5, dimensions: { datetimeMinute: '', datetimeHour: '2026-10-19T17:00:00Z' }, sum: { visits: 2 } },
    { count: 7, dimensions: { datetimeMinute: '', datetimeHour: '2026-10-20T00:00:00Z' }, sum: { visits: 4 } },
  ];
  const data = await new AnalyticsService(client, noCarLabels).snapshot('7d');
  assert.deepEqual(data.webAnalytics.trend, [{ name: '2026-10-19', count: 3, visits: 1 }, { name: '2026-10-20', count: 12, visits: 6 }]);
  assert.equal(data.webAnalytics.uniqueVisitors, null);
});

test('analytics: car names use one bounded lookup; cache coalesces label resolution', async () => {
  const client = new FakeCloudflare(); let calls = 0;
  const lookup = { resolve: async (paths: AnalyticsRow[]) => {
    calls++; assert.equal(paths[0].name, '/toyota-vios-2025');
    return [{ name: 'Toyota Vios 2025', path: '/toyota-vios-2025', count: paths[0].count }];
  } } as unknown as AnalyticsCarsService;
  const service = new AnalyticsService(client, lookup);
  const results = await Promise.all([service.snapshot('1h'), service.snapshot('1h')]);
  assert.equal(calls, 1); assert.equal(results[0].webAnalytics.cars?.[0].name, 'Toyota Vios 2025');
});

test('analytics car labels: indexed slug query, canonical paths, duplicates and deleted/missing cars', async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cars(slug text PRIMARY KEY,name text NOT NULL,deleted_at timestamptz); INSERT INTO cars VALUES ('toyota-vios-2025','Toyota Vios 2025',NULL),('removed','Removed',now()),('not-viewed','Not viewed',NULL)");
    let selects = 0;
    const db = drizzle(pg, { logger: { logQuery: () => { selects++; } } });
    const lookup = new AnalyticsCarsService({ db } as unknown as DatabaseService);
    assert.deepEqual(await lookup.resolve([{ name: '/', count: 100 }]), []); assert.equal(selects, 0);
    const result = await lookup.resolve([
      { name: '/toyota-vios-2025', count: 20 }, { name: '/toyota-vios-2025/', count: 3 },
      { name: '/removed', count: 200 }, { name: '/missing', count: 300 },
      { name: '/assets/site.css', count: 400 }, { name: '/%E0%A4%A', count: 1 },
    ]);
    assert.deepEqual(result, [{ name: 'Toyota Vios 2025', path: '/toyota-vios-2025', count: 23 }]);
    assert.equal(selects, 1, 'Single SQL query, no per-car HTTP or database reads');
  } finally { await pg.close(); }
});

test('analytics client: network/HTTP errors never forward secrets; explicit account skips Zone Read', async context => {
  const client = new CloudflareClient(new ConfigService({ CLOUDFLARE_API_TOKEN: 'secret-fixture', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32) }));
  assert.equal(await client.accountId(), 'b'.repeat(32));
  context.mock.method(globalThis, 'fetch', async () => new Response('secret-fixture forbidden', { status: 403 }));
  await assert.rejects(client.graphql('{}'), error => error instanceof Error && !error.message.includes('secret-fixture'));
  context.mock.method(globalThis, 'fetch', async () => new Response('secret-fixture', { status: 429 }));
  await assert.rejects(client.graphql('{}'), /giới hạn truy vấn/);
});

test('analytics configuration: preserve server-only options and reject non-public hostname/invalid IDs', () => {
  const base = { DATABASE_URL: 'postgresql://localhost/test', SUPABASE_URL: 'https://example.supabase.co' };
  const config = validateEnv({ ...base, CLOUDFLARE_API_TOKEN: 'backend-only', CLOUDFLARE_ZONE_ID: 'a'.repeat(32) });
  assert.equal(config.CLOUDFLARE_API_TOKEN, 'backend-only');
  assert.equal(config.CLOUDFLARE_ANALYTICS_HOSTNAME, 'xeluottoantrung.com');
  for (const hostname of ['https://toantrungxeluot.io.vn', '*.io.vn', 'admin.toantrungxeluot.io.vn', 'api.toantrungxeluot.io.vn'])
    assert.throws(() => validateEnv({ ...base, CLOUDFLARE_ANALYTICS_HOSTNAME: hostname }));
  assert.throws(() => validateEnv({ ...base, CLOUDFLARE_ZONE_ID: 'invalid' }));
});

test('analytics endpoint: actual guards reject anonymous/dashboard-only callers; private no-store and validated range', async () => {
  let permissions: string[] = [], calls = 0;
  @Module({ controllers: [AdminAnalyticsController], providers: [
    { provide: AnalyticsService, useValue: { snapshot: async () => { calls++; return { http: { requests: 123 } }; } } },
    { provide: JwtVerifierService, useValue: { verify: async () => ({ id: 'fixture' }) } },
    { provide: AdminAccessService, useValue: { forAuthUser: async () => ({ permissions }) } },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
  ] }) class TestAnalyticsModule {}
  const app = await NestFactory.create<NestFastifyApplication>(TestAnalyticsModule, new FastifyAdapter(), { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const server = app.getHttpAdapter().getInstance();
    const url = '/api/v1/admin/dashboard/analytics';
    const headers = { authorization: 'Bearer fixture' };
    assert.equal((await server.inject({ method: 'GET', url })).statusCode, 401);
    permissions = ['dashboard.read'];
    assert.equal((await server.inject({ method: 'GET', url, headers })).statusCode, 403); assert.equal(calls, 0);
    permissions = ['analytics.read'];
    const ok = await server.inject({ method: 'GET', url: `${url}?range=24h`, headers });
    assert.equal(ok.statusCode, 200); assert.equal(ok.headers['cache-control'], 'private, no-store');
    assert.equal(ok.json().http.requests, 123);
    for (const query of ['range=365d', 'range=1h&range=7d', 'hostname=admin.toantrungxeluot.io.vn'])
      assert.equal((await server.inject({ method: 'GET', url: `${url}?${query}`, headers })).statusCode, 400);
    assert.equal(calls, 1);
  } finally { await app.close(); }
});
