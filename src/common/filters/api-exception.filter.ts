import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PinoLoggerService } from '../logging/pino-logger.service.js';

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(PinoLoggerService) private readonly logger: PinoLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const body = typeof response === 'object' && response !== null ? response as Record<string, unknown> : {};
    const message = statusCode === 500 ? 'Internal server error' : typeof body.message === 'string' ? body.message : typeof response === 'string' ? response : exception instanceof HttpException ? exception.message : 'Request failed';
    const details = body.details ?? (Array.isArray(body.message) ? body.message : undefined);
    if (statusCode >= 500) this.logger.instance.error({ requestId: request.id, method: request.method, path: request.url.split('?')[0], status: statusCode, err: exception instanceof Error ? { name: exception.name, message: exception.message } : undefined }, 'server error');
    reply.status(statusCode).send({ statusCode, error: HttpStatus[statusCode] ? String(HttpStatus[statusCode]).replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'Error', message, ...(details !== undefined ? { details } : {}) });
  }
}
