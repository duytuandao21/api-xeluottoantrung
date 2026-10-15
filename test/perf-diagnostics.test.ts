import assert from 'node:assert/strict';
import { test } from 'node:test';
import fastify from 'fastify';
import { PerfMetrics } from '../src/common/perf-metrics.js';
import { configureApiPerfDiagnostics } from '../src/common/perf-transport.js';

test('performance diagnostics off stays silent; labels are bounded and never retain request data', () => {
  const lines: string[] = [];
  const off = new PerfMetrics(false, 'api', line => lines.push(line));
  off.start(); off.record('api.http', 'content', 12); off.flush(); off.stop(); assert.equal(lines.length, 0);
  const on = new PerfMetrics(true, 'api', line => lines.push(line));
  for (let i = 0; i < 5000; i++) on.record('api.http', `secret-cookie-${i}`, 1);
  on.record('api.http', 'content', 10, '429');
  const report = on.flush()!;
  assert.equal(report.rows.length, 1); assert.equal(report.rows[0].status429, 1);
  assert(!lines.join('').includes('secret-cookie'));
});

test('Fastify instrumentation preserves response/status/cache headers and logs no URL/query/credentials/body', async () => {
  for (const enabled of [false, true]) {
    const app = fastify(), lines: string[] = [];
    const metrics = configureApiPerfDiagnostics(app, enabled, line => lines.push(line));
    app.get('/api/v1/content', (_req, reply) => reply.header('cache-control', 'no-store').send({ unchanged: true, privateFixture: 'secret-body' }));
    try {
      const response = await app.inject({ url: '/api/v1/content?group=secret-query', headers: { cookie: 'secret-cookie', authorization: 'Bearer secret-token' } });
      assert.deepEqual(response.json(), { unchanged: true, privateFixture: 'secret-body' });
      assert.equal(response.statusCode, 200); assert.equal(response.headers['cache-control'], 'no-store');
      const report = metrics.flush();
      if (enabled) assert.equal(report!.rows[0].count, 1); else assert.equal(report, undefined);
      assert(!/secret|127\.0|authorization|cookie/.test(lines.join('')));
    } finally { await app.close(); }
  }
});
