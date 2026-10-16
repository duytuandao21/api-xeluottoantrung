import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants.js';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface.js';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_KEY } from '../../modules/auth/auth.decorators.js';
import { PublicResponseCache } from './public-cache.js';
import { publicCachePolicy, publicContentGroup, publicLookupResource } from './public-cache.policy.js';
import { ContentReadDiagnostics, isLoopback, type ContentGuardReason } from './content-read-diagnostics.js';

@Injectable()
export class PublicReadThrottlerGuard extends ThrottlerGuard {
  @Inject(PublicResponseCache) private readonly responseCache!: PublicResponseCache;
  @Inject(ContentReadDiagnostics) private readonly diagnostics!: ContentReadDiagnostics;

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const targets = [context.getHandler(), context.getClass()];
    if (request.method !== 'GET') return false;
    const policy = publicCachePolicy(request.url);
    const state = policy ? this.responseCache.inspect(policy.key) : undefined;
    const reason: ContentGuardReason = !this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets) ? 'not-public' :
      request.headers.authorization !== undefined || request.headers.cookie !== undefined ? 'credentials' :
        !isLoopback(request.ip) ? 'external' :
          this.throttlers.some(item => this.reflector.getAllAndOverride(THROTTLER_LIMIT + item.name, targets) !== undefined) ? 'explicit-limit' :
            state?.state ?? 'no-policy';
    this.diagnostics.decision(request, reason, policy?.ttlMs, state?.remainingMs);
    // Guards precede interceptors. Only fresh anonymous loopback SSR cache hits
    // are exempt. External IPs, misses, explicit limits and writes stay guarded.
    return reason === 'fresh';
  }

  protected override generateKey(context: ExecutionContext, tracker: string, name: string): string {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const resource = request.method === 'GET' && this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])
      ? publicLookupResource(request.url) : undefined;
    const content = request.method === 'GET' && isLoopback(request.ip) && request.headers.authorization === undefined &&
      request.headers.cookie === undefined && this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])
      ? publicContentGroup(request.url) : undefined;
    // Fixed namespaces only. External content readers retain the original
    // shared handler/IP quota; cold SSR groups cannot exhaust each other.
    return super.generateKey(context, resource ? `${tracker}:lookup:${resource}` : content ? `${tracker}:content:${content}` : tracker, name);
  }

  protected override async throwThrottlingException(context: ExecutionContext, detail: ThrottlerLimitDetail): Promise<void> {
    this.diagnostics.blocked(context.switchToHttp().getRequest<FastifyRequest>(), detail);
    return super.throwThrottlingException(context, detail);
  }
}
