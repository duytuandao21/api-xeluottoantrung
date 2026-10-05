import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import type { SearchResultsQuery } from './search.dto.js';

type SearchRow = { id: string; kind: 'car' | 'accessory'; name: string; href: string; imageUrl: string | null; price: string | number };

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
}

// No extension or database migration needed for Vietnamese accent-insensitive names.
const accents = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const replacements = [...accents].map(letter => normalizeSearch(letter)).join('');
const fold = (column: SQL) => sql`translate(lower(${column}), ${accents}, ${replacements})`;
const pattern = (term: string) => term.replace(/[\\%_]/g, '\\$&');

function nameMatch(column: SQL, query: string): SQL {
  return sql.join([...new Set(query.split(' '))].map(term => sql`${fold(column)} LIKE ${`%${pattern(term)}%`}`), sql` AND `);
}
function rank(column: SQL, query: string): SQL {
  return sql`CASE WHEN ${fold(column)} = ${query} THEN 0 WHEN ${fold(column)} LIKE ${`${pattern(query)}%`} THEN 1 ELSE 2 END`;
}
function publicProducts(query: string, sellingOnly = false): SQL {
  return sql`
    SELECT c.id::text AS id, 'car'::text AS kind, c.name, ('/' || c.slug) AS href,
      (SELECT m.public_url FROM car_media m WHERE m.car_id = c.id AND m.is_cover = true AND m.deletion_pending_at IS NULL ORDER BY m.sort_order, m.id LIMIT 1) AS "imageUrl",
      c.price, ${rank(sql`c.name`, query)} AS relevance, c.featured AS featured, c.created_at
    FROM cars c
    JOIN brands b ON b.id = c.brand_id AND b.status = 'active'
    JOIN car_models model ON model.id = c.model_id AND model.status = 'active'
    WHERE c.deleted_at IS NULL AND c.published_at IS NOT NULL AND c.status IN ('active', 'deposit', 'sold')
      AND (${sellingOnly} = false OR c.status IN ('active', 'deposit')) AND ${nameMatch(sql`(c.name || ' ' || b.name || ' ' || model.name)`, query)}
    UNION ALL
    SELECT a.id::text, 'accessory'::text, a.name, ('/phu-kien-o-to/' || a.id::text), a.image_url,
      a.price, ${rank(sql`a.name`, query)}, false, a.created_at
    FROM accessories a LEFT JOIN accessory_brands ab ON ab.id = a.brand_id
    WHERE a.status = 'active' AND ${nameMatch(sql`(a.name || ' ' || coalesce(ab.name, a.brand))`, query)}
  `;
}

function shortKeyword(name: string): string {
  const words = name.replace(/\s*[([（].*$/, '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6);
  while (words.join(' ').length > 42 && words.length > 1) words.pop();
  return words.join(' ').replace(/[\s–—-]+$/, '');
}

@Injectable()
export class SearchService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async keywords(q = '') {
    const query = normalizeSearch(q);
    const result = await this.database.db.execute<{ name: string }>(sql`
      WITH selling_cars AS (
        SELECT c.featured, c.created_at, b.name AS brand, model.name AS model
        FROM cars c JOIN brands b ON b.id = c.brand_id AND b.status = 'active'
        JOIN car_models model ON model.id = c.model_id AND model.status = 'active'
        WHERE c.deleted_at IS NULL AND c.published_at IS NOT NULL AND c.status IN ('active', 'deposit')
      ), selling_accessories AS (
        SELECT a.name, nullif(btrim(coalesce(brand.name, a.brand)), '') AS brand, a.created_at
        FROM accessories a LEFT JOIN accessory_brands brand ON brand.id = a.brand_id
        WHERE a.status = 'active' AND (brand.id IS NULL OR brand.status = 'active')
      ), tags AS (
        SELECT CASE WHEN left(lower(model), length(brand)) = lower(brand) THEN model ELSE (brand || ' ' || model) END AS name,
          0 AS category, bool_or(featured) AS featured, count(*) AS frequency, max(created_at) AS newest
        FROM selling_cars GROUP BY brand, model
        UNION ALL
        SELECT brand, 1, bool_or(featured), count(*), max(created_at) FROM selling_cars GROUP BY brand
        UNION ALL
        SELECT brand, 2, false, count(*), max(created_at) FROM selling_accessories WHERE brand IS NOT NULL GROUP BY brand
        UNION ALL
        SELECT name, 3, false, count(*), max(created_at) FROM selling_accessories GROUP BY name
      ), ranked AS (
        SELECT name, category, ${rank(sql`name`, query)} AS relevance,
          row_number() OVER (PARTITION BY category ORDER BY featured DESC, frequency DESC, newest DESC, name) AS position
        FROM tags WHERE ${nameMatch(sql`name`, query)}
      )
      SELECT name FROM ranked WHERE position <= ${query ? 6 : 3}
      ORDER BY relevance, position, category, name LIMIT 24
    `);
    const seen = new Set<string>();
    return result.rows.map(row => shortKeyword(row.name)).filter(name => {
      const key = normalizeSearch(name);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, query ? 6 : 8);
  }

  async recommendations() {
    const result = await this.database.db.execute<SearchRow>(sql`
      WITH ranked AS (
        SELECT *, row_number() OVER (PARTITION BY kind ORDER BY featured DESC, created_at DESC, id) AS position
        FROM (${publicProducts('', true)}) products
      )
      SELECT id, kind, name, href, "imageUrl", price FROM ranked WHERE position <= 2
      ORDER BY position, CASE WHEN kind = 'car' THEN 0 ELSE 1 END
    `);
    return result.rows.map(row => ({ ...row, price: Number(row.price) }));
  }

  async list(input: SearchResultsQuery) {
    const query = normalizeSearch(input.q || '');
    const { page, limit } = input;
    if (!query) return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
    const products = publicProducts(query);
    const [items, count] = await Promise.all([
      this.database.db.execute<SearchRow>(sql`SELECT id, kind, name, href, "imageUrl", price FROM (${products}) matches
        ORDER BY relevance, featured DESC, created_at DESC, kind, id LIMIT ${limit} OFFSET ${(page - 1) * limit}`),
      this.database.db.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM (${products}) matches`),
    ]);
    const total = count.rows[0]?.total ?? 0;
    return { data: items.rows.map(row => ({ ...row, price: Number(row.price) })), meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  async suggestions(q?: string) {
    if (!normalizeSearch(q || '')) {
      const [keywords, items] = await Promise.all([this.keywords(), this.recommendations()]);
      return { keywords, items, total: items.length };
    }
    const [keywords, result] = await Promise.all([this.keywords(q), this.list({ q, page: 1, limit: 5 })]);
    return { keywords, items: result.data, total: result.meta.total };
  }
}
