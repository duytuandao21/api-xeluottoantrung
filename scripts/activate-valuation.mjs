import 'reflect-metadata';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { valuationPolicies } from '../dist/database/schema/index.js';
import { ValuationRepository } from '../dist/modules/valuation/valuation.repository.js';
import { ValuationAdminService } from '../dist/modules/valuation/valuation.service.js';
import { ValuationEngineService, vietnamDate } from '../dist/modules/valuation/valuation-engine.service.js';

// One-time, explicitly authorized import from our own published inventory.
// No external price lookup, invented MSRP, or changes to vehicle/catalog records.
const VERSION = '1.0.0';
const NAME = 'Tham chiếu niêm yết Toàn Trung — khởi tạo';
const DISCLAIMER = 'Kết quả tham khảo từ giá niêm yết xe tại Toàn Trung và các tỷ lệ điều chỉnh khởi tạo; chưa phản ánh giá giao dịch thực tế hoặc tình trạng đã kiểm định. Giá thu mua sẽ được xác nhận sau khi kiểm tra xe, giấy tờ và trao đổi trực tiếp.';
const REASON = 'Chủ website giao chuẩn bị dữ liệu và bật tiện ích: dùng niêm yết nội bộ, tỷ lệ khởi tạo tham khảo, không xác nhận là giá giao dịch hay tỷ lệ đã hiệu chuẩn thị trường.';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });

function benchmarkInput(car) {
  return { brandId: car.brand_id, modelId: car.model_id, variantId: car.version_id,
    modelYear: car.year, odometerKm: car.mileage, exteriorCondition: 'ORIGINAL', interiorCondition: 'GOOD',
    accidentLevel: 'NONE', floodLevel: 'NONE', engineCondition: 'NORMAL', transmissionCondition: 'NORMAL',
    serviceHistory: 'PARTIAL', ownerCount: 2, usageType: 'PERSONAL' };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const apply = process.argv.includes('--apply');
  if (apply && !process.argv.includes('--development-test')) throw new Error('Apply requires --development-test; production is not authorized.');
  const db = drizzle(pool), at = new Date(), today = vietnamDate(at), year = Number(today.slice(0, 4));
  const effectiveFrom = new Date(`${today}T00:00:00+07:00`);
  const effectiveTo = new Date(effectiveFrom.getTime() + 30 * 86400000);
  const { rows } = await pool.query(`SELECT c.id,c.slug,c.name,c.year,c.price,c.mileage,c.brand_id,c.model_id,c.version_id,
    b.status AS brand_status,m.status AS model_status,v.status AS variant_status,
    m.brand_id AS model_brand_id,v.model_id AS version_model_id
    FROM cars c JOIN brands b ON b.id=c.brand_id JOIN car_models m ON m.id=c.model_id
    LEFT JOIN car_versions v ON v.id=c.version_id
    WHERE c.status='active' AND c.deleted_at IS NULL AND c.published_at IS NOT NULL ORDER BY c.id`);
  const eligible = [], skipped = [];
  for (const car of rows) {
    car.price = Number(car.price); car.mileage = car.mileage === null ? null : Number(car.mileage);
    const titleYears = [...car.name.matchAll(/\b(?:19|20)\d{2}\b/g)].map(match => Number(match[0]));
    const valid = car.version_id && ['brand_status','model_status','variant_status'].every(key => car[key] === 'active')
      && car.model_brand_id === car.brand_id && car.version_model_id === car.model_id
      && Number.isSafeInteger(car.price) && car.price > 0 && Number.isInteger(car.year) && car.year >= 1980 && car.year <= year
      && year - car.year <= 50 && car.mileage !== null && Number.isInteger(car.mileage) && car.mileage >= 0 && car.mileage <= 2000000
      && titleYears.every(titleYear => titleYear === car.year);
    if (valid) eligible.push(car);
    else skipped.push({ id: car.id, name: car.name, storedYear: car.year, reason: 'Năm trong tên hoặc dữ liệu giá/ODO/danh mục không nhất quán.' });
  }
  // Multiple listings of one variant/year require manual selection of a reference.
  const groups = new Map();
  for (const car of eligible) { const key = `${car.version_id}:${car.year}`; groups.set(key, (groups.get(key) ?? 0) + 1); }
  const selected = eligible.filter(car => {
    if (groups.get(`${car.version_id}:${car.year}`) === 1) return true;
    skipped.push({ id: car.id, name: car.name, storedYear: car.year, reason: 'Có nhiều niêm yết cùng phiên bản/năm; cần chọn giá nền trong Admin.' }); return false;
  });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'read-only plan', policy: VERSION, source: 'Published internal listing prices, not completed transactions',
    effectiveFrom: effectiveFrom.toISOString(), effectiveTo: effectiveTo.toISOString(),
    marketRangePercent: [-7, 7], dealerMarginPercent: [7, 12],
    prices: selected.map(car => ({ name: car.name, year: car.year, listingPrice: car.price, odometerKm: car.mileage, sourcePath: `/san-pham/${car.slug}` })), skipped }, null, 2));
  if (!apply) return;
  if (!selected.length) throw new Error('No eligible internal listing prices.');
  const { rows: actors } = await pool.query(`SELECT p.id FROM profiles p
    JOIN user_roles ur ON ur.profile_id=p.id JOIN roles r ON r.id=ur.role_id
    JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions pm ON pm.id=rp.permission_id
    WHERE p.status='active' AND p.deleted_at IS NULL AND r.code IN ('ADMIN','SUPER_ADMIN')
    AND pm.code IN ('valuation.settings.update','valuation.publish','valuation.policies.manage','valuation.reference_prices.manage','valuation.rules.manage')
    GROUP BY p.id HAVING count(DISTINCT pm.code)=5 ORDER BY p.id LIMIT 1`);
  if (!actors[0]) throw new Error('No active admin with all required valuation permissions.');
  const audit = { actorProfileId: actors[0].id, ipAddress: '127.0.0.1', userAgent: 'Authorized development/test valuation activation script', requestId: randomUUID() };
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(72419602)`);
    const repo = new ValuationRepository({ db: tx }), admin = new ValuationAdminService(repo), engine = new ValuationEngineService();
    const settings = await repo.settings(tx, true);
    const [existing] = await tx.select().from(valuationPolicies).where(eq(valuationPolicies.version, VERSION));
    if (existing) {
      if (existing.status === 'PUBLISHED' && existing.name === NAME && settings.isEnabled && settings.activePolicyId === existing.id)
        return { alreadyActive: true, policyId: existing.id, version: existing.version, message: 'Preserved unchanged; refresh prices/rules in Admin.' };
      throw new Error('Version 1.0.0 already exists; review in Admin. Existing data will not be overwritten.');
    }
    if (settings.activePolicyId || settings.isEnabled) throw new Error('An active policy already exists; this first activation tool will not replace it.');
    const created = await admin.createPolicy({ name: NAME, version: VERSION, reason: REASON }, audit);
    await admin.updatePolicy(created.id, { name: NAME, config: { ...created.config, marketRangeMinusPercent: 7, marketRangePlusPercent: 7,
      dealerMarginMinPercent: 7, dealerMarginMaxPercent: 12 }, expectedRevision: created.revision, reason: REASON }, audit);
    for (const car of selected) {
      const policy = await repo.policy(created.id);
      await admin.saveReference(null, { policyId: created.id, expectedRevision: policy.revision, variantId: car.version_id,
        modelYear: car.year, marketReference: car.price, basePriceType: 'MARKET_REFERENCE',
        referenceAgeYears: year - car.year, referenceOdometerKm: car.mileage,
        source: `Niêm yết Toàn Trung; ${today}; xe ${car.id}`,
        note: `/san-pham/${car.slug}. Giá chào bán nội bộ, chưa phải giá giao dịch thực tế.`,
        basisNote: 'Neo tuổi/ODO theo niêm yết. Giả định tính toán: ngoại thất nguyên bản, nội thất tốt, không tai nạn/ngập, máy/hộp số bình thường, lịch sử một phần, 2 chủ, sử dụng cá nhân. Không xác nhận tình trạng thực tế của xe niêm yết.',
        active: true, effectiveFrom: effectiveFrom.toISOString(), effectiveTo: effectiveTo.toISOString(), reason: REASON }, audit);
    }
    const policy = await repo.policy(created.id);
    await admin.saveRule(null, { policyId: created.id, expectedRevision: policy.revision, category: 'MARKET', scope: 'GLOBAL',
      adjustmentPercent: 0, manualInspectionRequired: false, active: true,
      label: 'Giữ nguyên neo niêm yết nội bộ', note: 'Chưa có dữ liệu giao dịch để điều chỉnh cung cầu; không thêm hệ số giả định.', reason: REASON }, audit);
    const snapshot = await repo.snapshot(created.id);
    const benchmarks = selected.map(car => {
      const computed = engine.evaluate(benchmarkInput(car), snapshot, at);
      if (computed.status !== 'ESTIMATED' || Math.abs(computed.estimatedMarketValue - car.price) > snapshot.policy.config.roundingVnd)
        throw new Error('Baseline simulation did not reproduce the listing anchor. No activation committed.');
      return { name: car.name, anchor: car.price, midpoint: computed.estimatedMarketValue, marketRange: computed.marketRange, buyingRange: computed.dealerBuyingRange };
    });
    const validation = await admin.validate(created.id, { expectedRevision: snapshot.policy.revision, reason: REASON }, audit);
    if (!validation.report.passed) throw new Error('Master data validation failed. No activation committed.');
    await admin.publish(created.id, { expectedRevision: validation.policy.revision, confirmed: true, reason: REASON }, audit);
    const fresh = await repo.settings();
    await admin.settings({ isEnabled: true, confirmed: true, expectedUpdatedAt: fresh.updatedAt.toISOString(),
      disclaimer: DISCLAIMER, ctaLabel: 'Đăng ký kiểm định xe', reason: REASON }, audit, true);
    return { enabled: true, policyId: created.id, version: VERSION, referenceCount: snapshot.references.length,
      ruleCount: snapshot.rules.length, optionCount: snapshot.options.length, expiresAt: effectiveTo.toISOString(), benchmarks };
  });
  console.log(JSON.stringify(result, null, 2));
}
try { await main(); }
catch (error) {
  // Drizzle errors may include SQL parameters; never dump them or environment values.
  console.error(error?.cause ? 'Database operation failed; transaction rolled back. Inspect server diagnostics without exposing SQL parameters.' : error instanceof Error ? error.message : 'Activation failed.');
  process.exitCode = 1;
} finally { await pool.end(); }
