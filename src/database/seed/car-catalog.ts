import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { toSlug } from '../../common/slug.js';

type SourceBrand = { name: string; models: { name: string; versions: string[] }[] };
type Row = { id: string; name: string; slug: string; status: string; sort_order: number; [key: string]: unknown };
type ModelRow = Row & { brand_id: string };
type VersionRow = Row & { model_id: string };
type Snapshot = { brands: Row[]; models: ModelRow[]; versions: VersionRow[] };
type NewModel = { id: string; brand_id: string; name: string; slug: string; sort_order: number; status: string };
type NewVersion = { id: string; model_id: string; name: string; slug: string; sort_order: number; status: string };

const compact = (name: string) => toSlug(name).replaceAll('-', '');
const brandKey = (name: string) => ({ hyundai: 'huynhdai', mercedesbenz: 'mercedes' }[compact(name)] || compact(name));
const modelKey = (name: string, brand: Row) => {
  const key = compact(name);
  return brandKey(brand.name) === 'huynhdai' && key === 'grandi10' ? 'i10' : key;
};
// Ignore accents/case/spacing for duplicate checks; preserve decimal points and other technical notation.
const versionKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/[\s-]+/g, '');

function sourceName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200 || /[\u0000-\u001f]/.test(value)) {
    throw new Error('INVALID_CATALOG_NAME');
  }
  const name = value.trim();
  toSlug(name);
  return name;
}

function readSource(raw: string): SourceBrand[] {
  const data = JSON.parse(raw.replace(/^\uFEFF/, '')) as { brands?: unknown };
  if (!Array.isArray(data.brands) || !data.brands.length) throw new Error('INVALID_BRANDS');
  return data.brands.map((brand: { name?: unknown; models?: unknown }) => {
    if (!brand || !Array.isArray(brand.models)) throw new Error('INVALID_MODELS');
    return { name: sourceName(brand.name), models: brand.models.map((model: { name?: unknown; versions?: unknown }) => {
      if (!model || !Array.isArray(model.versions)) throw new Error('INVALID_VERSIONS');
      return { name: sourceName(model.name), versions: model.versions.map(sourceName) };
    }) };
  });
}

async function snapshot(client: PoolClient): Promise<Snapshot> {
  return {
    brands: (await client.query<Row>('SELECT * FROM brands ORDER BY id')).rows,
    models: (await client.query<ModelRow>('SELECT * FROM car_models ORDER BY id')).rows,
    versions: (await client.query<VersionRow>('SELECT * FROM car_versions ORDER BY id')).rows,
  };
}

function planImport(source: SourceBrand[], before: Snapshot) {
  const newModels: NewModel[] = [], newVersions: NewVersion[] = [];
  const skippedBrands: string[] = [], skippedInactive: string[] = [];
  const matchedBrands: { source: string; target: string; id: string; addedModels: number; addedVersions: number }[] = [];
  const reusedModels: { brand: string; source: string; target: string; id: string }[] = [];
  let existingVersions = 0;
  const models = [...before.models], versions = [...before.versions];
  for (const sourceBrand of source) {
    const matches = before.brands.filter(brand => brand.status === 'active' &&
      (brandKey(brand.name) === brandKey(sourceBrand.name) || brandKey(brand.slug) === brandKey(sourceBrand.name)));
    if (matches.length > 1) throw new Error(`AMBIGUOUS_BRAND: ${sourceBrand.name}`);
    const brand = matches[0];
    if (!brand) { skippedBrands.push(sourceBrand.name); continue; }
    const summary = { source: sourceBrand.name, target: brand.name, id: brand.id, addedModels: 0, addedVersions: 0 };
    matchedBrands.push(summary);
    for (const sourceModel of sourceBrand.models) {
      const modelSlug = toSlug(sourceModel.name);
      const matches = models.filter(model => model.brand_id === brand.id &&
        (modelKey(model.name, brand) === modelKey(sourceModel.name, brand) || model.slug === modelSlug));
      if (matches.length > 1) throw new Error(`AMBIGUOUS_MODEL: ${sourceBrand.name}/${sourceModel.name}`);
      let model = matches[0];
      if (model && model.status !== 'active') { skippedInactive.push(`${brand.name}/${model.name}`); continue; }
      if (model) reusedModels.push({ brand: brand.name, source: sourceModel.name, target: model.name, id: model.id });
      else {
        const sortOrder = Math.max(0, ...models.filter(row => row.brand_id === brand.id).map(row => row.sort_order)) + 1;
        model = { id: randomUUID(), brand_id: brand.id, name: sourceModel.name, slug: modelSlug, status: 'active', sort_order: sortOrder };
        models.push(model); newModels.push(model); summary.addedModels++;
      }
      for (const versionName of sourceModel.versions) {
        const versionSlug = toSlug(versionName);
        const sameName = versions.filter(version => version.model_id === model.id && versionKey(version.name) === versionKey(versionName));
        if (sameName.length > 1) throw new Error(`AMBIGUOUS_VERSION: ${brand.name}/${model.name}/${versionName}`);
        if (sameName[0]) {
          existingVersions++;
          if (sameName[0].status !== 'active') skippedInactive.push(`${brand.name}/${model.name}/${versionName}`);
          continue;
        }
        if (versions.some(version => version.model_id === model.id && version.slug === versionSlug)) {
          throw new Error(`VERSION_SLUG_CONFLICT: ${brand.name}/${model.name}/${versionName}`);
        }
        const sortOrder = Math.max(0, ...versions.filter(row => row.model_id === model.id).map(row => row.sort_order)) + 1;
        const version: NewVersion = { id: randomUUID(), model_id: model.id, name: versionName, slug: versionSlug, status: 'active', sort_order: sortOrder };
        versions.push(version); newVersions.push(version); summary.addedVersions++;
      }
    }
  }
  return { newModels, newVersions, skippedBrands, skippedInactive, matchedBrands, reusedModels, existingVersions };
}

async function insertRows(client: PoolClient, table: 'car_models' | 'car_versions', rows: (NewModel | NewVersion)[]) {
  if (!rows.length) return;
  const parent = table === 'car_models' ? 'brand_id' : 'model_id';
  const values: unknown[] = [];
  const placeholders = rows.map(row => {
    const entries = [row.id, parent === 'brand_id' ? (row as NewModel).brand_id : (row as NewVersion).model_id,
      row.name, row.slug, row.sort_order, row.status];
    return `(${entries.map(value => { values.push(value); return `$${values.length}`; }).join(',')})`;
  });
  await client.query(`INSERT INTO ${table} (id,${parent},name,slug,sort_order,status) VALUES ${placeholders.join(',')}`, values);
}

function assertPreserved(old: Row[], current: Row[], label: string) {
  const currentById = new Map(current.map(row => [row.id, JSON.stringify(row)]));
  if (old.some(row => currentById.get(row.id) !== JSON.stringify(row))) throw new Error(`EXISTING_RECORD_CHANGED: ${label}`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileAt = args.indexOf('--file');
  const inputPath = fileAt >= 0 ? resolve(args[fileAt + 1] || '') : fileURLToPath(new URL('../../../../cars.json', import.meta.url));
  const raw = readFileSync(inputPath, 'utf8'), source = readSource(raw);
  const sourceSha256 = createHash('sha256').update(raw).digest('hex');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL_REQUIRED');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
  const reportDirAt = args.indexOf('--report-dir');
  if (reportDirAt >= 0 && !args[reportDirAt + 1]?.trim()) throw new Error('INVALID_REPORT_DIRECTORY');
  const reportDir = reportDirAt >= 0
    ? resolve(args[reportDirAt + 1])
    : fileURLToPath(new URL('../../../docs/catalog-import/', import.meta.url));
  mkdirSync(reportDir, { recursive: true });
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '60s'");
    if (apply) {
      await client.query('LOCK TABLE brands IN SHARE MODE');
      await client.query('LOCK TABLE car_models, car_versions IN SHARE ROW EXCLUSIVE MODE');
    }
    const before = await snapshot(client), plan = planImport(source, before);
    const report = {
      createdAt: new Date().toISOString(), applied: apply, inputPath, sourceSha256,
      sourceBrands: source.length, matchedBrands: plan.matchedBrands, skippedBrands: plan.skippedBrands,
      existingBrandsWithoutSource: before.brands.filter(b => !plan.matchedBrands.some(m => m.id === b.id)).map(b => b.name),
      countsBefore: { brands: before.brands.length, models: before.models.length, versions: before.versions.length },
      added: { brands: 0, models: plan.newModels.length, versions: plan.newVersions.length },
      reusedModels: plan.reusedModels, existingVersions: plan.existingVersions, skippedInactive: plan.skippedInactive,
      newModels: plan.newModels, newVersions: plan.newVersions,
      policy: 'Only active existing brands; insert missing models/versions; preserve all existing rows; no model-year, price or vehicle inventory changes.',
    };
    if (apply) {
      // Save only catalog data (no credentials or customer records) before the transaction writes.
      writeFileSync(resolve(reportDir, `cars-import-backup-${Date.now()}.json`), JSON.stringify(before, null, 2) + '\n');
      await insertRows(client, 'car_models', plan.newModels);
      await insertRows(client, 'car_versions', plan.newVersions);
      const after = await snapshot(client);
      assertPreserved(before.brands, after.brands, 'brands');
      assertPreserved(before.models, after.models, 'models');
      assertPreserved(before.versions, after.versions, 'versions');
      if (after.brands.length !== before.brands.length || after.models.length !== before.models.length + plan.newModels.length ||
          after.versions.length !== before.versions.length + plan.newVersions.length) throw new Error('COUNT_VERIFICATION_FAILED');
      const remaining = planImport(source, after);
      if (remaining.newModels.length || remaining.newVersions.length) throw new Error('INCOMPLETE_IMPORT');
      // Keep a durable manifest before commit; applied=true is published only after commit succeeds.
      const pendingPath = resolve(reportDir, 'cars-import-pending.json');
      writeFileSync(pendingPath, JSON.stringify({ ...report, applied: false, status: 'pending-commit' }, null, 2) + '\n');
      await client.query('COMMIT'); committed = true;
      writeFileSync(resolve(reportDir, 'cars-import-result.json'), JSON.stringify({ ...report, status: 'committed', countsAfter: {
        brands: after.brands.length, models: after.models.length, versions: after.versions.length,
      }, verified: { existingRowsPreserved: true, noNewBrands: true, remainingModels: 0, remainingVersions: 0 } }, null, 2) + '\n');
      unlinkSync(pendingPath);
    } else {
      await client.query('ROLLBACK');
      writeFileSync(resolve(reportDir, 'cars-import-plan.json'), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify({ applied: apply, matchedBrands: plan.matchedBrands, skippedBrands: plan.skippedBrands,
      added: report.added, reusedModels: plan.reusedModels, existingVersions: plan.existingVersions, skippedInactive: plan.skippedInactive }, null, 2));
  } catch (error) {
    if (!committed) await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch((error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  const message = error instanceof Error && /^(INVALID_|AMBIGUOUS_|VERSION_SLUG_CONFLICT|EXISTING_RECORD_CHANGED|COUNT_VERIFICATION_FAILED|INCOMPLETE_IMPORT|DATABASE_URL_REQUIRED)/.test(error.message)
    ? error.message : `CATALOG_IMPORT_FAILED (${code || 'UNKNOWN'})`;
  console.error(message); process.exitCode = 1;
});
