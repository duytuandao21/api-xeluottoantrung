import 'reflect-metadata';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Global, Module, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DatabaseService } from '../../src/database/database.service.js';
import * as schema from '../../src/database/schema/index.js';
import { PromotionsModule } from '../../src/modules/promotions/module.js';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService } from '../../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../../src/modules/auth/permissions.guard.js';
import { AdminAccessService } from '../../src/modules/auth/admin-access.service.js';
import { ApiExceptionFilter } from '../../src/common/filters/api-exception.filter.js';
import { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';

export async function promotionsFixture(options: { beforeDateMigration?: (pg: PGlite) => Promise<void> } = {}) {
  const pg = new PGlite(); let app: NestFastifyApplication | undefined;
  try {
    await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
    for(const file of (await readdir('drizzle')).filter(file => file.endsWith('.sql')).sort()) {
      if(file.startsWith('0020_')) await options.beforeDateMigration?.(pg);
      await pg.exec((await readFile(`drizzle/${file}`, 'utf8')).replaceAll('--> statement-breakpoint', ''));
    }
    const db = drizzle(pg, { schema }) as unknown as DatabaseService['db'];
    const [profile] = await db.insert(schema.profiles).values({ authUserId: randomUUID(), fullName: 'Promotion fixture' }).returning();
    @Global() @Module({ imports: [PromotionsModule], providers: [
      { provide: DatabaseService, useValue: { db } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => {
        if(!['promotion-admin', 'promotion-reader', 'other'].includes(token)) throw new UnauthorizedException(); return { id: token };
      } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => ({ profile, roles: ['ADMIN'], permissions: id === 'promotion-admin'
        ? ['content.read', 'content.create', 'content.update', 'content.delete', 'media.create'] : id === 'promotion-reader' ? ['content.read'] : ['car.read'] }) } },
      { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: PermissionsGuard },
    ], exports: [DatabaseService] }) class TestModule {}
    app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    const logger = new PinoLoggerService(); logger.instance.error = (() => {}) as typeof logger.instance.error;
    app.useGlobalFilters(new ApiExceptionFilter(logger)); await app.init(); await app.getHttpAdapter().getInstance().ready();
    return { app, db, pg, profile, server: app.getHttpAdapter().getInstance(), close: async () => { await app!.close(); await pg.close(); } };
  } catch(error) { await app?.close(); await pg.close(); throw error; }
}
