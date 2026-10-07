import { Injectable, type LoggerService } from '@nestjs/common';
import pino, { type Logger } from 'pino';

@Injectable()
export class PinoLoggerService implements LoggerService {
  readonly instance: Logger = pino({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'password', 'accessToken', 'refreshToken', 'leadToken', 'leadTokenHash', 'req.body.leadToken', 'DATABASE_URL', 'R2_SECRET_ACCESS_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
      censor: '[REDACTED]',
    },
  });

  log(message: unknown, context?: string): void { this.instance.info({ context }, String(message)); }
  error(message: unknown, trace?: string, context?: string): void { this.instance.error({ context, trace }, String(message)); }
  warn(message: unknown, context?: string): void { this.instance.warn({ context }, String(message)); }
  debug(message: unknown, context?: string): void { this.instance.debug({ context }, String(message)); }
  verbose(message: unknown, context?: string): void { this.instance.trace({ context }, String(message)); }
}
