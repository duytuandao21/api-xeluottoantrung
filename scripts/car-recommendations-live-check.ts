// Explicit development/test only. Never prints connection strings, tokens or customer data.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import * as schema from '../src/database/schema/index.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { seedCarRecommendations } from '../src/database/seed/car-recommendations.js';
import { RecommendationRepository } from '../src/modules/car-recommendations/repository.js';
import { RecommendationService } from '../src/modules/car-recommendations/service.js';
import { RecommendationReporting } from '../src/modules/car-recommendations/reporting.js';
import { RecommendationAdminService } from '../src/modules/car-recommendations/admin.service.js';
import type { SessionDto } from '../src/modules/car-recommendations/dto.js';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 10000, statement_timeout: 15000 });
let sessionId: string | undefined;
try {
  assert.ok(process.argv.includes('--development-test'), 'Development/test confirmation is required');
  const db = drizzle(pool, { schema });
  if (process.argv.includes('--apply-schema')) {
    const journal = JSON.parse(await readFile('drizzle/meta/_journal.json', 'utf8')) as { entries: { tag: string; when: number }[] };
    const latest = journal.entries.at(-1)!, previous = journal.entries.at(-2)!;
    assert.equal(latest.tag, '0016_peaceful_iron_lad');
    const ledger = await pool.query('SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1');
    assert.ok([previous.when, latest.when].includes(Number(ledger.rows[0]?.created_at)), 'Apply prior migrations through the normal release process first');
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log({ migration: latest.tag, applied: true });
  }
  console.log({ seed: await seedCarRecommendations(db), secondSeed: await seedCarRecommendations(db) });
  const repository = new RecommendationRepository({ db } as DatabaseService), service = new RecommendationService(repository);
  const admin = new RecommendationAdminService(repository), reporting = new RecommendationReporting(repository);
  const [overview, history, profiles, settings] = await Promise.all([reporting.overview({}), reporting.sessions({ page: 1, limit: 1 }), reporting.profiles({ page: 1, limit: 1 }), admin.settings()]);
  assert.equal(overview.trend.reduce((n, day) => n + day.count, 0), overview.total);
  assert.ok(overview.carClicked <= overview.total && overview.contactClicked <= overview.total);
  assert.equal(settings.id, 1);
  console.log({ adminReadSmoke: 'passed', surveysLast30Days: overview.total, paginatedHistoryTotal: history.meta.total, stockProfilesTotal: profiles.meta.total, singleSettings: true });
  const config = await service.config(), inventory = await repository.inventory();
  const protections = await pool.query("SELECT bool_and(c.relrowsecurity) AS rls, bool_and(NOT has_table_privilege('anon', c.oid, 'SELECT')) AS anon_denied, bool_and(NOT has_table_privilege('authenticated', c.oid, 'SELECT')) AS authenticated_denied FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('recommendation_settings','recommendation_sessions','recommendation_events','car_recommendation_profiles')");
  assert.equal(protections.rows[0].rls, true); assert.equal(protections.rows[0].anon_denied, true); assert.equal(protections.rows[0].authenticated_denied, true);
  console.log({ enabled: config.enabled, questions: 'questions' in config ? config.questions.length : 0, eligibleStock: inventory.length, missingSeats: inventory.filter(car => car.seatCount === null).length, sourcedProfiles: inventory.filter(car => car.assessments && Object.keys(car.assessments).length > 0).length, protections: protections.rows[0] });
  assert.ok(config.enabled);
  const capability = randomBytes(32).toString('base64url');
  const input: SessionDto = { requestId: randomUUID(), capability, noticeAccepted: true, completionMs: 10000, answers: { purposes: ['family'], budget: { min: 0, max: Math.min(50000000000, Math.max(500000000, ...inventory.map(car => car.price))) }, passengers: '3_5', requireSeats: false, environment: 'city', priorities: ['space', 'comfort'], technical: { required: [] } } };
  const result = await service.submit(input); sessionId = result.sessionId;
  assert.ok(result.results.every(item => item.car.price <= input.answers.budget.max));
  assert.equal((await service.submit(input)).sessionId, sessionId);
  await service.event(sessionId, { capability, type: 'result_viewed' }); await service.event(sessionId, { capability, type: 'result_viewed' });
  const detail = await service.detail(sessionId); assert.deepEqual(detail.answers, input.answers); assert.equal(detail.events.length, 1);
  assert.equal((await service.resume(sessionId, capability)).results.length, result.results.length);
  assert.ok(result.results.length <= 6);
  const ids = result.results.map(item => item.car.id);
  let page = result;
  while (page.hasMore) {
    const previousOffset = page.nextOffset;
    page = await service.resume(sessionId, capability, previousOffset);
    assert.ok(page.nextOffset > previousOffset);
    assert.ok(page.results.length <= 6);
    ids.push(...page.results.map(item => item.car.id));
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, result.totalAvailable);
  console.log({ liveSmoke: 'passed', results: result.results.length, topScore: result.results[0]?.score ?? null, topCoverage: result.results[0]?.coverage ?? null, retry: 'same session', events: 'deduplicated', artificialCars: 0, artificialProfiles: 0 });
} catch (error) {
  console.error({ liveSmoke: 'failed', kind: error instanceof Error ? error.name : 'UnknownError', message: 'No connection secrets or SQL parameters are printed.' }); process.exitCode = 1;
} finally {
  if (sessionId) {
    try { await drizzle(pool).delete(schema.recommendationSessions).where(eq(schema.recommendationSessions.id, sessionId)); console.log({ ownSmokeSession: 'removed', events: 'cascade' }); }
    catch { console.error('Could not remove the isolated smoke session.'); process.exitCode = 1; }
  }
  await pool.end();
}
