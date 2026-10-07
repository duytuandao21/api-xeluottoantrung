import 'reflect-metadata';
import { BadRequestException, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import { configureChatTransport } from './modules/chatbot/chatbot.transport.js';
import { configureValuationTransport } from './modules/valuation/valuation.transport.js';

export async function bootstrap(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ logger: false }), { bufferLogs: true });
  const config = app.get(ConfigService);
  const logger = app.get(PinoLoggerService);
  configureChatTransport(app.getHttpAdapter().getInstance());
  configureValuationTransport(app.getHttpAdapter().getInstance());
  app.useLogger(logger);
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
  await app.listen({ port: config.getOrThrow<number>('PORT'), host: '0.0.0.0' });
  logger.log(`API listening on port ${config.getOrThrow<number>('PORT')}`, 'Bootstrap');
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().catch((error: unknown) => { console.error('API bootstrap failed', error instanceof Error ? error.message : error); process.exitCode = 1; });
}
