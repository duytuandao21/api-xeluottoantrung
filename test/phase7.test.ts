import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BadRequestException, Module, NotFoundException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../src/database/database.service.js';
import * as schema from '../src/database/schema/index.js';
import { profiles } from '../src/database/schema/index.js';
import { PERMISSIONS_KEY } from '../src/modules/auth/auth.decorators.js';
import { AdminCollectionsController } from '../src/modules/content/collections.controller.js';
import { PublicCollectionsController } from '../src/modules/content/collections.controller.js';
import { CollectionsService } from '../src/modules/content/collections.service.js';
import { AdminContentController, AdminSettingsController, PublicContentController } from '../src/modules/content/content.controller.js';
import { ContentService } from '../src/modules/content/content.service.js';
import { AdminLeadsController, AdminNewsletterController } from '../src/modules/leads/leads.controller.js';
import { PublicLeadsController } from '../src/modules/leads/leads.controller.js';
import { LeadsService } from '../src/modules/leads/leads.service.js';
import { AdminSeoController } from '../src/modules/seo/seo.controller.js';
import { PublicSeoController } from '../src/modules/seo/seo.controller.js';
import { SeoService } from '../src/modules/seo/seo.service.js';
import { CustomersService } from '../src/modules/customers/customers.service.js';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { JwtVerifierService } from '../src/modules/auth/jwt-verifier.service.js';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { PublicResponseCache } from '../src/common/cache/public-cache.js';
import { PublicCacheInterceptor } from '../src/common/cache/public-cache.interceptor.js';

test('phase 7 content, SEO, enquiries and newsletter use real schema and permissions', async () => {
  const pg = new PGlite();
  try {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string }[] };
    for (const { tag: migration } of journal.entries)
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    let selects = 0;
    const db = drizzle(pg, { schema, logger: { logQuery: (sql) => { if (/^select\b/i.test(sql)) selects++; } } });
    const connection = { db } as unknown as DatabaseService;
    const [profile] = await db.insert(profiles).values({ authUserId: '49332fa0-8244-4b20-a8d0-9793b72ef689', fullName: 'Admin' }).returning();
    const audit = { actorProfileId: profile.id, ipAddress: '127.0.0.1', userAgent: 'test', requestId: 'phase7' };
    const collections = new CollectionsService(connection);
    const content = new ContentService(connection);
    const seo = new SeoService(connection);
    const leads = new LeadsService(connection);
    const customers = new CustomersService(connection);
    const dashboard = new DashboardService(connection);
    const query = { page: 1, limit: 20 };
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, AdminCollectionsController.prototype.create), ['content.create']);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, AdminSeoController.prototype.upsert), ['seo.update']);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, AdminLeadsController.prototype.list), ['lead.read']);
    assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, AdminNewsletterController.prototype.export), ['lead.read']);

    await assert.rejects(collections.create('articles', { title: 'Missing fields' }, audit), BadRequestException);
    const article = await collections.create('articles', { title: 'Tin mới', slug: 'tin-moi', content: 'Nội dung' }, audit);
    assert.equal((await collections.list('articles', query, true)).meta.total, 0);
    await assert.rejects(collections.detail('articles', 'tin-moi', true, true), NotFoundException);
    await collections.update('articles', String(article.id), { status: 'published' }, audit);
    assert.equal((await collections.detail('articles', 'tin-moi', true, true)).title, 'Tin mới');
    const faq = await collections.create('faqs', { question: 'Giờ mở cửa?', answer: '8 giờ', sortOrder: 0 }, audit);
    assert.equal((await collections.list('faqs', query, true)).meta.total, 1);
    await collections.update('faqs', String(faq.id), { status: 'inactive' }, audit);
    assert.equal((await collections.list('faqs', query, true)).meta.total, 0);
    await collections.delete('articles', String(article.id), audit);
    assert.equal((await collections.list('articles', query, false)).meta.total, 0);
    await assert.rejects(collections.list('unknown', query, false), NotFoundException);
    await assert.rejects(collections.list('article-categories', { ...query, status: 'active' }, false), BadRequestException);

    const entry = await content.createEntry({ group: 'home', key: 'intro', title: 'Giới thiệu', body: 'Xin chào' }, audit);
    assert.equal((await content.entries('home')).length, 1);
    await content.updateEntry('home', 'intro', { status: 'inactive' }, audit);
    assert.equal((await content.entries('home')).length, 0);
    assert.equal((await content.entries('home', true)).length, 1);
    await content.upsertSetting('footer', 'phone', { value: '0900000000' }, audit);
    await content.upsertSetting('footer', 'phone', { value: '0911111111' }, audit);
    assert.equal((await content.settings('footer'))[0].value, '0911111111');
    await assert.rejects(content.upsertSetting('general', 'count', { value: 'bad', valueType: 'number' }, audit), BadRequestException);
    await content.deleteEntry('home', 'intro', audit);
    assert.equal((await content.entries('home', true)).length, 0);
    assert.ok(entry.id);

    await seo.upsert({ routePath: '/tin-tuc', metaTitle: 'Tin tức', robotsIndex: true, structuredData: { '@type': 'WebPage' } }, audit);
    assert.equal((await seo.byRoute('/tin-tuc')).metaTitle, 'Tin tức');
    await seo.upsert({ routePath: '/tin-tuc', metaDescription: 'Mô tả' }, audit);
    assert.equal((await seo.byRoute('/tin-tuc')).metaDescription, 'Mô tả');
    assert.equal((await seo.list()).length, 1);

    await assert.rejects(leads.create({ type: 'sell', phone: '0900000000' }), BadRequestException);
    const lead = await leads.create({ type: 'sell', phone: '0900 000 000', offeredBrand: 'Toyota', offeredModel: 'Vios', offeredYear: '2022' });
    assert.equal(lead.accepted, true);
    assert.equal('phone' in lead, false);
    assert.equal((await leads.list({ ...query, type: 'sell' })).meta.total, 1);
    await leads.update(lead.id, { status: 'read' }, audit);
    assert.equal((await leads.detail(lead.id)).status, 'read');
    await leads.subscribe({ email: '  TEST@EXAMPLE.COM ' });
    await leads.subscribe({ email: 'test@example.com' });
    assert.equal((await leads.subscribers(query)).meta.total, 1);
    assert.match(await leads.exportSubscribers(), /test@example\.com/);
    await leads.delete(lead.id, audit);
    assert.equal((await leads.list(query)).meta.total, 0);
    const customer = await customers.create({ name: 'Khách A', email: 'A@EXAMPLE.COM', phone: '0900000000' }, audit);
    assert.equal(customer.email, 'a@example.com');
    assert.equal((await customers.list(query)).meta.total, 1);
    await customers.update(customer.id, { status: 'blocked' }, audit);
    assert.equal((await customers.detail(customer.id)).status, 'blocked');
    assert.equal((await dashboard.summary()).customers, 1);
    assert.equal((await dashboard.summary()).websiteViews, null);
    await customers.delete(customer.id, audit);
    assert.equal((await customers.list(query)).meta.total, 0);

    let granted: string[] = [];
    const publicCache = new PublicResponseCache({ enabled: true });
    @Module({ controllers: [PublicCollectionsController, AdminCollectionsController, PublicContentController,
      AdminContentController, AdminSettingsController, PublicSeoController, AdminSeoController,
      PublicLeadsController, AdminLeadsController, AdminNewsletterController],
      providers: [
        { provide: DatabaseService, useValue: connection }, CollectionsService, ContentService, SeoService, LeadsService,
        { provide: JwtVerifierService, useValue: { verify: async () => ({ id: profile.authUserId }) } },
        { provide: AdminAccessService, useValue: { forAuthUser: async () => ({ profile, roles: ['TEST'], permissions: granted }) } },
        { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
        { provide: PublicResponseCache, useValue: publicCache }, { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
      ] })
    class Phase7TestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(Phase7TestModule, new FastifyAdapter(), { logger: false });
    try {
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.init();
      const server = app.getHttpAdapter().getInstance();
      const publicGet = (url: string, headers: Record<string, string> = {}) => server.inject({ method: 'GET', url, headers });
      const seoUrl = '/api/v1/seo?route=%2Ftin-tuc';
      const beforeSeo = selects;
      const firstSeo = await publicGet(seoUrl);
      assert.equal(firstSeo.statusCode, 200);
      assert.equal(firstSeo.headers['cache-control'], 'no-store');
      assert.deepEqual((await publicGet(seoUrl)).json(), firstSeo.json());
      assert.equal(selects - beforeSeo, 1, 'Two anonymous SEO requests perform one SELECT');
      publicCache.invalidate();
      const beforeConcurrentSeo = selects;
      const simultaneousSeo = await Promise.all(Array.from({ length: 20 }, () => publicGet(seoUrl)));
      assert.equal(simultaneousSeo.every(response => response.statusCode === 200), true);
      assert.equal(selects - beforeConcurrentSeo, 1, 'Twenty cold concurrent SEO reads coalesce into one SELECT');
      const beforeBypass = selects;
      const bypassHeaders: Record<string, string>[] = [{ authorization: 'Bearer test-token' }, { cookie: 'session=test' }];
      for (const headers of bypassHeaders) {
        await publicGet(seoUrl, headers); await publicGet(seoUrl, headers);
      }
      assert.equal(selects - beforeBypass, 4, 'Authorization and cookie requests bypass positive public cache');
      const beforeUnknown = selects;
      assert.equal((await publicGet('/api/v1/seo?route=%2Fnew-route')).statusCode, 404);
      assert.equal((await publicGet('/api/v1/seo?route=%2Fnew-route')).statusCode, 404);
      assert.equal(selects - beforeUnknown, 2, 'Unknown routes are never negative-cached');
      granted = ['seo.update'];
      const updateSeo = (routePath: string, metaTitle: string) => server.inject({ method: 'PUT', url: '/api/v1/admin/seo',
        headers: { authorization: 'Bearer test-token' }, payload: { routePath, metaTitle } });
      assert.equal((await updateSeo('/tin-tuc', 'Updated SEO')).statusCode, 200);
      assert.equal((await publicGet(seoUrl)).json().metaTitle, 'Updated SEO', 'Post-commit mutation invalidates a warm SEO entry');
      assert.equal((await updateSeo('/new-route', 'Created SEO')).statusCode, 200);
      assert.equal((await publicGet('/api/v1/seo?route=%2Fnew-route')).json().metaTitle, 'Created SEO');
      assert.equal((await server.inject({ method: 'DELETE', url: '/api/v1/admin/seo?route=%2Fnew-route',
        headers: { authorization: 'Bearer test-token' } })).statusCode, 204);
      assert.equal((await publicGet('/api/v1/seo?route=%2Fnew-route')).statusCode, 404, 'Delete removes positive cache');
      granted = ['content.create', 'content.update', 'content.delete'];
      const settingsUrl = '/api/v1/site-settings/thiet-lap-logo';
      assert.deepEqual((await publicGet(settingsUrl)).json(), []);
      const saveSetting = (value: string) => server.inject({ method: 'PUT', url: '/api/v1/admin/site-settings/thiet-lap-logo/logo',
        headers: { authorization: 'Bearer test-token' }, payload: { value } });
      assert.equal((await saveSetting('/first.png')).statusCode, 200);
      assert.equal((await publicGet(settingsUrl)).json()[0].value, '/first.png');
      assert.equal((await saveSetting('/second.png')).statusCode, 200);
      assert.equal((await publicGet(settingsUrl)).json()[0].value, '/second.png');
      const group = 'thiet-lap-cac-buoc-mua-xe';
      const entriesUrl = `/api/v1/content?group=${group}`;
      assert.deepEqual((await publicGet(entriesUrl)).json(), []);
      assert.equal((await server.inject({ method: 'POST', url: '/api/v1/admin/content',
        headers: { authorization: 'Bearer test-token' }, payload: { group, key: 'cache-test', title: 'First step' } })).statusCode, 201);
      assert.equal((await publicGet(entriesUrl)).json()[0].title, 'First step');
      assert.equal((await server.inject({ method: 'PATCH', url: `/api/v1/admin/content/${group}/cache-test`,
        headers: { authorization: 'Bearer test-token' }, payload: { title: 'Updated step' } })).statusCode, 200);
      assert.equal((await publicGet(entriesUrl)).json()[0].title, 'Updated step');
      assert.equal((await server.inject({ method: 'DELETE', url: `/api/v1/admin/content/${group}/cache-test`,
        headers: { authorization: 'Bearer test-token' } })).statusCode, 204);
      assert.deepEqual((await publicGet(entriesUrl)).json(), []);
      const faqUrl = '/api/v1/faqs?limit=20&page=1';
      const beforeFaq = selects;
      const oldFaq = await publicGet(faqUrl);
      assert.deepEqual((await publicGet('/api/v1/faqs?page=1&limit=20')).json(), oldFaq.json());
      assert.equal(selects - beforeFaq, 2, 'Canonical query shares the original count+listing SELECTs');
      assert.equal((await publicGet('/api/v1/faqs?limit=0')).statusCode, 400, 'Cache cannot bypass DTO validation using another key');
      const createCacheFaq = await server.inject({ method: 'POST', url: '/api/v1/admin/collections/faqs',
        headers: { authorization: 'Bearer test-token' }, payload: { question: 'Cache FAQ?', answer: 'First answer' } });
      assert.equal(createCacheFaq.statusCode, 201, createCacheFaq.body);
      assert.equal((await publicGet(faqUrl)).json().meta.total, oldFaq.json().meta.total + 1);
      assert.equal((await publicGet('/api/v1/faqs/cache-faq')).json().answer, 'First answer');
      const faqId = createCacheFaq.json().id as string;
      assert.equal((await server.inject({ method: 'PATCH', url: `/api/v1/admin/collections/faqs/${faqId}`,
        headers: { authorization: 'Bearer test-token' }, payload: { question: 'Cache FAQ New', answer: 'New answer' } })).statusCode, 200);
      assert.equal((await publicGet('/api/v1/faqs/cache-faq')).statusCode, 404, 'Old slug cache is removed');
      assert.equal((await publicGet('/api/v1/faqs/cache-faq-new')).json().answer, 'New answer');
      assert.equal((await server.inject({ method: 'DELETE', url: `/api/v1/admin/collections/faqs/${faqId}`,
        headers: { authorization: 'Bearer test-token' } })).statusCode, 204);
      assert.equal((await publicGet('/api/v1/faqs/cache-faq-new')).statusCode, 404);
      assert.equal((await publicGet(faqUrl)).json().meta.total, oldFaq.json().meta.total);
      granted = [];
      const invalidLead = await server.inject({ method: 'POST', url: '/api/v1/leads', payload: { type: 'sell', phone: 'x' } });
      assert.equal(invalidLead.statusCode, 400);
      const validLead = await server.inject({ method: 'POST', url: '/api/v1/leads', payload: {
        type: 'callback', phone: '0900000000', name: 'Khách hàng' } });
      assert.equal(validLead.statusCode, 201);
      assert.equal('phone' in validLead.json(), false);
      const adminGet = () => server.inject({ method: 'GET', url: '/api/v1/admin/seo', headers: { authorization: 'Bearer test-token' } });
      assert.equal((await server.inject({ method: 'GET', url: '/api/v1/admin/seo' })).statusCode, 401);
      assert.equal((await adminGet()).statusCode, 403);
      granted = ['seo.read'];
      assert.equal((await adminGet()).statusCode, 200);
      granted = ['content.create'];
      const createdFaq = await server.inject({ method: 'POST', url: '/api/v1/admin/collections/faqs',
        headers: { authorization: 'Bearer test-token' }, payload: { question: 'Có hỗ trợ trả góp?', answer: 'Có.' } });
      assert.equal(createdFaq.statusCode, 201, createdFaq.body);
      assert.equal((await server.inject({ method: 'POST', url: '/api/v1/admin/collections/faqs',
        headers: { authorization: 'Bearer test-token' }, payload: { question: 'x', answer: 'y', unknown: true } })).statusCode, 400);
      assert.equal((await server.inject({ method: 'POST', url: '/api/v1/admin/collections/faqs',
        headers: { authorization: 'Bearer test-token' }, payload: { question: 'x', answer: 'y', title: 'Sai' } })).statusCode, 400);
      const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Phase 7').build());
      assert.ok(document.paths['/api/v1/leads']?.post);
      assert.ok(document.paths['/api/v1/admin/collections/{collection}']?.post);
      assert.ok(document.paths['/api/v1/admin/seo']?.put);
    } finally { await app.close(); }
  } finally { await pg.close(); }
});
