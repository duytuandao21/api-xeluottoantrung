import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { BadRequestException, Module, NotFoundException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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

test('phase 7 content, SEO, enquiries and newsletter use real schema and permissions', async () => {
  const pg = new PGlite();
  try {
    for (const migration of ['0000_wild_carmella_unuscione', '0001_unusual_nomad'])
      await pg.exec((await readFile(`drizzle/${migration}.sql`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema });
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
    @Module({ controllers: [PublicCollectionsController, AdminCollectionsController, PublicContentController,
      AdminContentController, AdminSettingsController, PublicSeoController, AdminSeoController,
      PublicLeadsController, AdminLeadsController, AdminNewsletterController],
      providers: [
        { provide: DatabaseService, useValue: connection }, CollectionsService, ContentService, SeoService, LeadsService,
        { provide: JwtVerifierService, useValue: { verify: async () => ({ id: profile.authUserId }) } },
        { provide: AdminAccessService, useValue: { forAuthUser: async () => ({ profile, roles: ['TEST'], permissions: granted }) } },
        { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
      ] })
    class Phase7TestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(Phase7TestModule, new FastifyAdapter(), { logger: false });
    try {
      app.setGlobalPrefix('api/v1');
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
      await app.init();
      const server = app.getHttpAdapter().getInstance();
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
