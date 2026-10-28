import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, carMedia } from '../../database/schema/index.js';
import { STORAGE_SERVICE, type StorageService } from './storage.service.js';
import { queueStorageDeletes, type CleanupObject } from './storage-cleanup.js';
import { lockTVMusic } from './tv-music-lock.js';

const referenceTables = ['brands', 'car_models', 'car_versions', 'body_styles', 'branches', 'cars', 'car_media',
  'accessories', 'accessory_brands', 'content_entries', 'site_settings', 'seo_metadata', 'articles', 'driving_experiences',
  'faqs', 'testimonials', 'services', 'recruitments', 'slides', 'pages', 'promotions', 'about_story_assets', 'about_story_pages'];
const referenceColumns = ['image_url', 'image_urls', 'avatar_url', 'og_image_url', 'body', 'content', 'description',
  'answer', 'excerpt', 'structured_data', 'value', 'icon', 'link', 'canonical_url', 'public_url', 'storage_key', 'published_snapshot'];

@Injectable()
export class StorageCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(StorageCleanupService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => { void this.flush(); }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private keyFor(object: CleanupObject): string | undefined {
    if (object.key) return object.key; // Key read from a persisted car_media row, never from a delete request body.
    if (!object.url) return;
    let candidate: URL;
    try { candidate = new URL(object.url); } catch { return; }
    if (candidate.search || candidate.hash || candidate.username || candidate.password) return;
    const base = new URL(this.storage.publicUrl(''));
    if (candidate.origin !== base.origin || !candidate.pathname.startsWith(base.pathname)) return;
    let key: string;
    try { key = candidate.pathname.slice(base.pathname.length).split('/').map(decodeURIComponent).join('/'); } catch { return; }
    if (!key || key.includes('\\') || key.split('/').some(part => !part || part === '.' || part === '..')) return;
    // Exact configured bucket public URL, including any base path. A foreign
    // host or a lookalike URL must never authorize deletion from our bucket.
    return this.storage.publicUrl(key) === candidate.href ? key : undefined;
  }

  async isReferenced(key: string, executor: Pick<DatabaseService['db'], 'execute'> = this.database.db): Promise<boolean> {
    const needles = [...new Set([key, key.split('/').map(encodeURIComponent).join('/')])];
    const columns = await executor.execute(sql`SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN (${sql.join(referenceTables.map(name => sql`${name}`), sql`, `)})`);
    const tables = new Map<string, Set<string>>();
    for (const row of columns.rows) {
      const table = String(row.table_name);
      if (!tables.has(table)) tables.set(table, new Set());
      tables.get(table)!.add(String(row.column_name));
    }
    const probes = [];
    for (const [table, available] of tables) {
      const fields = referenceColumns.filter(name => available.has(name));
      if (!fields.length) continue;
      const live = available.has('deleted_at') ? sql` AND deleted_at IS NULL` : sql``;
      const media = table === 'car_media' ? sql` AND deletion_pending_at IS NULL AND EXISTS
        (SELECT 1 FROM cars c WHERE c.id = car_media.car_id AND c.deleted_at IS NULL)` : sql``;
      probes.push(sql`SELECT 1 FROM ${sql.identifier(table)} WHERE
        (${sql.join(fields.flatMap(name => needles.map(needle => sql`position(${needle} in ${sql.identifier(name)}::text) > 0`)), sql` OR `)})${live}${media}`);
    }
    if (!probes.length) return false;
    const result = await executor.execute(sql`SELECT EXISTS (${sql.join(probes, sql` UNION ALL `)}) AS used`);
    return result.rows[0]?.used === true;
  }

  async flush(requestId?: string): Promise<void> {
    if (this.running) {
      await this.running;
      if (requestId) return this.flush(requestId);
      return;
    }
    this.running = this.drain(requestId).catch(() => {
      // No credentials, full URL, customer data or SDK error payload in logs.
      this.logger.warn('Storage cleanup deferred; pending deletion intents remain durable.');
    });
    try { await this.running; } finally { this.running = undefined; }
  }

  private async drain(requestId?: string) {
    if (!requestId) {
      // Recover older car deletions that failed before this outbox existed.
      await this.database.db.transaction(async tx => {
        const legacy = await tx.execute(sql`SELECT m.* FROM car_media m WHERE m.deletion_pending_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.entity_type = 'storage_object'
            AND a.action = 'storage.delete_pending' AND a.new_data->>'mediaId' = m.id::text) LIMIT 25`);
        await queueStorageDeletes(tx, legacy.rows.map(row => ({ key: row.storage_key as string | undefined,
          url: String(row.public_url), mediaId: String(row.id) })));
      });
    }
    const pending = await this.database.db.execute(sql`SELECT p.entity_id, p.new_data FROM audit_logs p
      WHERE p.entity_type = 'storage_object' AND p.action = 'storage.delete_pending'
      AND (p.new_data->>'notBefore' IS NULL OR (p.new_data->>'notBefore')::timestamptz <= now())
      ${requestId ? sql`AND (p.request_id = ${requestId} OR p.request_id IS NULL)` : sql``}
      AND NOT EXISTS (SELECT 1 FROM audit_logs done WHERE done.entity_type = 'storage_object'
        AND done.entity_id = p.entity_id AND done.action IN ('storage.deleted', 'storage.retained'))
      ORDER BY CASE WHEN p.new_data->>'key' LIKE 'tv/music/%' OR p.new_data->>'url' LIKE '%/tv/music/%' THEN 0 ELSE 1 END,
        p.created_at, p.id LIMIT 25`);
    let failed = 0;
    for (const job of pending.rows) {
      try {
        const object = job.new_data as CleanupObject;
        const key = this.keyFor(object);
        const musicId = key && /^tv\/music\/([0-9a-f-]{36})\.mp3$/.exec(key)?.[1];
        if (musicId) {
          await this.database.db.transaction(async tx => {
            await lockTVMusic(tx);
            const events = await tx.select({ action: auditLogs.action, data: auditLogs.newData }).from(auditLogs)
              .where(and(eq(auditLogs.entityType, 'tv_music_upload'), eq(auditLogs.entityId, musicId)));
            const actions = new Set(events.map(event => event.action));
            const reservation = events.find(event => event.action === 'tv_music.reserved')?.data as { expiresAt?: string } | undefined;
            // Never race an in-flight PUT. The transport aborts it after 10 minutes;
            // a crashed process is recoverable after the 20-minute reservation TTL.
            if (actions.has('tv_music.started') && !actions.has('tv_music.uploaded') && !actions.has('tv_music.failed') &&
              Date.parse(reservation?.expiresAt ?? '') > Date.now()) return;
            const retained = await this.isReferenced(key!, tx);
            if (!retained) await this.storage.delete(key!);
            await tx.insert(auditLogs).values({ action: retained ? 'storage.retained' : 'storage.deleted', entityType: 'storage_object', entityId: String(job.entity_id) });
            if (!retained) await tx.insert(auditLogs).values({ action: 'tv_music.released', entityType: 'tv_music_upload', entityId: musicId });
          });
          continue;
        }
        const retained = !key || await this.isReferenced(key);
        if (key && !retained) await this.storage.delete(key);
        await this.database.db.transaction(async tx => {
          if (object.mediaId) await tx.delete(carMedia).where(and(eq(carMedia.id, object.mediaId), isNotNull(carMedia.deletionPendingAt)));
          await tx.insert(auditLogs).values({ action: retained ? 'storage.retained' : 'storage.deleted',
            entityType: 'storage_object', entityId: String(job.entity_id) });
        });
      } catch { failed++; }
    }
    if (failed) this.logger.warn(`Storage cleanup deferred for ${failed} object(s); automatic retry remains enabled.`);
  }
}
