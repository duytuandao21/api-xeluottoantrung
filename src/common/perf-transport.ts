import type { FastifyInstance } from 'fastify';
import { PerfMetrics } from './perf-metrics.js';

function endpointLabel(raw: string) {
  const path = raw.split('?')[0].replace(/^\/api\/v1/, '');
  if (/^\/(cars|brands|seo|content|slides|testimonials|articles|article-categories|services|faqs|recruitments|accessories)$/.test(path)) return path.slice(1);
  const lookup = /^\/lookups\/(branches|branch-regions|body-styles|transmissions|car-colors|car-versions|filter-options)$/.exec(path);
  if (lookup) return `lookup:${lookup[1]}`;
  if (path.startsWith('/site-settings/')) return 'settings';
  if (/^\/brands\/[^/]+\/models$/.test(path)) return 'brand-models';
  if (path === '/cars/menu') return 'car-menu';
  return 'read-other';
}

export function configureApiPerfDiagnostics(server: FastifyInstance, enabled: boolean, write?: (line: string) => void) {
  const recorder = new PerfMetrics(enabled, 'api', write);
  if (!enabled) return recorder;
  recorder.start();
  server.addHook('onResponse', (request, reply, done) => {
    try {
    if (request.method === 'GET' && request.url.startsWith('/api/v1/') && !/^\/api\/v1\/(admin|sale)(\/|$)/.test(request.url)) {
      recorder.record('api.http', endpointLabel(request.url), reply.elapsedTime,
        reply.statusCode === 429 ? '429' : reply.statusCode === 503 ? '503' : reply.statusCode >= 400 ? 'error' : 'ok');
    }
    } catch { /* Diagnostics must not affect response completion. */ }
    done();
  });
  server.addHook('onClose', (_server, done) => { try { recorder.stop(); } catch { /* Best effort. */ } done(); });
  return recorder;
}
