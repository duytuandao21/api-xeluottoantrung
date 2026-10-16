import { Controller, Get, HttpException, Inject, InternalServerErrorException, Logger, Req, Res } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { defer, lastValueFrom } from 'rxjs';
import { Public } from '../auth/auth.decorators.js';
import { ContentService } from './content.service.js';
import { PublicCacheInterceptor } from '../../common/cache/public-cache.interceptor.js';
import { PublicResponseCache } from '../../common/cache/public-cache.js';
import { ContentReadDiagnostics } from '../../common/cache/content-read-diagnostics.js';
import { HomeContentView, preparedHomeContent, type ContentFailure, type HomeContentRequest } from '../../common/cache/home-content-read.js';

@ApiTags('Public content')
@Public()
@Controller('content/home')
export class PublicHomeContentController {
  private readonly sourceCache: PublicCacheInterceptor;
  private readonly logger = new Logger(PublicHomeContentController.name);
  private readonly failureTimes = new Map<string, number>();
  constructor(private readonly content: ContentService, @Inject(PublicResponseCache) cache: PublicResponseCache,
    reflector: Reflector, diagnostics: ContentReadDiagnostics) {
    this.sourceCache = new PublicCacheInterceptor(cache, reflector, diagnostics);
  }

  @Get() @HomeContentView() @ApiOperation({ summary: 'Nine fixed homepage CMS groups with independent source cache and rate budgets' })
  async home(@Req() request: HomeContentRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const reads = request[preparedHomeContent];
    // Fail closed if a host forgets to register the source-aware global guard.
    if (!reads) throw new InternalServerErrorException();
    const values: ({ ok: true; data: unknown } | ContentFailure)[] = new Array(reads.length);
    // Cold/invalidation reads stay bounded instead of moving an unbounded burst
    // into PostgreSQL. The envelope itself never enters PublicResponseCache.
    for (let index = 0; index < reads.length; index++) {
      const read = reads[index];
      if (read.failure) { values[index] = read.failure; continue; }
      try {
        const data = await lastValueFrom(this.sourceCache.intercept(read.context,
          { handle: () => defer(() => this.content.entries(read.group)) }));
        values[index] = { ok: true, data };
      } catch (error) {
        // No SQL, messages, stack, request data or private details in envelope.
        const status = error instanceof HttpException ? error.getStatus() : 500;
        values[index] = { ok: false, status };
        if (Date.now() - (this.failureTimes.get(read.group) ?? 0) >= 30000) {
          this.failureTimes.set(read.group, Date.now());
          this.logger.warn(JSON.stringify({ event: 'public_home_content_failure', group: read.group, status }));
        }
      }
    }
    return { groups: Object.fromEntries(reads.map((read, index) => [read.group, values[index]])) };
  }
}
