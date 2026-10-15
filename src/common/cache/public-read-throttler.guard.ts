import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants.js';
import type { FastifyRequest } from 'fastify';
import { PUBLIC_KEY } from '../../modules/auth/auth.decorators.js';
import { PublicResponseCache } from './public-cache.js';
import { publicCachePolicy, publicLookupResource } from './public-cache.policy.js';

@Injectable()
export class PublicReadThrottlerGuard extends ThrottlerGuard {
  @Inject(PublicResponseCache) private readonly responseCache!: PublicResponseCache;

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const targets = [context.getHandler(), context.getClass()];
    if (request.method !== 'GET' || request.headers.authorization !== undefined || request.headers.cookie !== undefined ||
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip) ||
      !this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return false;
    if (this.throttlers.some(item => this.reflector.getAllAndOverride(THROTTLER_LIMIT + item.name, targets) !== undefined)) return false;
    const policy = publicCachePolicy(request.url);
    // Guards precede interceptors. Only fresh anonymous loopback SSR cache hits
    // are exempt. External IPs, misses, explicit limits and writes stay guarded.
    return !!policy && this.responseCache.hasFresh(policy.key);
  }

  protected override generateKey(context: ExecutionContext, tracker: string, name: string): string {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const resource = request.method === 'GET' && this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])
      ? publicLookupResource(request.url) : undefined;
    // Seven bounded buckets, independent of arbitrary queries, IDs or XFF.
    return super.generateKey(context, resource ? `${tracker}:lookup:${resource}` : tracker, name);
  }
}
