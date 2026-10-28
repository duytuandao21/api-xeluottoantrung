import 'reflect-metadata';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/database/schema/index.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { TVMusicController } from '../../src/modules/media/tv-music.controller.js';
import { TVMusicService } from '../../src/modules/media/tv-music.service.js';
import { StorageCleanupService } from '../../src/modules/media/storage-cleanup.service.js';
import { StorageCleanupInterceptor } from '../../src/modules/media/storage-cleanup.interceptor.js';
import { configureTVMusicTransport } from '../../src/modules/media/tv-music.transport.js';
import type { StorageService, StoredObject } from '../../src/modules/media/storage.service.js';
import { ContentService } from '../../src/modules/content/content.service.js';
import { AdminSettingsController } from '../../src/modules/content/content.controller.js';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../../src/modules/auth/admin-access.service.js';

/** Disposable in-memory PostgreSQL and R2 substitute; never reads .env or opens a DB connection. */
export async function tvMusicFixture() {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(name => name.endsWith('.sql')).sort())
      await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [profile] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'TV music dummy' }).returning();
    const objects = new Map<string, StoredObject>();
    const storage: StorageService = { publicUrl: key => `https://media.test/${key}`, head: async key => objects.get(key) ?? null,
      delete: async key => { objects.delete(key); }, ping: async () => {}, presignPut: async () => { throw new Error('Unused in dummy music fixture'); },
      putAudio: async (key, body) => { let sizeBytes = 0; for await (const chunk of body) sizeBytes += (chunk as Buffer).length; objects.set(key, { mimeType: 'audio/mpeg', sizeBytes }); } };
    const music = new TVMusicService({ db } as DatabaseService, storage);
    const content = new ContentService({ db } as DatabaseService, music);
    const cleanup = new StorageCleanupService({ db } as DatabaseService, storage);
    const audit = { actorProfileId: profile!.id, requestId: 'fixture', ipAddress: '127.0.0.1', userAgent: 'test' };
    await content.upsertSetting('tv-display', 'config', { valueType: 'json', value: JSON.stringify({ logoUrl: '', title: 'Bảng giá xe đang bán', hotlineTitle: 'Liên hệ nhận giá tốt',
      carIntervalSeconds: 5, hotlineIntervalSeconds: 5, syncSalesContacts: true, hotlines: [] }) }, audit);
    @Module({ controllers: [TVMusicController, AdminSettingsController], providers: [
      { provide: TVMusicService, useValue: music }, { provide: ContentService, useValue: content }, { provide: StorageCleanupService, useValue: cleanup },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['admin', 'reader'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'admin' ? ['content.read', 'content.update'] : ['content.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
      { provide: APP_INTERCEPTOR, useClass: StorageCleanupInterceptor },
    ] }) class FixtureModule {}
    app = await NestFactory.create<NestFastifyApplication>(FixtureModule, new FastifyAdapter(), { logger: false });
    configureTVMusicTransport(app.getHttpAdapter().getInstance()); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); const server = app.getHttpAdapter().getInstance(); await server.ready();
    return { app, server, music, content, cleanup, objects, audit, close: async () => { await app!.close(); await pg.close(); } };
  } catch (error) { await app?.close(); await pg.close(); throw error; }
}
