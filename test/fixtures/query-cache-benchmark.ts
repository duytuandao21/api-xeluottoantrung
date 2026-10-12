import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createQueryCacheFixture } from './query-cache-fixture.js';

const fixture = await createQueryCacheFixture();
const running: Awaited<ReturnType<typeof fixture.createApp>>[] = [];
try {
  if (process.argv.includes('--serve')) {
    const before = await fixture.createApp(false, 4106), after = await fixture.createApp(true, 4107);
    running.push(before, after);
    console.log(JSON.stringify({ ready: true, before: before.url, after: after.url, database: 'PGlite memory only' }));
    process.on('SIGTERM', () => { void Promise.all(running.map(server => server.app.close())).then(() => fixture.pg.close()).then(() => process.exit(0)); });
    await new Promise<void>(resolveStop => process.on('SIGINT', () => resolveStop()));
  } else {
    const headers = { authorization: 'Bearer phase3-local' };
    type Case = { name: string; path: string; status?: number; headers?: Record<string, string> };
    const cases: Case[] = [
      { name: 'home-seo', path: '/seo?route=%2F' }, { name: 'listing-seo', path: '/seo?route=%2Fsan-pham' },
      { name: 'unknown-seo', path: '/seo?route=%2Fmissing', status: 404 },
      { name: 'brands-stock', path: '/brands' },
      ...fixture.brands.map(brand => ({ name: `models-${brand.slug}`, path: `/brands/${brand.slug}/models` })),
      { name: 'body-styles', path: '/lookups/body-styles?limit=100' },
      { name: 'transmissions', path: '/lookups/transmissions?limit=100' },
      { name: 'colors', path: '/lookups/car-colors?limit=100' },
      { name: 'branches', path: '/lookups/branches?limit=100' },
      { name: 'regions', path: '/lookups/branch-regions?limit=100' },
      { name: 'budget', path: '/lookups/filter-options?group=budget&limit=100' },
      { name: 'versions', path: `/lookups/car-versions?modelId=${fixture.models[0].id}&limit=100` },
      { name: 'logo', path: '/site-settings/thiet-lap-logo' },
      { name: 'info', path: '/site-settings/thiet-lap-thong-tin' },
      { name: 'footer', path: '/site-settings/thiet-lap-footer' },
      { name: 'steps', path: '/content?group=thiet-lap-cac-buoc-mua-xe' },
      { name: 'policies-live', path: '/content?group=thiet-lap-chinh-sach-dieu-kien' },
      { name: 'home-cars', path: '/cars?limit=6&sort=newest' },
      { name: 'filtered-cars', path: '/cars?brand=toyota&model=vios&year_from=2020&year_to=2026&price_max=500000000&sort=price_asc' },
      { name: 'cars-page2', path: '/cars?limit=1&page=2&sort=newest' },
      { name: 'cars-outside-page', path: '/cars?limit=1&page=99', status: 200 },
      { name: 'car-detail', path: `/cars/${fixture.cars[0].slug}` },
      { name: 'car-unknown', path: '/cars/missing', status: 404 },
      { name: 'search', path: '/search?q=vios&limit=12' },
      { name: 'suggestions', path: '/search/suggestions?q=vios' },
      { name: 'accessories-live', path: '/accessories?limit=8' },
      { name: 'articles', path: '/articles?limit=3' },
      { name: 'article-detail', path: '/articles/local-article' },
      { name: 'faqs', path: '/faqs?limit=20' }, { name: 'faq-detail', path: '/faqs/local-faq' },
      { name: 'slides', path: '/slides?limit=100' }, { name: 'testimonials', path: '/testimonials?limit=100' },
      { name: 'services', path: '/services?limit=100' },
      { name: 'authenticated-public-seo', path: '/seo?route=%2F', headers },
      { name: 'cookie-public-seo', path: '/seo?route=%2F', headers: { cookie: 'local-session=test' } },
      { name: 'admin-seo', path: '/admin/seo', headers },
    ];
    const originals = new Map<string, unknown>();
    const percentile = (values: number[], fraction: number) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * fraction) - 1)];
    const results = [];
    for (const enabled of [false, true]) {
      const server = await fixture.createApp(enabled); running.push(server);
      const read = async (item: Case) => {
        const started = performance.now();
        const response = await fetch(`${server.url}/api/v1${item.path}`, { headers: item.headers });
        const body = await response.text(), durationMs = performance.now() - started;
        assert.equal(response.status, item.status ?? 200, `${item.name}: ${body}`);
        const json: unknown = JSON.parse(body);
        if ((item.status ?? 200) === 200) {
          if (!originals.has(item.name)) originals.set(item.name, json);
          else assert.deepEqual(json, originals.get(item.name), `Contract mismatch: ${item.name}`);
        }
        return { durationMs, bytes: Buffer.byteLength(body), status: response.status };
      };
      // Warm DB/JIT and HTTP connection separately; empty the cache afterwards.
      for (const item of cases) await read(item);
      server.cache.invalidate();
      const stages = [];
      for (const stage of ['cold', 'warm', 'expired']) {
        if (stage === 'expired') server.clock.now += 16 * 60 * 1000; // Synthetic cache clock, no blocking sleep.
        const before = { ...server.metrics }, cpu = process.cpuUsage(), cacheBefore = server.cache.snapshot();
        const elapsedStart = performance.now(), durations: number[] = [], rows = [];
        let totalBytes = 0, maxSampledRss = 0, maxSampledHeap = 0;
        for (const item of cases) {
          const queriesBefore = server.metrics.selects, requests = stage === 'warm' ? 20 : 1;
          const samples = [];
          for (let offset = 0; offset < requests; offset += 5)
            samples.push(...await Promise.all(Array.from({ length: Math.min(5, requests-offset) }, () => read(item))));
          durations.push(...samples.map(sample => sample.durationMs));
          const bytes = samples.reduce((sum, sample) => sum + sample.bytes, 0); totalBytes += bytes;
          const memory = process.memoryUsage(); maxSampledRss = Math.max(maxSampledRss, memory.rss); maxSampledHeap = Math.max(maxSampledHeap, memory.heapUsed);
          rows.push({ name: item.name, requests, selects: server.metrics.selects - queriesBefore, bytes,
            p50Ms: percentile(samples.map(sample => sample.durationMs), .5), p95Ms: percentile(samples.map(sample => sample.durationMs), .95) });
        }
        const usage = process.cpuUsage(cpu), cache = server.cache.snapshot();
        assert.equal(cache.pending, 0);
        assert.ok(cache.entries <= 256 && cache.bytes <= 8 * 1024 * 1024);
        stages.push({ stage, requests: durations.length, selects: server.metrics.selects-before.selects,
          bytes: totalBytes, p50Ms: percentile(durations, .5), p95Ms: percentile(durations, .95),
          elapsedMs: performance.now()-elapsedStart, cpuUserMs: usage.user/1000, cpuSystemMs: usage.system/1000,
          maxSampledRss, maxSampledHeap, cache, cacheDelta: Object.fromEntries(['hit','miss','coalesced','bypass'].map(name => {
            const key = name as 'hit' | 'miss' | 'coalesced' | 'bypass'; return [name, cache[key]-cacheBefore[key]];
          })), rows });
      }
      results.push({ enabled, stages });
      await server.app.close(); running.pop();
    }
    const directory = resolve('../docs/artifacts/query-cache'); await mkdir(directory, { recursive: true });
    const result = { measuredAt: new Date().toISOString(), environment: 'local Windows, Nest/Fastify HTTP, PGlite in-memory',
      baseline: 'same API SQL/fixtures with cache disabled; not a production or full Next baseline', concurrency: 5,
      expiredClock: 'cache clock advanced 16 minutes; not wall time', contractComparison: 'all successful JSON responses equal across modes/stages',
      results, limitations: ['PGlite has no Supabase network/pooler', 'RSS/CPU includes client, server and DB in one Node process', 'RSS sampled per case; not continuous peak', 'API body bytes are not Supabase egress', 'no production deploy or stress test'] };
    const filename = process.argv.includes('--final') ? 'api-benchmark-final.json' : 'api-benchmark.json';
    await writeFile(resolve(directory, filename), JSON.stringify(result, null, 2)+'\n');
    console.log(JSON.stringify(results.map(result => ({ enabled: result.enabled, stages: result.stages.map(stage => ({ ...stage, rows: undefined })) })), null, 2));
  }
} finally { for (const server of running) await server.app.close(); await fixture.pg.close(); }
