import 'reflect-metadata';
import { BadRequestException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import { configureValuationTransport } from './modules/valuation/valuation.transport.js';
import { PublicResponseCache } from './common/cache/public-cache.js';
import { publicCacheState } from './common/cache/public-cache.module.js';
import { ContentReadDiagnostics } from './common/cache/content-read-diagnostics.js';
import { configureOwnershipTransport } from './modules/ownership/transport.js';
import { configureApiPerfDiagnostics } from './common/perf-transport.js';
import { configureTVMusicTransport } from './modules/media/tv-music.transport.js';

export async function bootstrap(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false, trustProxy: ['127.0.0.1', '::1'], }), { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(PinoLoggerService);
  const publicCache = app.get(PublicResponseCache);
  const contentDiagnostics = app.get(ContentReadDiagnostics);
  let cacheMetricsTimer: ReturnType<typeof setInterval> | undefined;
  let contentMetricsTimer: ReturnType<typeof setInterval> | undefined;
  app.getHttpAdapter().getInstance().addHook('onClose', (_instance, done) => {
    clearInterval(cacheMetricsTimer);
    clearInterval(contentMetricsTimer);
    done();
  });
  configureValuationTransport(app.getHttpAdapter().getInstance());
  configureOwnershipTransport(app.getHttpAdapter().getInstance());
  configureTVMusicTransport(app.getHttpAdapter().getInstance());
  app.useLogger(logger);
  configureApiPerfDiagnostics(app.getHttpAdapter().getInstance(), config.get<boolean>('PERF_DIAGNOSTICS') === true,
    line => logger.instance.info(JSON.parse(line) as Record<string, unknown>, 'performance diagnostics'));
  app.getHttpAdapter().getInstance().addHook('onResponse', (request, reply, done) => {
    logger.instance.info({ requestId: request.id, method: request.method, path: request.url.split('?')[0], status: reply.statusCode, durationMs: Math.round(reply.elapsedTime) }, 'request completed');
    done();
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  const origins = config.getOrThrow<string>('CORS_ORIGINS').split(',').map((origin) => origin.trim());
  app.enableCors({ origin: origins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'] });
  app.setGlobalPrefix('api/v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true,
    exceptionFactory: (errors) => new BadRequestException({ message: 'Invalid input', details: errors.map((error) => ({ field: error.property, constraints: error.constraints })) }),
  }));
  const swagger = new DocumentBuilder().setTitle('Xe Lướt Toàn Trung API').setDescription('REST API for web and admin').setVersion('1.0').addBearerAuth().build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, swagger), { useGlobalPrefix: false });
  await app.listen({ port: config.getOrThrow<number>('PORT'), host: '127.0.0.1' });
  logger.instance.info({ ...publicCacheState(config), entries: publicCache.snapshot().entries,
    declaredProcessCount: config.get<number>('PUBLIC_CACHE_PROCESS_COUNT') }, 'public cache configuration');
  // One bounded aggregate per minute, including when cache is disabled. No
  // request keys, raw queries, IP addresses, credentials or customer data.
  contentMetricsTimer = setInterval(() => {
    const metrics = contentDiagnostics.drain();
    if (metrics) logger.instance.info({ ...metrics, cacheEnabled: publicCache.enabled,
      rateLimitMax: config.get<number>('RATE_LIMIT_MAX'), rateLimitTtlMs: config.get<number>('RATE_LIMIT_TTL_MS') }, 'public content diagnostics');
  }, 60_000);
  contentMetricsTimer.unref();
  if (publicCache.enabled) {
    // Aggregate counters only: no keys, search terms, headers or extra requests.
    cacheMetricsTimer = setInterval(() => logger.instance.info(publicCache.snapshot(), 'public cache metrics'), 300_000);
    cacheMetricsTimer.unref();
  }
  logger.log(`API listening on port ${config.getOrThrow<number>('PORT')}`, 'Bootstrap');
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((error: unknown) => { console.error('API bootstrap failed', error instanceof Error ? error.message : error); process.exitCode = 1; });
}
