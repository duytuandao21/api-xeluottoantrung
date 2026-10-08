import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, sql } from 'drizzle-orm';
import { brands, carModels, cars, carRecommendationProfiles, recommendationEvents, recommendationSessions } from '../../database/schema/index.js';
import { RecommendationRepository } from './repository.js';
import type { DateRangeQuery, HistoryQuery, ProfileQuery } from './admin.dto.js';
import type { Question } from './domain.js';
import { ASSESSMENT_CATALOG } from './assessment-catalog.js';
const day = (date: Date) => new Date(date.getTime() + 7 * 3600000).toISOString().slice(0, 10);
export function reportRange(query: DateRangeQuery) {
  const to = query.to || day(new Date()), endDay = new Date(`${to}T00:00:00+07:00`);
  if (!Number.isFinite(endDay.getTime()) || day(endDay) !== to) throw new BadRequestException('Ngày kết thúc không hợp lệ.');
  const from = query.from || day(new Date(endDay.getTime() - 29 * 86400000)), start = new Date(`${from}T00:00:00+07:00`);
  if (!Number.isFinite(start.getTime()) || day(start) !== from || start > endDay || endDay.getTime() - start.getTime() > 365 * 86400000) throw new BadRequestException('Khoảng ngày phải hợp lệ, tối đa 366 ngày.');
  return { from, to, start, end: new Date(endDay.getTime() + 86400000), timezone: 'Asia/Ho_Chi_Minh' };
}
function historyWhere(query: HistoryQuery) {
  const range = reportRange(query);
  if (query.minBudget !== undefined && query.maxBudget !== undefined && query.minBudget > query.maxBudget) throw new BadRequestException('Khoảng ngân sách không hợp lệ.');
  return and(gte(recommendationSessions.createdAt, range.start), lt(recommendationSessions.createdAt, range.end),
    query.minBudget !== undefined ? sql`(${recommendationSessions.criteria}->>'budgetMax')::bigint >= ${query.minBudget}` : undefined,
    query.maxBudget !== undefined ? sql`(${recommendationSessions.criteria}->>'budgetMin')::bigint <= ${query.maxBudget}` : undefined,
    query.purpose ? sql`${recommendationSessions.criteria} @> ${JSON.stringify({ purposes: [query.purpose] })}::jsonb` : undefined,
    query.priority ? sql`${recommendationSessions.criteria} @> ${JSON.stringify({ priorities: [query.priority] })}::jsonb` : undefined,
    query.passengers ? sql`${recommendationSessions.answers}->>'passengers' = ${query.passengers}` : undefined,
    query.resultCount !== undefined ? eq(recommendationSessions.resultCount, query.resultCount) : undefined,
    query.search ? sql`${recommendationSessions.id}::text LIKE ${query.search.toLowerCase() + '%'}` : undefined,
    query.interaction === 'none' ? sql`NOT EXISTS (SELECT 1 FROM ${recommendationEvents} e WHERE e.session_id = ${recommendationSessions.id})` : query.interaction ? sql`EXISTS (SELECT 1 FROM ${recommendationEvents} e WHERE e.session_id = ${recommendationSessions.id} AND e.type = ${query.interaction})` : undefined);
}
@Injectable()
export class RecommendationReporting {
  constructor(@Inject(RecommendationRepository) private readonly repo: RecommendationRepository) {}
  async sessions(query: HistoryQuery) {
    const where = historyWhere(query), db = this.repo.database.db;
    const [rows, totals] = await Promise.all([
      db.select({ id: recommendationSessions.id, createdAt: recommendationSessions.createdAt, criteria: recommendationSessions.criteria, answers: recommendationSessions.answers,
        questions: sql<Question[]>`${recommendationSessions.snapshot}->'questions'`, resultCount: recommendationSessions.resultCount, topScore: recommendationSessions.topScore, completionMs: recommendationSessions.completionMs,
        eventCount: sql<number>`(SELECT count(*)::int FROM ${recommendationEvents} e WHERE e.session_id = ${recommendationSessions.id})`,
        interactions: sql<string[]>`ARRAY(SELECT DISTINCT e.type FROM ${recommendationEvents} e WHERE e.session_id = ${recommendationSessions.id} ORDER BY e.type)` })
        .from(recommendationSessions).where(where).orderBy(desc(recommendationSessions.createdAt), asc(recommendationSessions.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      db.select({ total: count() }).from(recommendationSessions).where(where),
    ]);
    return { data: rows.map(({ questions, ...row }) => ({ ...row, labels: Object.fromEntries(questions.map(q => [q.key, Object.fromEntries(q.options.map(o => [o.key, o.label]))])) })), meta: { page: query.page, limit: query.limit, total: totals[0].total, totalPages: Math.ceil(totals[0].total / query.limit) } };
  }
  async detail(id: string) {
    const detail = await this.repo.detail(id); if (!detail) return null;
    const ids = detail.snapshot.results.map(result => result.car.id);
    const currentCars = ids.length ? await this.repo.database.db.select({ id: cars.id, name: cars.name, slug: cars.slug, status: cars.status, price: cars.price, publishedAt: cars.publishedAt, deletedAt: cars.deletedAt }).from(cars).where(inArray(cars.id, ids)) : [];
    const available = new Set((await this.repo.inventory(this.repo.database.db, ids)).map(car => car.id));
    return { ...detail, currentCars: currentCars.map(car => ({ ...car, isAvailable: available.has(car.id) })) };
  }
  async profiles(query: ProfileQuery) {
    const db = this.repo.database.db, known = sql<number>`(SELECT count(*)::int FROM jsonb_each(coalesce(${carRecommendationProfiles.assessments}, '{}'::jsonb)) a WHERE a.key IN (${sql.join(ASSESSMENT_CATALOG.map(item => sql`${item.key}`), sql`, `)}) AND a.value->>'score' IN ('1','2','3','4','5') AND jsonb_typeof(a.value->'score')='number' AND jsonb_typeof(a.value->'source')='string' AND length(trim(a.value->>'source'))>=3)`;
    const where = and(isNull(cars.deletedAt), query.search ? ilike(cars.name, `%${query.search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
      query.brandId ? eq(cars.brandId, query.brandId) : undefined, query.modelId ? eq(cars.modelId, query.modelId) : undefined,
      query.status ? sql`${cars.status} = ${query.status}` : undefined, query.missing === 'true' ? sql`${known} < ${ASSESSMENT_CATALOG.length}` : query.missing === 'false' ? sql`${known} = ${ASSESSMENT_CATALOG.length}` : undefined);
    const [rows, total] = await Promise.all([
      db.select({ id: cars.id, name: cars.name, slug: cars.slug, year: cars.year, price: cars.price, status: cars.status, publishedAt: cars.publishedAt, brand: brands.name, model: carModels.name, knownCount: known, updatedAt: carRecommendationProfiles.updatedAt })
        .from(cars).leftJoin(brands, eq(brands.id, cars.brandId)).leftJoin(carModels, eq(carModels.id, cars.modelId)).leftJoin(carRecommendationProfiles, eq(carRecommendationProfiles.carId, cars.id)).where(where).orderBy(desc(cars.createdAt), asc(cars.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      db.select({ total: count() }).from(cars).leftJoin(carRecommendationProfiles, eq(carRecommendationProfiles.carId, cars.id)).where(where),
    ]);
    return { data: rows, meta: { page: query.page, limit: query.limit, total: total[0].total, totalPages: Math.ceil(total[0].total / query.limit) } };
  }
  async overview(query: DateRangeQuery) {
    const range = reportRange(query);
    const result = await this.repo.database.db.execute(sql`
      WITH s AS (SELECT id, created_at, criteria, answers, snapshot, result_count FROM recommendation_sessions WHERE created_at >= ${range.start.toISOString()} AND created_at < ${range.end.toISOString()}),
      e AS (SELECT e.* FROM recommendation_events e JOIN s ON s.id=e.session_id),
      counts AS (SELECT count(*)::int total, count(*) FILTER (WHERE result_count=0)::int empty FROM s),
      factors AS (
        SELECT 'purposes' field, v.key, s.result_count=0 unmet FROM s CROSS JOIN LATERAL jsonb_array_elements_text(criteria->'purposes') v(key)
        UNION ALL SELECT 'priorities', v.key, s.result_count=0 FROM s CROSS JOIN LATERAL jsonb_array_elements_text(criteria->'priorities') v(key)
        UNION ALL SELECT 'environment', criteria->>'environment', result_count=0 FROM s
        UNION ALL SELECT 'passengers', answers->>'passengers', result_count=0 FROM s
        UNION ALL SELECT 'brand', coalesce(nullif(criteria->'technical'->>'brand',''),'unspecified'), result_count=0 FROM s
        UNION ALL SELECT 'bodyStyle', coalesce(nullif(criteria->'technical'->>'bodyStyle',''),'unspecified'), result_count=0 FROM s
        UNION ALL SELECT 'fuel', coalesce(nullif(criteria->'technical'->>'fuel',''),'unspecified'), result_count=0 FROM s
        UNION ALL SELECT 'transmission', coalesce(nullif(criteria->'technical'->>'transmission',''),'unspecified'), result_count=0 FROM s
      ), distribution AS (SELECT field,key,count(*)::int count,count(*) FILTER(WHERE unmet)::int unmet FROM factors GROUP BY field,key),
      budgets AS (SELECT CASE WHEN (criteria->>'budgetMax')::bigint<=300000000 THEN 'under300' WHEN (criteria->>'budgetMax')::bigint<=500000000 THEN '300to500' WHEN (criteria->>'budgetMax')::bigint<=800000000 THEN '500to800' WHEN (criteria->>'budgetMax')::bigint<=1000000000 THEN '800to1000' ELSE 'over1000' END key, count(*)::int count,count(*) FILTER(WHERE result_count=0)::int unmet FROM s GROUP BY 1),
      recommended AS (SELECT item->'car'->>'id' car_id,max(item->'car'->>'name') name,count(DISTINCT s.id)::int recommendations FROM s CROSS JOIN LATERAL jsonb_array_elements(snapshot->'results') item GROUP BY 1),
      clicked AS (SELECT car_id::text car_id,count(DISTINCT session_id)::int clicks FROM e WHERE type='car_clicked' GROUP BY 1),
      top_cars AS (SELECT r.*,coalesce(k.clicks,0) clicks,c.status,c.deleted_at IS NOT NULL removed FROM recommended r LEFT JOIN clicked k USING(car_id) LEFT JOIN cars c ON c.id::text=r.car_id ORDER BY recommendations DESC,clicks DESC,r.car_id LIMIT 20),
      top_clicked AS (SELECT r.*,k.clicks,c.status,c.deleted_at IS NOT NULL removed FROM recommended r JOIN clicked k USING(car_id) LEFT JOIN cars c ON c.id::text=r.car_id ORDER BY clicks DESC,recommendations DESC,r.car_id LIMIT 20),
      days AS (SELECT generate_series(${range.start.toISOString()}::timestamptz, ${range.end.toISOString()}::timestamptz - interval '1 day', interval '1 day') AS at),
      trend AS (SELECT to_char(days.at AT TIME ZONE 'Asia/Ho_Chi_Minh','YYYY-MM-DD') AS "day", count(s.id)::int count,count(s.id) FILTER(WHERE s.result_count=0)::int unmet FROM days LEFT JOIN s ON s.created_at>=days.at AND s.created_at<days.at+interval '1 day' GROUP BY days.at ORDER BY days.at)
      SELECT jsonb_build_object('total', counts.total,'empty',counts.empty,
        'viewed',(SELECT count(DISTINCT session_id)::int FROM e WHERE type='result_viewed'),
        'carClicked',(SELECT count(DISTINCT session_id)::int FROM e WHERE type='car_clicked'),
        'contactClicked',(SELECT count(DISTINCT session_id)::int FROM e WHERE type='contact_clicked'),
        'eventCount',(SELECT count(*)::int FROM e),
        'distributions',coalesce((SELECT jsonb_agg(distribution ORDER BY field,count DESC,key) FROM distribution),'[]'::jsonb),
        'budgets',coalesce((SELECT jsonb_agg(budgets ORDER BY key) FROM budgets),'[]'::jsonb),
        'topCars',coalesce((SELECT jsonb_agg(top_cars) FROM top_cars),'[]'::jsonb),
        'topClicked',coalesce((SELECT jsonb_agg(top_clicked) FROM top_clicked),'[]'::jsonb),
        'trend',coalesce((SELECT jsonb_agg(trend ORDER BY "day") FROM trend),'[]'::jsonb)) data FROM counts
    `);
    const data = result.rows[0].data as { total: number; empty: number; viewed: number; carClicked: number; contactClicked: number; eventCount: number; distributions: { field: string; key: string; count: number; unmet: number }[]; budgets: { key: string; count: number; unmet: number }[]; topCars: { car_id: string; name: string; recommendations: number; clicks: number; status: string | null; removed: boolean }[]; trend: { day: string; count: number; unmet: number }[] };
    const topClicked = result.rows[0].data as typeof data & { topClicked: typeof data.topCars };
    const percent = (n: number, d = data.total) => d ? Math.round(n / d * 1000) / 10 : 0;
    const settings = await this.repo.settings(), lookups = await this.repo.lookups();
    return { range: { from: range.from, to: range.to, timezone: range.timezone }, ...data,
      rates: { viewed: percent(data.viewed), carClicked: percent(data.carClicked), contactClicked: percent(data.contactClicked), empty: percent(data.empty) },
      topCars: data.topCars.map(car => ({ ...car, clickRate: percent(car.clicks, car.recommendations) })),
      topClicked: topClicked.topClicked.map(car => ({ ...car, clickRate: percent(car.clicks, car.recommendations) })),
      labels: { ...Object.fromEntries(settings.config.questions.map(q => [q.key, Object.fromEntries(q.options.map(o => [o.key, o.label]))])), ...Object.fromEntries(Object.entries(lookups).map(([key, options]) => [key, Object.fromEntries(options.map(option => [option.key, option.label]))])) } };
  }
}
