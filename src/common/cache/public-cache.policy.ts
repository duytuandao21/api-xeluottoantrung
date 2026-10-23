const settings = new Set(['thiet-lap-thong-tin', 'thiet-lap-logo', 'thiet-lap-favicon', 'thiet-lap-footer', 'tv-display']);
const contentGroups = new Set([
  'thiet-lap-quy-trinh-ban-xe', 'thiet-lap-cac-buoc-mua-xe', 'thiet-lap-cac-buoc-ban-xe',
  'thiet-lap-cac-buoc-len-doi', 'thiet-lap-banner-dong-xe', 'thiet-lap-mang-xa-hoi', 'thiet-lap-ung-dung',
  // Public CMS publications only. Admin writes invalidate these synchronously.
  'thiet-lap-chinh-sach-dieu-kien', 'thiet-lap-nut-goi',
  'thiet-lap-goi-y-nam-san-xuat', 'thiet-lap-tai-sao-chon', 'quan-ly-gioi-thieu',
]);
const lookups = new Set(['car-versions', 'body-styles', 'transmissions', 'car-colors', 'branch-regions', 'branches', 'filter-options']);
const lists = new Set(['articles', 'article-categories', 'faqs', 'testimonials', 'services', 'recruitments', 'slides', 'accessory-brands', 'accessory-categories']);

// A fixed namespace for both limiter buckets and diagnostics. Unknown groups,
// extra query parameters and duplicate groups never create new buckets.
export function publicContentGroup(rawUrl: string): string | undefined {
  if (rawUrl.split('?')[0] !== '/api/v1/content') return;
  const query = new URL(rawUrl, 'http://cache.internal').searchParams;
  const group = query.get('group') ?? '';
  return query.size === 1 && contentGroups.has(group) ? group : undefined;
}

export function publicLookupResource(rawUrl: string): string | undefined {
  const match = /^\/api\/v1\/lookups\/([^/?]+)(?:\?|$)/.exec(rawUrl);
  return match && lookups.has(match[1]) ? match[1] : undefined;
}

export function publicCachePolicy(rawUrl: string): { key: string; ttlMs: number } | undefined {
  // Keep the exact path and all query values. Only parameter name order changes;
  // repeated values retain their order, and DTO defaults/aliases are not guessed.
  const url = new URL(rawUrl, 'http://cache.internal');
  if (url.pathname !== rawUrl.split('?')[0]) return;
  if (!url.pathname.startsWith('/api/v1/')) return;
  const path = url.pathname.slice('/api/v1'.length);
  const parts = path.slice(1).split('/');
  let ttlMs: number | undefined;
  if (path === '/cars/menu' && url.searchParams.size === 1 && ['new-arrivals', 'discounts'].includes(url.searchParams.get('section') ?? '')) ttlMs = 30_000;
  else if (path === '/cars' && (url.searchParams.get('new_arrival') === 'true' || url.searchParams.get('discounted') === 'true')) ttlMs = 30_000;
  else if (path === '/seo' && url.searchParams.has('route')) ttlMs = 300_000;
  else if (/^\/brands\/[^/]+\/models$/.test(path)) ttlMs = 900_000;
  else if (parts[0] === 'lookups' && parts.length === 2 && lookups.has(parts[1]))
    ttlMs = ['branches', 'branch-regions'].includes(parts[1]) ? 300_000 : 900_000;
  else if (parts[0] === 'branches' && parts.length <= 2) ttlMs = 300_000;
  else if (parts[0] === 'site-settings' && parts.length === 2 && settings.has(parts[1])) ttlMs = 300_000;
  else if (path === '/content' && publicContentGroup(rawUrl)) ttlMs = 300_000;
  else if (parts.length === 1 && lists.has(parts[0])) ttlMs = 300_000;
  else if (parts.length === 2 && ['articles', 'faqs', 'services', 'recruitments'].includes(parts[0])) ttlMs = 300_000;
  if (!ttlMs) return;
  // Free-form searches can contain PII and have unbounded cardinality.
  if (url.searchParams.has('search') || url.searchParams.has('q')) return;
  url.searchParams.sort();
  return { key: `public:v1:${path}?${url.searchParams}`, ttlMs };
}
