import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

// One-time content update requested by the website owner. Dry-run by default.
// Remove only these exact default list items, preserving all other HTML.
const removedItems = [
  '<li><b>ODO chuẩn</b>, minh bạch số km đã sử dụng.</li>',
  '<li>Cam kết <b>không đâm đụng</b>, <b>không ngập nước</b>.</li>',
];
const clean = value => removedItems.reduce((html, item) => html.replaceAll(item, ''), value);
const fingerprint = row => {
  const { description, updated_at, ...otherFields } = row;
  return createHash('sha256').update(JSON.stringify(otherFields)).digest('hex');
};
const apply = process.argv.includes('--apply');
const countIndex = process.argv.indexOf('--expected-count');
const expectedCount = countIndex < 0 ? NaN : Number(process.argv[countIndex + 1]);
if (apply && (!Number.isSafeInteger(expectedCount) || expectedCount < 1)) {
  throw new Error('Applying requires --expected-count <positive number> from the dry-run.');
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 6000 });
let connection;
try {
  connection = await pool.connect();
  await connection.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
  await connection.query("SET LOCAL statement_timeout = '15s'");
  const { rows } = await connection.query(`SELECT * FROM cars WHERE deleted_at IS NULL ORDER BY id${apply ? ' FOR UPDATE' : ''}`);
  const changes = rows.filter(row => typeof row.description === 'string' && clean(row.description) !== row.description);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'dry-run', count: changes.length, cars: changes.map(({ id, slug, status }) => ({ id, slug, status })) }, null, 2));
    await connection.query('ROLLBACK');
  } else {
    if (changes.length !== expectedCount) throw new Error(`Expected ${expectedCount} cars, found ${changes.length}. Nothing updated.`);
    const requestId = randomUUID();
    const directory = resolve('.backups/car-descriptions');
    await mkdir(directory, { recursive: true });
    const backupPath = resolve(directory, `remove-default-claims-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await writeFile(backupPath, JSON.stringify({ requestId, createdAt: new Date().toISOString(), removedItems,
      cars: changes.map(({ id, slug, description, updated_at }) => ({ id, slug, description, updated_at, replacement: clean(description) })),
    }, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    for (const row of changes) {
      const description = clean(row.description);
      const updated = await connection.query('UPDATE cars SET description = $1, updated_at = now() WHERE id = $2 AND description = $3 AND deleted_at IS NULL RETURNING id', [description, row.id, row.description]);
      if (updated.rowCount !== 1) throw new Error('A car changed during the update. Rolling back.');
      await connection.query('INSERT INTO audit_logs (action, entity_type, entity_id, old_data, new_data, request_id) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)',
        ['car.description.remove_default_claims', 'car', row.id, JSON.stringify({ description: row.description }), JSON.stringify({ description }), requestId]);
    }
    const { rows: after } = await connection.query('SELECT * FROM cars WHERE deleted_at IS NULL ORDER BY id');
    const beforeById = new Map(rows.map(row => [row.id, row]));
    if (after.length !== rows.length || after.some(row => {
      const before = beforeById.get(row.id);
      return !before || fingerprint(row) !== fingerprint(before) || row.description !== (typeof before.description === 'string' ? clean(before.description) : before.description);
    })) throw new Error('Unexpected content or other car fields changed. Rolling back.');
    const remaining = after.filter(row => typeof row.description === 'string' && clean(row.description) !== row.description).length;
    if (remaining) throw new Error('Default claims still remain. Rolling back.');
    await connection.query('COMMIT');
    console.log(JSON.stringify({ mode: 'applied', updated: changes.length, remaining, otherCarFieldsUnchanged: true, backupPath, requestId }, null, 2));
  }
} catch (error) {
  if (connection) await connection.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : 'Content update failed');
  process.exitCode = 1;
} finally {
  connection?.release();
  await pool.end();
}
