import { Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ThrottlerLimitDetail } from '@nestjs/throttler/dist/throttler.guard.interface.js';
import type { CacheReadOutcome } from './public-cache.js';
import { publicContentGroup } from './public-cache.policy.js';

export const isLoopback = (ip: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
export type ContentGuardReason = 'fresh' | 'disabled' | 'mutating' | 'pending' | 'expired' | 'absent' |
  'no-policy' | 'credentials' | 'external' | 'explicit-limit' | 'not-public';
type Row = {
  group: string; trackerScope: 'loopback' | 'external'; bucket: string;
  received: number; exempt: number; charged: number; blocked: number;
  cache: Record<CacheReadOutcome, number>; reasons: Partial<Record<ContentGuardReason, number>>;
  ttlMs: number; maxRemainingMs: number; limit: number; limiterTtlMs: number; maxBlockedHits: number; retryAfterSeconds: number;
};

// No request/header/query data is retained. At most (12 groups + other) *
// two tracker scopes * two bucket types, independent of traffic cardinality.
@Injectable()
export class ContentReadDiagnostics {
  private readonly rows = new Map<string, Row>();
  private started = Date.now();

  private row(request: FastifyRequest): Row | undefined {
    if (request.method !== 'GET' || request.url.split('?')[0] !== '/api/v1/content') return;
    const group = publicContentGroup(request.url) ?? 'other';
    const trackerScope = isLoopback(request.ip) ? 'loopback' : 'external';
    const bucket = trackerScope === 'loopback' && group !== 'other' &&
      request.headers.authorization === undefined && request.headers.cookie === undefined ? 'content-group' : 'shared-handler-ip';
    const key = `${group}:${trackerScope}:${bucket}`;
    let row = this.rows.get(key);
    if (!row) {
      row = { group, trackerScope, bucket, received: 0, exempt: 0, charged: 0, blocked: 0,
        cache: { hit: 0, miss: 0, coalesced: 0, bypass: 0 }, reasons: {}, ttlMs: 0, maxRemainingMs: 0,
        limit: 0, limiterTtlMs: 0, maxBlockedHits: 0, retryAfterSeconds: 0 };
      this.rows.set(key, row);
    }
    return row;
  }

  decision(request: FastifyRequest, reason: ContentGuardReason, ttlMs = 0, remainingMs = 0) {
    const row = this.row(request);
    if (!row) return;
    row.received++;
    if (reason === 'fresh') row.exempt++; else row.charged++;
    row.reasons[reason] = (row.reasons[reason] ?? 0) + 1;
    row.ttlMs = ttlMs;
    row.maxRemainingMs = Math.max(row.maxRemainingMs, Math.round(remainingMs));
  }

  cacheRead(request: FastifyRequest, outcome: CacheReadOutcome) {
    const row = this.row(request);
    if (row) row.cache[outcome]++;
  }

  blocked(request: FastifyRequest, detail: ThrottlerLimitDetail) {
    const row = this.row(request);
    if (!row) return;
    row.blocked++;
    row.limit = detail.limit;
    row.limiterTtlMs = detail.ttl;
    row.maxBlockedHits = Math.max(row.maxBlockedHits, detail.totalHits);
    row.retryAfterSeconds = Math.max(row.retryAfterSeconds, detail.timeToBlockExpire);
    // Never retain detail.key or detail.tracker (contains an IP).
  }

  drain(now = Date.now()) {
    const rows = [...this.rows.values()];
    this.rows.clear();
    const windowMs = Math.max(1, now - this.started);
    this.started = now;
    return rows.length ? { event: 'public_content_reads', endpoint: '/api/v1/content', windowMs, rows } : undefined;
  }
}
