export const ANALYTICS_TTL_MS = 10 * 60_000;
export const ANALYTICS_RANGES = [
  { id: '1h', seconds: 3600, label: '1 giờ qua' },
  { id: '6h', seconds: 21600, label: '6 giờ qua' },
  { id: '24h', seconds: 86400, label: '24 giờ qua' },
  { id: '7d', seconds: 604800, label: '7 ngày qua' },
  { id: '30d', seconds: 2592000, label: '30 ngày qua' },
] as const;
export type AnalyticsRange = typeof ANALYTICS_RANGES[number]['id'];
export interface DatasetLimits {
  enabled: boolean;
  notOlderThan: number;
  maxDuration: number;
  maxPageSize: number;
  maxNumberOfFields: number;
}
export interface AnalyticsRow { name: string; count: number }
export interface AnalyticsTrafficRow extends AnalyticsRow { visits: number | null }
export interface AnalyticsCarRow extends AnalyticsRow { path: string }
export interface DatasetStatus { reason: string | null; limits: DatasetLimits | null }
export interface CloudflareAnalytics {
  hostname: string;
  generatedAt: string;
  expiresAt: string;
  period: { range: AnalyticsRange; from: string; to: string; lagSeconds: number };
  availableRanges: { id: AnalyticsRange; label: string }[];
  http: DatasetStatus & {
    requests: number | null;
    bytes: number | null;
    visits: number | null;
    sampleInterval: number | null;
    trend: AnalyticsRow[] | null;
    countries: AnalyticsRow[] | null;
    paths: AnalyticsRow[] | null;
    cache: AnalyticsRow[] | null;
    cacheHitRatio: number | null;
  };
  webAnalytics: DatasetStatus & {
    pageViews: number | null; visits: number | null; uniqueVisitors: null;
    trend: AnalyticsTrafficRow[] | null;
    bucket: 'minute' | 'hour' | 'day';
    devices: AnalyticsRow[] | null;
    countries: AnalyticsRow[] | null;
    pages: AnalyticsRow[] | null;
    cars: AnalyticsCarRow[] | null;
    carsReason: string | null;
    pathsLimited: boolean;
    pathsLimit: number;
  };
  security: DatasetStatus & { events: number | null; actions: AnalyticsRow[] | null };
}
