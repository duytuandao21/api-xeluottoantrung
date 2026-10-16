import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants.js';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface.js';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_KEY } from '../../modules/auth/auth.decorators.js';
import { PublicResponseCache } from './public-cache.js';
import { publicCachePolicy, publicContentGroup, publicLookupResource } from './public-cache.policy.js';
import { ContentReadDiagnostics, isLoopback, type ContentGuardReason } from './content-read-diagnostics.js';
import { HOME_CONTENT_VIEW, contentReadContext, homeContentGroups, preparedHomeContent, type HomeContentRequest } from './home-content-read.js';

@Injectable()
export class PublicReadThrottlerGuard extends ThrottlerGuard {
  @Inject(PublicResponseCache) private readonly responseCache!: PublicResponseCache;
  @Inject(ContentReadDiagnostics) private readonly diagnostics!: ContentReadDiagnostics;

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.reflector.get<boolean>(HOME_CONTENT_VIEW, context.getHandler())) return super.canActivate(context);
    const request = context.switchToHttp().getRequest<HomeContentRequest>();
    if (request.method !== 'GET' || request.url !== '/api/v1/content/home') {
      // Invalid requests still consume a bounded handler/IP budget. Rejecting
      // before the limiter would create an unthrottled malformed-query path.
      await super.canActivate(context);
      throw new BadRequestException('This public view accepts no query parameters');
    }
    const reads = homeContentGroups.map(group => contentReadContext(request, group));
    // Charge every source using the SAME original handler/IP/group key. This
    // view is not a new quota, nor a SkipThrottle route. Warm loopback reads
    // keep the existing fresh-cache exemption, including explicit-limit checks.
    for (const read of reads) {
      try { if (!await super.canActivate(read.context)) throw new ForbiddenException(); }
      catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const retryAfter = Number(read.headers.get('retry-after'));
        read.failure = { ok: false, status: error.getStatus(),
          ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
      }
    }
    request[preparedHomeContent] = reads;
    return true;
  }

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
