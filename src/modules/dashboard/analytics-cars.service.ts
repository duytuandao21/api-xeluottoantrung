import { Inject, Injectable } from '@nestjs/common';
import { and, inArray, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { cars } from '../../database/schema/index.js';
import type { AnalyticsCarRow, AnalyticsRow } from './analytics.types.js';

// Public vehicle detail URLs use /<slug>. Do not identify a car by its wording.
function slugFromPath(path: string): string | null {
  const match = /^\/([^/?#]+)\/?$/.exec(path);
  if (!match) return null;
  try {
    const slug = decodeURIComponent(match[1]);
    return slug.length <= 300 && !/[/?#\u0000]/.test(slug) ? slug : null;
  } catch { return null; }
}

@Injectable()
export class AnalyticsCarsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async resolve(paths: AnalyticsRow[]): Promise<AnalyticsCarRow[]> {
    // Bounded to the same maximum as the Cloudflare path query, not inventory size.
    const candidates = paths.slice(0, 1000).map(row => ({ row, slug: slugFromPath(row.name) })).filter(item => item.slug !== null);
    const slugs = [...new Set(candidates.map(item => item.slug!))];
    if (!slugs.length) return [];
    const matches = await this.database.db.select({ slug: cars.slug, name: cars.name }).from(cars)
      .where(and(inArray(cars.slug, slugs), isNull(cars.deletedAt)));
    const names = new Map(matches.map(car => [car.slug, car.name]));
    const totals = new Map<string, AnalyticsCarRow>();
    for (const { row, slug } of candidates) {
      const name = names.get(slug!);
      if (!name) continue;
      const previous = totals.get(slug!);
      totals.set(slug!, { name, path: `/${encodeURIComponent(slug!)}`, count: (previous?.count || 0) + row.count });
    }
    // Include sold/hidden vehicles still in the database: this is historical viewing data.
    return [...totals.values()].sort((a, b) => b.count - a.count || a.path.localeCompare(b.path)).slice(0, 10);
  }
}
