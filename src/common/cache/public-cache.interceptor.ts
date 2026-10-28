import { Inject, Injectable, Optional, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { defer, finalize, from, lastValueFrom, type Observable } from 'rxjs';
import { PUBLIC_KEY } from '../../modules/auth/auth.decorators.js';
import { PublicResponseCache } from './public-cache.js';
import { publicCachePolicy } from './public-cache.policy.js';
import { ContentReadDiagnostics } from './content-read-diagnostics.js';

@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  constructor(@Inject(PublicResponseCache) private readonly cache: PublicResponseCache, private readonly reflector: Reflector,
    @Optional() @Inject(ContentReadDiagnostics) private readonly diagnostics?: ContentReadDiagnostics) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const path = request.routeOptions?.url ?? request.url.split('?')[0];
    // A long TV audio PUT only writes a private staging object, never published settings.
    // Do not suspend public business caches for the duration of this stream.
    // Publishing/removing playlist entries still uses the normal mutation boundary below.
    if (request.method === 'PUT' && /^\/api\/v1\/admin\/tv-music\/uploads\/[^/]+$/.test(path)) return next.handle();
    // All audited catalog/content/SEO writes are admin HTTP mutations. Clear on
    // success AND error: media workflows can commit before an external failure.
    if (path.startsWith('/api/v1/admin/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      return defer(() => {
        this.cache.beginMutation();
        return defer(() => next.handle()).pipe(finalize(() => this.cache.endMutation()));
      });
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const policy = request.method === 'GET' && isPublic ? publicCachePolicy(request.url) : undefined;
    if (policy) reply.header('Cache-Control', 'no-store');
    if (request.method !== 'GET' || !isPublic || request.headers.authorization !== undefined || request.headers.cookie !== undefined)
      return next.handle();
    if (!policy) return next.handle();
    // API memory is the sole persistent business cache. Do not add a browser or
    // proxy TTL that would conceal post-commit invalidation.
    return from(this.cache.read(policy.key, policy.ttlMs, async () => {
      const value: unknown = await lastValueFrom(next.handle());
      return { value, shareable: reply.statusCode === 200 && reply.getHeader('set-cookie') === undefined &&
        !String(reply.getHeader('cache-control')).includes('private') };
    }, outcome => this.diagnostics?.cacheRead(request, outcome)));
  }
}
