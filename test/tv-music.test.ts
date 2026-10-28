import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough, Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import { DatabaseService } from '../src/database/database.service.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { parseTVMusic, TV_MUSIC_MAX_BYTES, defaultTVMusic } from '../src/modules/content/tv-music.settings.js';
import { TVMusicService } from '../src/modules/media/tv-music.service.js';
import { TVMusicController } from '../src/modules/media/tv-music.controller.js';
import { configureTVMusicTransport } from '../src/modules/media/tv-music.transport.js';
import { boundedTVAudio } from '../src/modules/media/tv-audio-stream.js';
import { type StorageService, type StoredObject } from '../src/modules/media/storage.service.js';
import { StorageCleanupService } from '../src/modules/media/storage-cleanup.service.js';
import { StorageCleanupInterceptor } from '../src/modules/media/storage-cleanup.interceptor.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { PublicCacheInterceptor } from '../src/common/cache/public-cache.interceptor.js';
import { PublicResponseCache } from '../src/common/cache/public-cache.js';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';

const track = (sizeBytes = 3) => { const id = randomUUID(); return { id, name: 'Nhạc thử', url: `https://media.test/tv/music/${id}.mp3`, sizeBytes }; };
test('TV music contract: independent count/byte limits, exact boundaries, legacy defaults and unsafe fields', () => {
  assert.deepEqual(parseTVMusic(undefined), defaultTVMusic);
  assert.equal(parseTVMusic({ ...defaultTVMusic, tracks: Array.from({ length: 10 }, () => track()) }).tracks.length, 10);
  assert.equal(parseTVMusic({ ...defaultTVMusic, tracks: [track(TV_MUSIC_MAX_BYTES)] }).tracks[0]!.sizeBytes, TV_MUSIC_MAX_BYTES);
  for (const tracks of [Array.from({ length: 11 }, () => track()), [track(TV_MUSIC_MAX_BYTES), track()], [track(TV_MUSIC_MAX_BYTES + 1)]])
    assert.throws(() => parseTVMusic({ ...defaultTVMusic, tracks }));
  const duplicate = track();
  for (const patch of [{ volume: -1 }, { volume: 101 }, { volume: 1.5 }, { enabled: 'true' }, { revision: -1 },
    { tracks: [duplicate, duplicate] }, { tracks: [{ ...track(), sizeBytes: 0 }] },
    { tracks: [{ ...track(), url: 'javascript:alert(1)' }] }, { tracks: [{ ...track(), name: 'bad\nname' }] }])
    assert.throws(() => parseTVMusic({ ...defaultTVMusic, ...patch }));
});

test('MP3 stream enforces actual bytes, truncated bodies and type before storage can commit', async () => {
  const consume = async (chunks: Buffer[], expected: number) => {
    const parts: Buffer[] = [];
    for await (const part of boundedTVAudio(Readable.from(chunks), expected)) parts.push(part as Buffer);
    return Buffer.concat(parts);
  };
  assert.equal((await consume([Buffer.from('I'), Buffer.from('D3abc')], 6)).toString(), 'ID3abc');
  assert.equal((await consume([Buffer.from([0xff, 0xfb, 0x90])], 3)).length, 3);
  await assert.rejects(consume([Buffer.from('ID3abc')], 3), /vượt/);
  await assert.rejects(consume([Buffer.from('ID3')], 6), /chưa/);
  await assert.rejects(consume([Buffer.from('<html>')], 6), /MP3/);
});

test('long staging uploads do not suspend public caches; publishing and removing music still invalidate them', async () => {
  const cache = new PublicResponseCache({ enabled: true });
  const interceptor = new PublicCacheInterceptor(cache, new Reflector());
  let reads = 0;
  const load = async () => ({ value: ++reads, shareable: true });
  await cache.read('dummy-public', 60_000, load);
  const context = (method: string, path: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, url: path, routeOptions: { url: path } }), getResponse: () => ({}) }) }) as unknown as ExecutionContext;
  await lastValueFrom(interceptor.intercept(context('PUT', '/api/v1/admin/tv-music/uploads/:id'), { handle: () => of('staged') }));
  await cache.read('dummy-public', 60_000, load); assert.equal(reads, 1, 'Staging leaves public cached reads intact');
  await lastValueFrom(interceptor.intercept(context('DELETE', '/api/v1/admin/tv-music/tracks/:id'), { handle: () => of('removed') }));
  await cache.read('dummy-public', 60_000, load); assert.equal(reads, 2, 'Deleting a published entry invalidates the cache');
  await lastValueFrom(interceptor.intercept(context('PUT', '/api/v1/admin/site-settings/tv-display/config'), { handle: () => of('published') }));
  await cache.read('dummy-public', 60_000, load); assert.equal(reads, 3);
});

test('TV music upload, publication, replacement, quotas, orphan recovery and HTTP permissions use dummy storage only', async () => {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort())
      await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const database = { db } as DatabaseService;
    const [profile] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Dummy music editor' }).returning();
    const audit = { actorProfileId: profile!.id, ipAddress: '127.0.0.1', userAgent: 'dummy', requestId: 'music-test' };
    const objects = new Map<string, StoredObject>(); let failDelete = false; let headCount = 0;
    const storage: StorageService = {
      publicUrl: key => `https://media.test/${key}`, presignPut: async () => { throw new Error('No presigned audio upload'); }, ping: async () => {},
      head: async key => { headCount++; return objects.get(key) ?? null; },
      delete: async key => { if (failDelete) throw new Error('Dummy R2 outage'); objects.delete(key); },
      putAudio: async (key, body) => {
        let sizeBytes = 0; for await (const chunk of body) sizeBytes += (chunk as Buffer).length;
        objects.set(key, { sizeBytes, mimeType: 'audio/mpeg' });
      },
    };
    const music = new TVMusicService(database, storage);
    const content = new ContentService(database, music);
    const cleanup = new StorageCleanupService(database, storage);
    const base = { logoUrl: '', title: 'TV dummy', hotlineTitle: 'Hotline', carIntervalSeconds: 15, hotlineIntervalSeconds: 5,
      syncSalesContacts: true, hotlines: [] };
    const publish = async (value: unknown) => {
      const saved = await content.upsertSetting('tv-display', 'config', { valueType: 'json', value: JSON.stringify({ ...base, music: value }) }, audit);
      return parseTVMusic(JSON.parse(saved!.value!).music);
    };
    const send = async () => {
      const ticket = await music.reserve('Nhạc thử tiếng Việt', 6, audit);
      return music.upload(ticket.id, Readable.from([Buffer.from('ID3abc')]), 6, audit, new AbortController().signal);
    };
    const first = await send();
    const active = await publish({ ...defaultTVMusic, enabled: true, tracks: [first] });
    assert.equal(active.revision, 1);
    assert.equal((await music.usage()).bytes, 6);
    // An expired orphan-cleanup intent must not delete a published track or release its quota.
    for (const row of (await db.select().from(schema.auditLogs)).filter(row => row.action === 'storage.delete_pending' &&
      (row.newData as { key?: string })?.key === `tv/music/${first.id}.mp3`))
      await db.update(schema.auditLogs).set({ newData: { ...(row.newData as object), notBefore: '2000-01-01T00:00:00Z' } }).where(eq(schema.auditLogs.id, row.id));
    await cleanup.flush();
    assert(objects.has(`tv/music/${first.id}.mp3`)); assert.equal((await music.usage()).count, 1);
    await assert.rejects(music.cancel(first.id, audit), /đã lưu/i);
    await assert.rejects(publish({ ...active, revision: 0 }), /nơi khác/);
    await assert.rejects(publish({ ...active, tracks: [{ ...first, sizeBytes: 7 }] }), /dung lượng/i);
    await assert.rejects(publish({ ...active, tracks: [{ ...first, url: first.url.replace('media.test', 'foreign.test') }] }), /hệ thống/);
    await assert.rejects(music.remove(first.id, 0, audit), /nơi khác/);
    failDelete = true;
    const empty = await music.remove(first.id, active.revision, audit);
    await cleanup.flush();
    assert.equal(objects.has(`tv/music/${first.id}.mp3`), true, 'A failed deletion remains pending');
    assert.equal((await music.usage()).count, 1, 'Pending deletion still consumes physical storage quota');
    failDelete = false; await cleanup.flush();
    assert.equal(objects.size, 0); assert.equal((await music.usage()).count, 0);
    assert.equal(empty.revision, 2);

    // Exactly 1 GB is accepted; exceeding it by any amount is rejected even below 10 files.
    const huge = await music.reserve('Virtual 1 GB', TV_MUSIC_MAX_BYTES, audit);
    await assert.rejects(music.reserve('Over byte quota', 3, audit), /10 bài và 1 GB/);
    await music.cancel(huge.id, audit); await cleanup.flush();
    const competing = await Promise.allSettled(Array.from({ length: 11 }, (_, index) => music.reserve(`Tiny ${index}`, 3, audit)));
    const tickets = competing.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
    assert.equal(tickets.length, 10); assert.equal(competing.filter(item => item.status === 'rejected').length, 1);
    await assert.rejects(music.reserve('Eleventh', 3, audit), /10 bài và 1 GB/);
    assert.equal((await music.usage()).count, 10);
    for (const ticket of tickets) await music.cancel(ticket.id, audit);
    await cleanup.flush();
    assert.equal((await music.usage()).count, 0);

    const broken = await music.reserve('Wrong body', 3, audit);
    await assert.rejects(music.upload(broken.id, Readable.from([Buffer.from('ID3more')]), 3, audit, new AbortController().signal));
    await cleanup.flush(); assert.equal(objects.size, 0);
    const cancelled = await music.reserve('Cancelled', 3, audit);
    await assert.rejects(music.cancel(cancelled.id, { ...audit, actorProfileId: randomUUID() }), /khác/);
    await music.cancel(cancelled.id, audit); await cleanup.flush();
    await assert.rejects(music.upload(cancelled.id, Readable.from([Buffer.from('ID3')]), 3, audit, new AbortController().signal), /đã dùng/);

    const interrupted = await music.reserve('In flight', 6, audit);
    const source = new PassThrough(), abort = new AbortController();
    const inFlight = music.upload(interrupted.id, source, 6, audit, abort.signal).then(() => null, error => error);
    for (let attempt = 0; ; attempt++) {
      const events = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, interrupted.id));
      if (events.some(row => row.action === 'tv_music.started')) break;
      assert(attempt < 100, 'Upload entered its started state'); await new Promise(resolve => setTimeout(resolve, 10));
    }
    await music.cancel(interrupted.id, audit); await cleanup.flush();
    assert.equal((await music.usage()).count, 1, 'Cancellation cannot release space while a PUT is still in flight');
    abort.abort(); assert(await inFlight instanceof Error); await cleanup.flush(); assert.equal((await music.usage()).count, 0);

    // Simulate expired orphan timestamps without waiting or writing any real object.
    const orphan = await send();
    const logs = await db.select().from(schema.auditLogs);
    for (const row of logs.filter(row => row.entityId === orphan.id && row.action === 'tv_music.reserved'))
      await db.update(schema.auditLogs).set({ newData: { ...(row.newData as object), expiresAt: '2000-01-01T00:00:00Z' } }).where(eq(schema.auditLogs.id, row.id));
    for (const row of logs.filter(row => row.action === 'storage.delete_pending' && (row.newData as { key?: string })?.key === `tv/music/${orphan.id}.mp3`))
      await db.update(schema.auditLogs).set({ newData: { ...(row.newData as object), notBefore: '2000-01-01T00:00:00Z' } }).where(eq(schema.auditLogs.id, row.id));
    await cleanup.flush(); assert.equal(objects.size, 0); assert.equal((await music.usage()).count, 0);

    // Real transport, DTOs, auth and permission guards, in-process inject only.
    @Module({ controllers: [TVMusicController], providers: [
      { provide: TVMusicService, useValue: music }, { provide: StorageCleanupService, useValue: cleanup },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin', 'reader'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? ['content.read', 'content.update'] : ['content.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
      { provide: APP_INTERCEPTOR, useClass: StorageCleanupInterceptor },
    ] }) class FixtureModule {}
    app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
    configureTVMusicTransport(app.getHttpAdapter().getInstance()); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); const server = app.getHttpAdapter().getInstance(); await server.ready();
    const url = '/api/v1/admin/tv-music'; const headers = { authorization: 'Bearer admin' };
    assert.equal((await server.inject({ method: 'GET', url: `${url}/usage` })).statusCode, 401);
    assert.equal((await server.inject({ method: 'POST', url: `${url}/uploads`, headers: { authorization: 'Bearer reader' }, payload: { name: 'Denied', sizeBytes: 3 } })).statusCode, 403);
    assert.equal((await server.inject({ method: 'POST', url: `${url}/uploads`, headers, payload: { name: 'Too large', sizeBytes: TV_MUSIC_MAX_BYTES + 1 } })).statusCode, 400);
    const response = await server.inject({ method: 'POST', url: `${url}/uploads`, headers, payload: { name: 'HTTP MP3', sizeBytes: 3 } });
    assert.equal(response.statusCode, 201, response.body); const id = response.json().id;
    assert.equal((await server.inject({ method: 'PUT', url: `${url}/uploads/${id}`, headers, payload: { invalid: 'JSON is not an audio stream' } })).statusCode, 415);
    const uploaded = await server.inject({ method: 'PUT', url: `${url}/uploads/${id}`, headers: { ...headers, 'content-type': 'audio/mpeg' }, payload: Buffer.from('ID3') });
    assert.equal(uploaded.statusCode, 200, uploaded.body); assert.equal(uploaded.json().sizeBytes, 3);
    assert.equal((await server.inject({ method: 'PUT', url: `${url}/uploads/${id}`, headers: { ...headers, 'content-type': 'audio/mpeg' }, payload: Buffer.from('ID3') })).statusCode, 409, 'Cannot replay a consumed upload ticket');
    assert.equal((await server.inject({ method: 'DELETE', url: `${url}/uploads/${id}`, headers })).statusCode, 204);
    assert.equal(objects.size, 0);
    assert(headCount > 0);
    // Exercise a real loopback HTTP stream as well as Fastify inject.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = server.server.address(); assert(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}${url}`;
    const reserved = await fetch(`${origin}/uploads`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Loopback MP3', sizeBytes: 3 }) });
    assert.equal(reserved.status, 201); const loopbackId = (await reserved.json() as { id: string }).id;
    const streamed = await fetch(`${origin}/uploads/${loopbackId}`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'audio/mpeg' }, body: Buffer.from('ID3') });
    assert.equal(streamed.status, 200); assert.equal((await streamed.json() as { sizeBytes: number }).sizeBytes, 3);
    assert.equal((await fetch(`${origin}/uploads/${loopbackId}`, { method: 'DELETE', headers })).status, 204);
    assert.equal(objects.size, 0);
  } finally { await app?.close(); await pg.close(); }
});
