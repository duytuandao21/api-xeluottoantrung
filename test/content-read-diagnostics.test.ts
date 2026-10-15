import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import { ContentReadDiagnostics } from '../src/common/cache/content-read-diagnostics.js';

test('content diagnostics have bounded cardinality and never retain raw URL, credentials, IP or tracker keys', () => {
  const diagnostics = new ContentReadDiagnostics();
  for (let i = 0; i < 2000; i++) {
    const request = { method: 'GET', url: `/api/v1/content?group=customer-${i}&token=secret-token&phone=0900000000`,
      ip: `198.51.100.${i % 255}`, headers: { authorization: 'Bearer secret-token', cookie: 'session=secret-cookie' } } as unknown as FastifyRequest;
    diagnostics.decision(request, 'credentials');
    diagnostics.blocked(request, { limit: 500, ttl: 60000, totalHits: 501, isBlocked: true, timeToExpire: 60, timeToBlockExpire: 60,
      key: 'secret-key', tracker: request.ip });
  }
  const metrics = diagnostics.drain()!;
  assert.equal(metrics.rows.length, 1);
  assert.equal(metrics.rows[0].received, 2000);
  assert.equal(metrics.rows[0].blocked, 2000);
  assert.equal(metrics.rows[0].group, 'other');
  assert.equal(metrics.rows[0].bucket, 'shared-handler-ip');
  assert(!/secret|198\.51|0900000000|customer-/.test(JSON.stringify(metrics)));
  assert.equal(diagnostics.drain(), undefined);
});
