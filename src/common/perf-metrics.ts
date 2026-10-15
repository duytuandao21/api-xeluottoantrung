import { createHistogram, monitorEventLoopDelay, performance, type RecordableHistogram } from 'node:perf_hooks';

const metrics = new Set(['ssr.http', 'ssr.prepare', 'ssr.component', 'api.queue', 'api.fetch', 'api.body', 'api.read', 'api.http', 'cheerio.parse', 'cheerio.serialize', 'cheerio.transform', 'html.react_parse', 'legacy.read']);
const labels = new Set(['home', 'listing', 'sell', 'trade-in', 'other-page', 'layout', 'public-page', 'public-home', 'home-component', 'legacy-page', 'safe-html', 'steps', 'home-bottom', 'markup',
  'cars', 'brands', 'seo', 'content', 'slides', 'testimonials', 'articles', 'article-categories', 'services', 'faqs', 'recruitments', 'accessories', 'settings', 'brand-models', 'car-menu', 'read-other',
  ...['branches', 'branch-regions', 'body-styles', 'transmissions', 'car-colors', 'car-versions', 'filter-options'].map(name => `lookup:${name}`)]);
type Row = { metric: string; label: string; count: number; errors: number; status429: number; status503: number; sumMs: number; maxMs: number; clipped: number; histogram: RecordableHistogram };

// Bounded histograms, no sample arrays, URLs, headers, IDs, bodies or error text.
export class PerfMetrics {
  private readonly rows = new Map<string, Row>();
  private readonly peaks = new Map<string, number>();
  private dropped = 0;
  private started = performance.now();
  private cpu = process.cpuUsage();
  private elu = performance.eventLoopUtilization();
  private delay?: ReturnType<typeof monitorEventLoopDelay>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly enabled: boolean, private readonly role: 'web' | 'api', private readonly write = (line: string) => console.log(line)) {}

  record(metric: string, label: string, ms: number, outcome = 'ok') {
    if (!this.enabled || !metrics.has(metric) || !labels.has(label) || !Number.isFinite(ms) || ms < 0) return;
    const key = `${metric}:${label}`;
    let row = this.rows.get(key);
    if (!row) {
      if (this.rows.size >= 96) { this.dropped++; return; }
      row = { metric, label, count: 0, errors: 0, status429: 0, status503: 0, sumMs: 0, maxMs: 0, clipped: 0,
        histogram: createHistogram({ lowest: 1, highest: 120_000_000, figures: 2 }) };
      this.rows.set(key, row);
    }
    row.count++; row.sumMs += ms; row.maxMs = Math.max(row.maxMs, ms);
    if (outcome !== 'ok') row.errors++;
    if (outcome === '429') row.status429++;
    if (outcome === '503') row.status503++;
    if (ms > 120000) row.clipped++;
    row.histogram.record(Math.max(1, Math.min(120_000_000, Math.round(ms * 1000))));
  }
  gauge(name: string, value: number) {
    if (!this.enabled || !['api.active', 'api.waiting'].includes(name) || !Number.isFinite(value)) return;
    this.peaks.set(name, Math.max(this.peaks.get(name) ?? 0, value));
  }
  start() {
    if (!this.enabled || this.timer) return;
    this.delay = monitorEventLoopDelay({ resolution: 20 }); this.delay.enable();
    this.timer = setInterval(() => this.flush(), 30000); this.timer.unref();
  }
  flush() {
    if (!this.enabled) return;
    const now = performance.now(), windowMs = now - this.started, cpu = process.cpuUsage(), elu = performance.eventLoopUtilization();
    const loop = performance.eventLoopUtilization(elu, this.elu), memory = process.memoryUsage();
    const round = (value: number) => Math.round(value * 100) / 100;
    const report = { event: 'perf_diagnostics', role: this.role, time: new Date().toISOString(), windowMs: round(windowMs),
      runtime: { cpuMs: round((cpu.user - this.cpu.user + cpu.system - this.cpu.system) / 1000),
        eventLoopUtilization: round(loop.utilization), eventLoopDelayP95Ms: round((this.delay?.percentile(95) ?? 0) / 1e6),
        rssMiB: round(memory.rss / 1048576), heapUsedMiB: round(memory.heapUsed / 1048576) },
      peaks: Object.fromEntries(this.peaks), dropped: this.dropped,
      rows: [...this.rows.values()].map(({ histogram, ...row }) => ({ ...row, sumMs: round(row.sumMs), maxMs: round(row.maxMs),
        avgMs: round(row.sumMs / row.count), p50Ms: round(histogram.percentile(50) / 1000), p95Ms: round(histogram.percentile(95) / 1000) })) };
    this.rows.clear(); this.peaks.clear(); this.dropped = 0; this.delay?.reset(); this.started = now; this.cpu = cpu; this.elu = elu;
    try { this.write(JSON.stringify(report)); } catch { /* Logging must not change application behavior. */ }
    return report;
  }
  stop() { clearInterval(this.timer); this.timer = undefined; this.delay?.disable(); this.flush(); }
}
