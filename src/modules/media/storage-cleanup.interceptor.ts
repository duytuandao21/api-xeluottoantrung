import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { defer, lastValueFrom } from 'rxjs';
import { StorageCleanupService } from './storage-cleanup.service.js';

@Injectable()
export class StorageCleanupInterceptor implements NestInterceptor {
  constructor(@Inject(StorageCleanupService) private readonly cleanup: StorageCleanupService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.url.startsWith('/api/v1/admin/') || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method)) return next.handle();
    return defer(async () => {
      try { return await lastValueFrom(next.handle()); }
      finally { await this.cleanup.flush(request.id); }
    });
  }
}
