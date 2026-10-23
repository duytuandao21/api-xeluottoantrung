import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { AdminAboutStoryController, PublicAboutStoryController } from '../src/modules/about-story/controller.js';
import { ABOUT_PAGE_ID, AboutStoryService } from '../src/modules/about-story/service.js';
import { type StorageService } from '../src/modules/media/storage.service.js';
import { PERMISSIONS_KEY, PUBLIC_KEY } from '../src/modules/auth/auth.decorators.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';

test('about story uses one current record: immediate edits, concurrency and image cleanup', async () => {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort())
      await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [actor] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Editor' }).returning();
    const audit = { actorProfileId: actor.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'about-story' };
    await db.insert(schema.aboutStoryPages).values({ id: ABOUT_PAGE_ID, publishedSnapshot: { stale: true } });
    await db.insert(schema.aboutStorySections).values([
      ['opening', 'Hành trình tạo dựng niềm tin'], ['milestones', 'Các cột mốc'],
      ['stories', 'Câu chuyện'], ['people', 'Con người'], ['future', 'Chặng đường phía trước'],
    ].map(([chapterKey, title]) => ({ chapterKey, title })));
    const storage: StorageService = { head: async () => ({ sizeBytes: 1000, mimeType: 'image/jpeg' }),
      publicUrl: key => `https://cdn.example.test/${key}`, presignPut: async () => '', delete: async () => {}, ping: async () => {} };
    const service = new AboutStoryService({ db } as DatabaseService, storage);
    assert.equal((await service.publicPage()).chapters.length, 5, 'No photo or publish approval required');
    await assert.rejects(service.section('opening', { title: 'Invalid CTA', ctaLabel: 'Link', ctaHref: null,
      visible: true, expectedRevision: 0 }, audit), /CTA needs both/);
    await service.section('opening', { title: 'Tên mới', subtitle: null, body: 'Nội dung đang hiển thị',
      ctaLabel: null, ctaHref: null, visible: true, expectedRevision: 0 }, audit);
    assert.equal((await service.publicPage()).chapters[0].title, 'Tên mới');
    assert.equal((await db.select().from(schema.aboutStoryPages))[0].publishedSnapshot, null, 'Obsolete snapshot cannot retain deleted images');
    await assert.rejects(service.section('opening', { title: 'Ghi đè cũ', visible: true, expectedRevision: 0 }, audit), /Content has changed/);
    assert.equal((await service.publicPage()).chapters[0].title, 'Tên mới');
    const first = await service.createMilestone({ slug: '1997', periodLabel: '1997', stage: '1997-2017',
      title: 'Khởi nguồn', summary: 'Gia Lai', featured: true, sortOrder: 0, sourceNote: 'Private note', expectedRevision: 1 }, audit);
    assert.equal((await service.publicPage()).milestones[0].id, first.id, 'New milestone is immediately public');
    assert.equal(JSON.stringify(await service.publicPage()).includes('Private note'), false);
    const second = await service.createMilestone({ slug: '2017', periodLabel: '2017', stage: '1997-2017',
      title: 'Phát triển', summary: 'Tên gọi Toàn Trung', featured: false, sortOrder: 1, expectedRevision: 2 }, audit);
    await service.reorder({ kind: 'milestone', ids: [second.id, first.id], expectedRevision: 3 }, audit);
    assert.equal((await service.publicPage()).milestones[0].id, second.id);
    const asset = await service.addAsset({ ownerType: 'milestone', ownerKey: first.id, placement: 'gallery',
      storageKey: `assets/${randomUUID()}.jpg`, width: 1200, height: 800, altText: 'Cơ sở Toàn Trung', sortOrder: 0, expectedRevision: 4 }, audit);
    assert.equal((await service.publicPage()).milestones.find(m => m.id === first.id)?.images.length, 1);
    await service.updateAsset(asset.id, { altText: 'Mô tả mới', placement: 'gallery', sortOrder: 0, expectedRevision: 5 }, audit);
    assert.equal((await service.publicPage()).milestones.find(m => m.id === first.id)?.images[0].alt, 'Mô tả mới');
    await service.deleteMilestone(first.id, { expectedRevision: 6 }, audit);
    assert.equal((await service.publicPage()).milestones.length, 1);
    assert.equal((await service.content()).assets.length, 0, 'Deleting a record also removes its image refs');
    const logs = await db.select().from(schema.auditLogs);
    assert.equal(logs.some(log => log.action === 'storage.delete_pending' && JSON.stringify(log.newData).includes(asset.publicUrl)), true);
    const story = await service.createStory({ title: 'Một hành trình', body: 'Nội dung do admin nhập', sortOrder: 0, expectedRevision: 7 }, audit);
    assert.equal((await service.publicPage()).stories[0].id, story.id);
    await service.updateStory(story.id, { title: 'Hành trình mới', body: 'Đã sửa', sortOrder: 0, expectedRevision: 8 }, audit);
    assert.equal((await service.publicPage()).stories[0].title, 'Hành trình mới');
    await service.deleteStory(story.id, { expectedRevision: 9 }, audit);
    assert.equal((await service.publicPage()).stories.length, 0);
    await service.section('people', { title: 'Con người', visible: false, expectedRevision: 10 }, audit);
    assert.equal((await service.publicPage()).chapters.find(c => c.key === 'people')?.visible, false);
    await assert.rejects(service.addAsset({ ownerType: 'section', ownerKey: 'opening', placement: 'desktop',
      storageKey: `assets/${randomUUID()}.png`, width: 500, height: 500, altText: 'Ảnh', sortOrder: 0, expectedRevision: 11 }, audit), /MIME does not match/);
  } finally { await pg.close(); }
});

test('about story controllers declare backend permissions and public-only read', () => {
  const reflector = new Reflector();
  assert.equal(reflector.get(PUBLIC_KEY, PublicAboutStoryController), true);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminAboutStoryController.prototype.content), ['content.read']);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminAboutStoryController.prototype.addAsset), ['content.create']);
  assert.deepEqual(reflector.get(PERMISSIONS_KEY, AdminAboutStoryController.prototype.deleteAsset), ['content.delete']);
});

test('about story HTTP routes require their actual backend permissions', async () => {
  @Module({ controllers: [PublicAboutStoryController, AdminAboutStoryController], providers: [
    { provide: AboutStoryService, useValue: { publicPage: async () => ({ chapters: [] }),
      content: async () => ({ revision: 0 }), section: async () => ({ revision: 1 }) } },
    { provide: JwtVerifierService, useValue: { verify: async (token: string) => {
      if (token === 'invalid') throw new UnauthorizedException(); return { id: token };
    } } },
    { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({
      profile: { id: randomUUID() }, roles: [], permissions: id === 'editor' ? ['content.read', 'content.update'] :
        id === 'reader' ? ['content.read'] : [],
    }) } },
    { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
  ] }) class FixtureModule {}
  const app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: ['error'] });
  try {
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    const server = app.getHttpAdapter().getInstance();
    const send = (method: 'GET' | 'PATCH', path: string, token?: string) => server.inject({ method,
      url: `/api/v1/${path}`, headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(method === 'PATCH' ? { payload: { expectedRevision: 0, title: 'Đã sửa', visible: true } } : {}) });
    const publicResponse = await send('GET', 'about-story');
    assert.equal(publicResponse.statusCode, 200, publicResponse.body);
    assert.equal((await send('GET', 'admin/about-story')).statusCode, 401);
    assert.equal((await send('GET', 'admin/about-story', 'denied')).statusCode, 403);
    assert.equal((await send('GET', 'admin/about-story', 'reader')).statusCode, 200);
    assert.equal((await send('PATCH', 'admin/about-story/sections/opening', 'reader')).statusCode, 403);
    assert.equal((await send('PATCH', 'admin/about-story/sections/opening', 'editor')).statusCode, 200);
  } finally { await app.close(); }
});
