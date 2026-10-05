import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configOptions } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CarsModule } from './modules/cars/cars.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { SeoModule } from './modules/seo/seo.module.js';
import { LeadsModule } from './modules/leads/leads.module.js';
import { LookupsModule } from './modules/lookups/lookups.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { AuspiciousDateModule } from './modules/auspicious-date/auspicious-date.module.js';
import { SearchModule } from './modules/search/search.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(configOptions),
    ThrottlerModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({ throttlers: [{ ttl: config.getOrThrow<number>('RATE_LIMIT_TTL_MS'), limit: config.getOrThrow<number>('RATE_LIMIT_MAX') }] }) }),
    DatabaseModule,
    AuthModule,
    CatalogModule,
    CarsModule,
    MediaModule,
    ContentModule,
    SeoModule,
    LeadsModule,
    LookupsModule,
    CustomersModule,
    DashboardModule,
    AuspiciousDateModule,
    SearchModule,
    HealthModule,
  ],
  providers: [
    PinoLoggerService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
