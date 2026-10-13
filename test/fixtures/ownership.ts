import 'reflect-metadata';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Global, Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/database/schema/index.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { OwnershipModule } from '../../src/modules/ownership/module.js';
import { configureOwnershipTransport } from '../../src/modules/ownership/transport.js';
import { seedOwnership } from '../../src/database/seed/ownership.js';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../../src/modules/auth/admin-access.service.js';
import { OWNERSHIP_PERMISSIONS } from '../../src/modules/ownership/domain.js';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter.js';
import { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';
export async function ownershipFixture(vehicleId = randomUUID(), webShell = false) {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [profile] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Ownership isolated fixture' }).returning();
    const [brand] = await db.insert(schema.brands).values({ name: 'Toyota', slug: 'toyota-ownership-test' }).returning();
    const [model] = await db.insert(schema.carModels).values({ brandId: brand.id, name: 'Vios', slug: 'vios-ownership-test' }).returning();
    const [body] = await db.insert(schema.bodyStyles).values({ name: 'Sedan', slug: 'sedan-ownership-test' }).returning();
    const base = { brandId: brand.id, modelId: model.id, bodyStyleId: body.id, name: 'Toyota Vios E AT 2025', year: 2025, price: 433000000, mileage: 20000, fuel: 'Xăng', seatCount: 5, status: 'active' as const, publishedAt: new Date() };
    const [car, hidden] = await db.insert(schema.cars).values([{ ...base, id: vehicleId, slug: 'ownership-test' }, { ...base, slug: 'ownership-hidden', publishedAt: null }]).returning();
    await seedOwnership(db);
    @Global() @Module({ imports: [OwnershipModule, ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }])], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => { if (!['ownership-admin', 'ownership-reader', 'other'].includes(token)) throw new UnauthorizedException(); return { id: token }; } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'ownership-admin' ? OWNERSHIP_PERMISSIONS : id === 'ownership-reader' ? ['ownership.read'] : ['car.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard }, { provide: APP_GUARD, useClass: ThrottlerGuard },
    ], exports: [DatabaseService] }) class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    if (webShell) app.getHttpAdapter().getInstance().get('/api/v1/*', (request, reply) => {
      const path = new URL(request.url, 'http://fixture.test').pathname.replace('/api/v1', '');
      if (path === `/cars/${car.slug}`) return reply.send({ ...car, brand: { id: brand.id, name: brand.name, slug: brand.slug }, model: { id: model.id, name: model.name, slug: model.slug },
        version: 'E AT', bodyType: 'Sedan', transmission: 'Số tự động', branch: null, media: [], specifications: [], description: '<p>Thông tin xe mẫu dành riêng cho kiểm thử.</p>' });
      if (path === '/seo' || /^\/(pages|articles|faqs|services|recruitments)\//.test(path)) return reply.code(404).send({ message: 'Fixture: no record' });
      if (path.startsWith('/site-settings/') || path === '/content' || path === '/brands' || /\/brands\/[^/]+\/models$/.test(path)) return reply.send([]);
      return reply.send({ data: [], meta: { page: 1, limit: 100, total: 0, totalPages: 0 } });
    });
    configureOwnershipTransport(app.getHttpAdapter().getInstance()); app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const logger = new PinoLoggerService(); logger.instance.error = (() => {}) as typeof logger.instance.error;
    app.useGlobalFilters(new ApiExceptionFilter(logger));
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    return { app, pg, db, car, hidden, model, body, server: app.getHttpAdapter().getInstance(), close: async () => { await app!.close(); await pg.close(); } };
  } catch (e) { await app?.close(); await pg.close(); throw e; }
}
