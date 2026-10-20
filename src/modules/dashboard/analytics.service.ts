import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ANALYTICS_RANGES, ANALYTICS_TTL_MS, type AnalyticsRange, type AnalyticsRow, type AnalyticsTrafficRow, type CloudflareAnalytics, type DatasetLimits } from './analytics.types.js';
import { AnalyticsUnavailable, CloudflareClient, namedType, type Schema } from './cloudflare.client.js';
import { AnalyticsCarsService } from './analytics-cars.service.js';

type Scope = 'zones' | 'accounts';
type RecordData = Record<string, unknown>;
interface Limits extends DatasetLimits { availableFields: string[] }
interface Dataset {
  node: string; scope: Scope; id: string; filterType: string; filters: Set<string>; order: Set<string>;
  fields: Set<string>; limits: Limits | null; reason: string | null;
}
interface Discovery { http: Dataset; security: Dataset; rum: Dataset }
interface Envelope { viewer?: { zones?: RecordData[]; accounts?: RecordData[] } }
interface Slice { alias: string; fields: string[]; dimension?: string; top?: number; order?: string }
const object = (value: unknown): RecordData => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordData : {};
const numeric = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const message = (error: unknown) => error instanceof AnalyticsUnavailable ? error.message : 'Cloudflare chưa trả được dữ liệu cho mục này.';
const LAG_SECONDS = 300;

function allowedRanges(limits: DatasetLimits | null) {
  return limits?.enabled ? ANALYTICS_RANGES.filter(range => range.seconds <= limits.maxDuration && range.seconds + LAG_SECONDS <= limits.notOlderThan) : [];
}

@Injectable()
export class AnalyticsService {
  private discovery?: { expires: number; value: Promise<Discovery> };
  private readonly snapshots = new Map<string, { expires: number; value: Promise<CloudflareAnalytics> }>();
  constructor(@Inject(CloudflareClient) private readonly client: CloudflareClient,
    @Inject(AnalyticsCarsService) private readonly carLabels: AnalyticsCarsService) {}

  async snapshot(range?: string): Promise<CloudflareAnalytics> {
    if (range !== undefined && !ANALYTICS_RANGES.some(item => item.id === range)) throw new BadRequestException('Khoảng thời gian không hợp lệ');
    const key = range || 'default';
    const cached = this.snapshots.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const entry = { expires: Date.now() + ANALYTICS_TTL_MS, value: this.load(range as AnalyticsRange | undefined) };
    this.snapshots.set(key, entry);
    // Six possible keys only. Rejected validation does not poison the cache.
    try { return await entry.value; } catch (error) { this.snapshots.delete(key); throw error; }
  }

  private capabilities(): Promise<Discovery> {
    if (this.discovery && this.discovery.expires > Date.now()) return this.discovery.value;
    const value = this.discover();
    this.discovery = { expires: Date.now() + ANALYTICS_TTL_MS, value };
    return value;
  }

  private async discover(): Promise<Discovery> {
    const definitions = [
      ['http', 'zones', 'httpRequestsAdaptiveGroups'], ['security', 'zones', 'firewallEventsAdaptiveGroups'],
      ['rum', 'accounts', 'rumPageloadEventsAdaptiveGroups'],
    ] as const;
    const empty = (key: typeof definitions[number]): Dataset => ({ scope: key[1], node: key[2], id: '', filterType: '',
      filters: new Set(), order: new Set(), fields: new Set(), limits: null, reason: 'Chưa cấu hình Cloudflare Analytics tại backend.' });
    const result: Discovery = { http: empty(definitions[0]), security: empty(definitions[1]), rum: empty(definitions[2]) };
    if (!this.client.configured) return result;
    try {
      const [scopes, account] = await Promise.all([this.client.types(['zone', 'account', 'Settings']), this.client.accountId()]);
      const nodes = definitions.map(([, scope, node]) => scopes.get(scope === 'zones' ? 'zone' : 'account')?.fields.find(field => field.name === node));
      const details = await this.client.types(nodes.flatMap(field => field ? [namedType(field.type), ...field.args.map(arg => namedType(arg.type))] : []));
      const nested = await this.client.types([...details.values()].flatMap(type => (type.fields || []).filter(field => ['dimensions', 'sum', 'avg'].includes(field.name)).map(field => namedType(field.type))));
      const schema: Schema = new Map([...scopes, ...details, ...nested]);
      for (const [index, [name, scope]] of definitions.entries()) {
        const dataset = result[name];
        const field = nodes[index];
        dataset.id = scope === 'zones' ? this.client.zone : account || '';
        dataset.reason = !dataset.id ? 'Web Analytics cần CLOUDFLARE_ACCOUNT_ID hoặc quyền đọc Zone để xác định account.' : 'Dataset hoặc schema Cloudflare chưa khả dụng.';
        if (!field || !dataset.id || !field.args.some(arg => arg.name === 'limit')) continue;
        dataset.filterType = namedType(field.args.find(arg => arg.name === 'filter')?.type);
        dataset.filters = new Set(schema.get(dataset.filterType)?.inputFields.map(item => item.name));
        dataset.order = new Set(schema.get(namedType(field.args.find(arg => arg.name === 'orderBy')?.type))?.enumValues.map(item => item.name));
        const type = schema.get(namedType(field.type));
        for (const item of type?.fields || []) {
          if (['sum', 'avg', 'dimensions'].includes(item.name)) {
            for (const child of schema.get(namedType(item.type))?.fields || []) dataset.fields.add(`${item.name}_${child.name}`);
          } else dataset.fields.add(item.name);
        }
      }
      // Verify settings dataset names too, rather than assuming every schema node is enabled.
      const settingsTypes = await this.client.types(['ZoneSettings', 'AccountSettings']);
      const supportedSettings = new Set(scopes.get('Settings')?.fields.map(field => field.name));
      const requiredSettings = ['enabled', 'notOlderThan', 'maxDuration', 'maxPageSize', 'maxNumberOfFields', 'availableFields'];
      if (!requiredSettings.every(field => supportedSettings.has(field))) return result;
      await Promise.all((['zones', 'accounts'] as const).map(async scope => {
        const datasets = Object.values(result).filter(dataset => dataset.scope === scope && dataset.id && dataset.filterType &&
          settingsTypes.get(scope === 'zones' ? 'ZoneSettings' : 'AccountSettings')?.fields.some(field => field.name === dataset.node));
        if (!datasets.length) return;
        try {
          const response = await this.client.graphql<Envelope>(`query($id:string!){viewer{${scope}(filter:{${scope === 'zones' ? 'zoneTag' : 'accountTag'}:$id}){settings{${datasets.map(dataset => `${dataset.node}{${requiredSettings.join(' ')}}`).join(' ')}}}}}`, { id: datasets[0].id });
          const settings = object(response.data?.viewer?.[scope]?.[0]?.settings);
          for (const dataset of datasets) {
            const raw = object(settings[dataset.node]);
            if (typeof raw.enabled !== 'boolean' || !Array.isArray(raw.availableFields)) continue;
            dataset.limits = { enabled: raw.enabled, notOlderThan: numeric(raw.notOlderThan) || 0,
              maxDuration: numeric(raw.maxDuration) || 0, maxPageSize: numeric(raw.maxPageSize) || 0,
              maxNumberOfFields: numeric(raw.maxNumberOfFields) || 0, availableFields: raw.availableFields.filter((item): item is string => typeof item === 'string') };
            dataset.fields = new Set([...dataset.fields].filter(item => dataset.limits!.availableFields.includes(item)));
            dataset.reason = raw.enabled ? null : 'Dataset không được cấp quyền hoặc không khả dụng trên gói/token Cloudflare hiện tại.';
          }
        } catch (error) { for (const dataset of datasets) dataset.reason = message(error); }
      }));
    } catch (error) { for (const dataset of Object.values(result)) dataset.reason = message(error); }
    return result;
  }

  private reason(dataset: Dataset, seconds: number): string | null {
    if (dataset.reason) return dataset.reason;
    const host = dataset.scope === 'zones' ? 'clientRequestHTTPHost' : 'requestHost';
    if (!dataset.filters.has(host) || !dataset.fields.has(`dimensions_${host}`) ||
      !['datetime_geq', 'datetime_lt'].every(field => dataset.filters.has(field))) return 'Dataset không hỗ trợ lọc an toàn theo hostname/thời gian.';
    if (!dataset.limits?.enabled || seconds > dataset.limits.maxDuration || seconds + LAG_SECONDS > dataset.limits.notOlderThan)
      return 'Khoảng thời gian vượt giới hạn truy vấn/lưu trữ của dataset này.';
    return null;
  }

  private async slices(dataset: Dataset, from: string, to: string, specs: Slice[]): Promise<Record<string, unknown[] | null>> {
    const filter: Record<string, unknown> = { datetime_geq: from, datetime_lt: to,
      [dataset.scope === 'zones' ? 'clientRequestHTTPHost' : 'requestHost']: this.client.hostname };
    if (dataset.scope === 'zones' && dataset.filters.has('requestSource') && dataset.fields.has('dimensions_requestSource')) filter.requestSource = 'eyeball';
    const aliases = specs.filter(spec => spec.fields.every(field => dataset.fields.has(field)) &&
      (!spec.dimension || dataset.fields.has(`dimensions_${spec.dimension}`)) &&
      (!spec.order || dataset.order.has(spec.order)) && (spec.top || 1) <= (dataset.limits?.maxPageSize || 0));
    const result: Record<string, unknown[] | null> = Object.fromEntries(specs.map(spec => [spec.alias, null]));
    if (!aliases.length) return result;
    const queryFields = (spec: Slice) => {
      const fields = spec.fields.filter(field => !field.includes('_'));
      for (const parent of ['sum', 'avg']) {
        const children = spec.fields.filter(field => field.startsWith(`${parent}_`)).map(field => field.slice(parent.length + 1));
        if (children.length) fields.push(`${parent}{${children.join(' ')}}`);
      }
      if (spec.dimension) fields.push(`dimensions{${spec.dimension}}`);
      return fields.join(' ');
    };
    // Respect per-node field budget across aliases. Split only if the real limit requires it.
    const batches: Slice[][] = [];
    let used = 0;
    for (const spec of aliases) {
      const size = spec.fields.length + (spec.dimension ? 1 : 0);
      if (size > (dataset.limits?.maxNumberOfFields || 0)) continue;
      if (!batches.length || used + size > dataset.limits!.maxNumberOfFields) { batches.push([]); used = 0; }
      batches[batches.length - 1].push(spec); used += size;
    }
    for (const batch of batches) {
      const selections = batch.map(spec => `${spec.alias}:${dataset.node}(limit:${spec.top || 1},filter:$filter${spec.order ? `,orderBy:[${spec.order}]` : ''}){${queryFields(spec)}}`).join('\n');
      const response = await this.client.graphql<Envelope>(`query($id:string!,$filter:${dataset.filterType}!){viewer{${dataset.scope}(filter:{${dataset.scope === 'zones' ? 'zoneTag' : 'accountTag'}:$id}){${selections}}}}`, { id: dataset.id, filter });
      const data = response.data?.viewer?.[dataset.scope]?.[0];
      for (const spec of batch) if (Array.isArray(data?.[spec.alias])) result[spec.alias] = data[spec.alias] as unknown[];
    }
    return result;
  }

  private async load(requested?: AnalyticsRange): Promise<CloudflareAnalytics> {
    const generated = Date.now();
    const discovered = await this.capabilities();
    const available = allowedRanges(discovered.rum.limits);
    // Customer-facing metrics use RUM's limits; technical datasets are checked independently.
    const ranges = available.length ? available : allowedRanges(discovered.http.limits);
    const range = requested || (ranges.find(item => item.id === '24h') || ranges[0])?.id || '1h';
    if (requested && ranges.length && !ranges.some(item => item.id === requested)) throw new BadRequestException('Khoảng thời gian vượt giới hạn Cloudflare hiện tại');
    const seconds = ANALYTICS_RANGES.find(item => item.id === range)!.seconds;
    const end = generated - LAG_SECONDS * 1000;
    const from = new Date(end - seconds * 1000).toISOString(), to = new Date(end).toISOString();
    const limits = (dataset: Dataset): DatasetLimits | null => dataset.limits ? {
      enabled: dataset.limits.enabled, notOlderThan: dataset.limits.notOlderThan, maxDuration: dataset.limits.maxDuration,
      maxPageSize: dataset.limits.maxPageSize, maxNumberOfFields: dataset.limits.maxNumberOfFields,
    } : null;
    const response: CloudflareAnalytics = {
      hostname: this.client.hostname, generatedAt: new Date(generated).toISOString(), expiresAt: new Date(generated + ANALYTICS_TTL_MS).toISOString(),
      period: { range, from, to, lagSeconds: LAG_SECONDS }, availableRanges: ranges.map(({ id, label }) => ({ id, label })),
      http: { limits: limits(discovered.http), reason: this.reason(discovered.http, seconds), requests: null, bytes: null, visits: null,
        sampleInterval: null, trend: null, countries: null, paths: null, cache: null, cacheHitRatio: null },
      webAnalytics: { limits: limits(discovered.rum), reason: this.reason(discovered.rum, seconds), pageViews: null, visits: null, uniqueVisitors: null,
        trend: null, bucket: seconds <= 3600 ? 'minute' : seconds <= 86400 ? 'hour' : 'day', devices: null, countries: null,
        pages: null, cars: null, carsReason: null, pathsLimited: false, pathsLimit: Math.min(1000, discovered.rum.limits?.maxPageSize || 0) },
      security: { limits: limits(discovered.security), reason: this.reason(discovered.security, seconds), events: null, actions: null },
    };
    const rows = (values: unknown[] | null, dimension: string): AnalyticsRow[] | null => {
      if (!values) return null;
      const mapped = values.map(value => { const row = object(value); const name = object(row.dimensions)[dimension];
        return typeof name === 'string' && numeric(row.count) !== null ? { name, count: numeric(row.count)! } : null; });
      return mapped.every((row): row is AnalyticsRow => row !== null) ? mapped : null;
    };
    await Promise.all([
      (async () => {
        if (response.http.reason) return;
        try {
          const dataset = discovered.http;
          const optional = ['sum_edgeResponseBytes', 'sum_visits', 'avg_sampleInterval'].filter(field => dataset.fields.has(field));
          const time = seconds <= 3600 ? 'datetimeMinute' : seconds <= 86400 ? 'datetimeHour' : 'date';
          const data = await this.slices(dataset, from, to, [
            { alias: 'total', fields: ['count', ...optional] },
            { alias: 'trend', fields: ['count'], dimension: time, top: 100, order: `${time}_ASC` },
            { alias: 'countries', fields: ['count'], dimension: 'clientCountryName', top: 10, order: 'count_DESC' },
            { alias: 'paths', fields: ['count'], dimension: 'clientRequestPath', top: 10, order: 'count_DESC' },
            { alias: 'cache', fields: ['count'], dimension: 'cacheStatus', top: 100, order: 'count_DESC' },
          ]);
          const total = object(data.total?.[0]);
          response.http.requests = data.total?.length === 0 ? 0 : numeric(total.count);
          response.http.bytes = dataset.fields.has('sum_edgeResponseBytes') ? (data.total?.length === 0 ? 0 : numeric(object(total.sum).edgeResponseBytes)) : null;
          response.http.visits = dataset.fields.has('sum_visits') ? (data.total?.length === 0 ? 0 : numeric(object(total.sum).visits)) : null;
          response.http.sampleInterval = dataset.fields.has('avg_sampleInterval') ? numeric(object(total.avg).sampleInterval) : null;
          response.http.trend = data.trend?.length === 100 ? null : rows(data.trend, time);
          response.http.countries = rows(data.countries, 'clientCountryName');
          response.http.paths = rows(data.paths, 'clientRequestPath');
          response.http.cache = data.cache?.length === 100 ? null : rows(data.cache, 'cacheStatus');
          if (response.http.cache) {
            const denominator = response.http.cache.reduce((sum, row) => sum + row.count, 0);
            response.http.cacheHitRatio = denominator ? response.http.cache.filter(row => row.name.toLowerCase() === 'hit').reduce((sum, row) => sum + row.count, 0) / denominator : null;
          }
          if (response.http.requests === null) response.http.reason = 'Tổng HTTP không khả dụng; các nhóm có dữ liệu vẫn được hiển thị.';
        } catch (error) { response.http.reason = message(error); }
      })(),
      (async () => {
        if (response.webAnalytics.reason) return;
        try {
          const fields = ['count', ...(discovered.rum.fields.has('sum_visits') ? ['sum_visits'] : [])];
          const time = seconds <= 3600 ? 'datetimeMinute' : 'datetimeHour';
          const limit = Math.min(1000, discovered.rum.limits?.maxPageSize || 0);
          const data = await this.slices(discovered.rum, from, to, [
            { alias: 'total', fields },
            { alias: 'trend', fields, dimension: time, top: limit, order: `${time}_ASC` },
            { alias: 'devices', fields: ['count'], dimension: 'deviceType', top: Math.min(100, limit), order: 'count_DESC' },
            { alias: 'countries', fields: ['count'], dimension: 'countryName', top: 10, order: 'count_DESC' },
            { alias: 'pages', fields: ['count'], dimension: 'requestPath', top: limit, order: 'count_DESC' },
          ]);
          const total = object(data.total?.[0]);
          // Empty permitted RUM response does not prove a beacon is installed: report N/A.
          response.webAnalytics.pageViews = numeric(total.count);
          response.webAnalytics.visits = discovered.rum.fields.has('sum_visits') ? numeric(object(total.sum).visits) : null;
          const traffic = rows(data.trend, time);
          if (traffic && data.trend && data.trend.length < limit) {
            const buckets = new Map<string, AnalyticsTrafficRow>();
            traffic.forEach((row, index) => {
              const visits = discovered.rum.fields.has('sum_visits') ? numeric(object(object(data.trend![index]).sum).visits) : null;
              // Aggregate hourly data into Vietnamese calendar days, not UTC dates.
              const name = response.webAnalytics.bucket === 'day' ? new Date(Date.parse(row.name) + 7 * 3600_000).toISOString().slice(0, 10) : row.name;
              const previous = buckets.get(name);
              buckets.set(name, { name, count: (previous?.count || 0) + row.count,
                visits: visits === null || previous?.visits === null ? null : (previous?.visits || 0) + visits });
            });
            response.webAnalytics.trend = [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name));
          }
          response.webAnalytics.devices = data.devices?.length === Math.min(100, limit) ? null : rows(data.devices, 'deviceType');
          response.webAnalytics.countries = rows(data.countries, 'countryName');
          const paths = rows(data.pages, 'requestPath');
          response.webAnalytics.pages = paths?.slice(0, 10) || null;
          response.webAnalytics.pathsLimited = data.pages?.length === limit;
          if (paths) {
            try { response.webAnalytics.cars = await this.carLabels.resolve(paths); }
            catch { response.webAnalytics.carsReason = 'Chưa đối chiếu được tên xe. Các thống kê truy cập khác vẫn hoạt động.'; }
          }
          if (response.webAnalytics.pageViews === null) response.webAnalytics.reason = 'Chưa có dữ liệu Web Analytics cho hostname/thời gian này. Kiểm tra beacon và quyền account Analytics.';
        } catch (error) { response.webAnalytics.reason = message(error); }
      })(),
      (async () => {
        if (response.security.reason) return;
        try {
          const data = await this.slices(discovered.security, from, to, [
            { alias: 'total', fields: ['count'] }, { alias: 'actions', fields: ['count'], dimension: 'action', top: 100, order: 'count_DESC' },
          ]);
          response.security.events = data.total?.length === 0 ? 0 : numeric(object(data.total?.[0]).count);
          response.security.actions = data.actions?.length === 100 ? null : rows(data.actions, 'action');
          if (response.security.events === null) response.security.reason = 'Cloudflare chưa trả dữ liệu sự kiện bảo mật.';
        } catch (error) { response.security.reason = message(error); }
      })(),
    ]);
    return response;
  }
}
