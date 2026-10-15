import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { defer, lastValueFrom, throwError } from 'rxjs';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PublicResponseCache, type CacheLoad } from '../src/common/cache/public-cache.js';
import { publicCachePolicy } from '../src/common/cache/public-cache.policy.js';
import { publicCacheEnabled, publicCacheState } from '../src/common/cache/public-cache.module.js';
import { PublicCacheInterceptor } from '../src/common/cache/public-cache.interceptor.js';
import { PUBLIC_KEY } from '../src/modules/auth/auth.decorators.js';

test('public cache policy preserves query semantics and excludes live/private/free-text data', () => {
  const policy = (path: string) => publicCachePolicy(`/api/v1${path}`);
  for (const path of ['/cars', '/cars/test', '/brands', '/accessories', '/accessories/test', '/search',
    '/sale/cars', '/admin/seo', '/content', '/site-settings/unknown', '/content?group=unknown',
    '/content?group=thiet-lap-nut-goi&extra=private', '/articles?search=private', '/faqs?q=private']) assert.equal(policy(path), undefined, path);
  assert.equal(policy('/lookups/body-styles?limit=100&page=2')?.key, policy('/lookups/body-styles?page=2&limit=100')?.key);
  assert.notEqual(policy('/lookups/body-styles?limit=100&page=1')?.key, policy('/lookups/body-styles?limit=100&page=2')?.key);
  assert.notEqual(policy('/articles?featured=false')?.key, policy('/articles')?.key);
  assert.notEqual(policy('/lookups/car-versions?modelId=a')?.key, policy('/lookups/car-versions?modelId=b')?.key);
  assert.notEqual(policy('/seo?route=%2Fa')?.key, policy('/seo?route=%2Fa%2F')?.key);
  assert.notEqual(policy('/articles?tag=a&tag=b')?.key, policy('/articles?tag=b&tag=a')?.key);
  assert.equal(policy('/articles/../seo?route=/'), undefined, 'Do not normalize paths into another endpoint');
  assert.equal(policy('/content?group=thiet-lap-cac-buoc-mua-xe&group=private'), undefined);
  for (const path of ['/seo?route=/', '/brands/toyota/models', '/lookups/branch-regions',
    '/site-settings/thiet-lap-logo', '/content?group=thiet-lap-cac-buoc-mua-xe', '/content?group=thiet-lap-nut-goi',
    '/content?group=thiet-lap-chinh-sach-dieu-kien', '/articles/a', '/services', '/faqs/a']) assert.ok(policy(path), path);
});

test('cache coalesces, expires without stale responses and never retains failures', async () => {
  let now = 0, reads = 0;
  const cache = new PublicResponseCache({ enabled: true, now: () => now, random: () => 1 });
  const load = async () => { reads++; return { value: { revision: reads }, shareable: true }; };
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => cache.read('a', 100, load))), Array(20).fill({ revision: 1 }));
  assert.equal(reads, 1);
  assert.deepEqual(await cache.read('a', 100, load), { revision: 1 });
  now = 100;
  assert.deepEqual(await cache.read('a', 100, load), { revision: 2 });
  now = 200;
  await assert.rejects(cache.read('a', 100, async () => { throw new Error('database failure'); }), /database failure/);
  assert.deepEqual(await cache.read('a', 100, load), { revision: 3 }, 'No stale-if-error or cached exception');
  assert.equal(cache.snapshot().pending, 0);
  const mutable = await cache.read('a', 100, load) as { revision: number };
  mutable.revision = 999;
  assert.deepEqual(await cache.read('a', 100, load), { revision: 3 }, 'Cached JSON is isolated from consumer mutation');
});

test('post-mutation invalidation prevents a pending old read from resurrecting cache', async () => {
  const cache = new PublicResponseCache({ enabled: true });
  let resolve!: (value: CacheLoad) => void;
  const old = cache.read('a', 10000, () => new Promise(done => { resolve = done; }));
  await Promise.resolve();
  cache.beginMutation();
  assert.deepEqual(await cache.read('a', 10000, async () => ({ value: 'during', shareable: true })), 'during');
  assert.equal(cache.snapshot().entries, 0, 'Reads during writes cannot populate cache');
  cache.endMutation();
  const latest = () => Promise.resolve({ value: 'new', shareable: true });
  assert.equal(await cache.read('a', 10000, latest), 'new');
  resolve({ value: 'old', shareable: true });
  assert.equal(await old, 'old', 'Pre-mutation request may finish its own snapshot');
  assert.equal(await cache.read('a', 10000, latest), 'new');
  assert.equal(cache.snapshot().pending, 0);
  cache.beginMutation(); cache.beginMutation(); cache.endMutation();
  await cache.read('a', 10000, latest);
  assert.equal(cache.snapshot().entries, 0, 'Overlapping mutations keep cache bypassed');
  cache.endMutation();
  await cache.read('a', 10000, latest);
  assert.equal(cache.snapshot().entries, 1);
});

test('bounded LRU, bytes, pending work and uncacheable/serialization fallback', async () => {
  const cache = new PublicResponseCache({ enabled: true, maxEntries: 2, maxBytes: 100, maxEntryBytes: 70, maxPending: 1 });
  const load = (value: unknown, shareable = true) => async () => ({ value, shareable });
  await cache.read('a', 10000, load('a'));
  await cache.read('b', 10000, load('b'));
  await cache.read('a', 10000, load('unused'));
  await cache.read('c', 10000, load('c'));
  assert.equal(cache.snapshot().entries, 2);
  assert.equal(await cache.read('b', 10000, load('fresh')), 'fresh', 'Least recently used key was evicted');
  await cache.read('large', 10000, load('x'.repeat(100)));
  await cache.read('unserializable', 10000, load(1n));
  await cache.read('k'.repeat(4097), 10000, load('long key'));
  assert.ok(cache.snapshot().bytes <= 100);
  let reads = 0;
  await Promise.all(Array.from({ length: 3 }, () => cache.read('cookie', 10000, async () => ({ value: ++reads, shareable: false }))));
  assert.equal(reads, 3, 'Unshareable responses execute each handler');
  let resolve!: (value: CacheLoad) => void;
  const pending = cache.read('pending', 10000, () => new Promise(done => { resolve = done; }));
  await Promise.resolve();
  await cache.read('overflow', 10000, load('overflow'));
  assert.equal(cache.snapshot().pending, 1);
  resolve({ value: 'done', shareable: true });
  await pending;
  assert.equal(cache.snapshot().pending, 0);
});

test('cache permits confirmed single Node/PM2 fork and rejects unknown or cluster topology', () => {
  const runtime = { clusterWorker: false, pm2Instance: undefined };
  const config = new ConfigService({ PUBLIC_CACHE_ENABLED: true, PUBLIC_CACHE_MODE: 'single-process', PUBLIC_CACHE_PROCESS_COUNT: 1 });
  assert.equal(publicCacheEnabled(config, runtime), true);
  assert.equal(publicCacheEnabled(new ConfigService(), runtime), false);
  assert.equal(publicCacheEnabled(config, { ...runtime, clusterWorker: true }), false);
  assert.equal(publicCacheEnabled(config, { ...runtime, pm2Instance: '0' }), true);
  assert.equal(publicCacheEnabled(config, { ...runtime, pm2Instance: '0', pm2ExecMode: 'fork_mode' }), true);
  assert.equal(publicCacheEnabled(config, { ...runtime, pm2Instance: '0', pm2ExecMode: 'cluster_mode' }), false);
  assert.equal(publicCacheEnabled(config, { ...runtime, pm2ExecMode: 'unknown' }), false);
  assert.equal(publicCacheEnabled(new ConfigService({ PUBLIC_CACHE_ENABLED: true, PUBLIC_CACHE_MODE: 'single-process', PUBLIC_CACHE_PROCESS_COUNT: 2 }), runtime), false);
  assert.deepEqual(publicCacheState(new ConfigService(), runtime), { enabled: false, reason: 'flag-off' });
  assert.deepEqual(publicCacheState(config, { ...runtime, clusterWorker: true }), { enabled: false, reason: 'cluster-worker' });
});

test('a real child with PM2 fork environment caches and invalidates; flag off reads origin', { timeout: 15000 }, async () => {
  const path = fileURLToPath(new URL('./fixtures/public-cache-worker.js', import.meta.url));
  const read = (worker: ReturnType<typeof fork>, revision: number, invalidate = false) => new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    worker.send({ revision, invalidate });
  });
  for (const off of [false, true]) {
    const worker = fork(path, ['--single-fork', ...(off ? ['--off'] : [])], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: { ...process.env, NODE_APP_INSTANCE: '0', exec_mode: 'fork_mode' },
    });
    try {
      assert.deepEqual(await read(worker, 1), { revision: 1, enabled: !off });
      assert.deepEqual(await read(worker, 2), { revision: off ? 2 : 1, enabled: !off });
      assert.deepEqual(await read(worker, 3, true), { revision: 3, enabled: !off });
    } finally { worker.kill(); }
  }
});

test('two real processes bypass local cache and observe an upstream revision independently', { timeout: 15000 }, async () => {
  const path = fileURLToPath(new URL('./fixtures/public-cache-worker.js', import.meta.url));
  const workers = [fork(path, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }), fork(path, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })];
  const read = (worker: typeof workers[number], revision: number) => new Promise<{ revision: number; enabled: boolean }>((resolve, reject) => {
    worker.once('message', result => resolve(result as { revision: number; enabled: boolean }));
    worker.once('error', reject);
    worker.send(revision);
  });
  try {
    for (const revision of [1, 2]) for (const worker of workers)
      assert.deepEqual(await read(worker, revision), { revision, enabled: false });
  } finally { for (const worker of workers) worker.kill(); }
});

test('interceptor excludes cookies/errors/private methods and cleans up failed mutations', async () => {
  const cache = new PublicResponseCache({ enabled: true });
  const interceptor = new PublicCacheInterceptor(cache, new Reflector());
  const handler = () => {};
  Reflect.defineMetadata(PUBLIC_KEY, true, handler);
  const request = { method: 'GET', url: '/api/v1/seo?route=/', headers: {} as Record<string, string> };
  const headers = new Map<string, string>();
  const reply = { statusCode: 200, header: (name: string, value: string) => headers.set(name.toLowerCase(), value),
    getHeader: (name: string) => headers.get(name.toLowerCase()) };
  const context = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }) } as unknown as ExecutionContext;
  let reads = 0;
  const next: CallHandler = { handle: () => defer(async () => {
    reads++; reply.header('set-cookie', `session=${reads}`); return { reads };
  }) };
  for (let i = 0; i < 2; i++) { headers.clear(); await lastValueFrom(interceptor.intercept(context, next)); }
  assert.equal(reads, 2);
  assert.equal(cache.snapshot().entries, 0, 'Set-Cookie responses are never retained');
  headers.clear(); reply.statusCode = 503;
  const non200: CallHandler = { handle: () => defer(async () => ({ reads: ++reads })) };
  await lastValueFrom(interceptor.intercept(context, non200));
  assert.equal(cache.snapshot().entries, 0);
  reply.statusCode = 200;
  await lastValueFrom(interceptor.intercept(context, non200));
  assert.equal(cache.snapshot().entries, 1);
  request.headers.authorization = 'Bearer test';
  const before = reads;
  await lastValueFrom(interceptor.intercept(context, non200));
  assert.equal(reads, before + 1, 'Even a warm key bypasses on Authorization');
  request.method = 'PATCH'; request.url = '/api/v1/admin/seo';
  const failure: CallHandler = { handle: () => throwError(() => new Error('partial mutation failure')) };
  await assert.rejects(lastValueFrom(interceptor.intercept(context, failure)), /partial mutation failure/);
  assert.equal(cache.snapshot().entries, 0);
  assert.equal(await cache.read('after-error', 100, async () => ({ value: 'ok', shareable: true })), 'ok');
  assert.equal(cache.snapshot().entries, 1, 'Mutation failure releases the bypass counter');
});
