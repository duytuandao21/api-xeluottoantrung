import { randomUUID } from 'node:crypto';
import { auditLogs } from '../../database/schema/index.js';
import type { AuditContext } from '../../common/audit.js';
import type { DatabaseService } from '../../database/database.service.js';

export type CleanupTransaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export type CleanupObject = { url?: string; key?: string; mediaId?: string; notBefore?: string };

// Only persisted old values are candidates. Uploading, cancelling a form or changing
// an unrelated field never authorizes deletion. Static/external URLs are not owned assets.
export function imageUrls(value: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string') {
      for (const match of item.matchAll(/https:\/\/[^\s"'<>\\]+/g)) {
        const url = match[0].replace(/&amp;/g, '&');
        if (/\.(?:jpg|jpeg|png|webp|avif|ico|gif|svg|mp4|webm)(?:[?#]|$)/i.test(url) ||
          /\/tv\/music\/[0-9a-f-]{36}\.mp3$/.test(url)) found.add(url);
      }
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === 'object' && !(item instanceof Date)) Object.values(item).forEach(visit);
  };
  visit(value);
  return found;
}

export async function queueStorageDeletes(tx: CleanupTransaction, objects: CleanupObject[], audit?: AuditContext) {
  if (!objects.length) return;
  // The existing append-only audit journal is a durable deletion outbox: pending
  // and completion events share an entity ID. Both data mutation and intent commit together.
  await tx.insert(auditLogs).values(objects.map(object => ({ ...audit, action: 'storage.delete_pending',
    entityType: 'storage_object', entityId: randomUUID(), newData: object })));
}

export async function queueRemovedImages(tx: CleanupTransaction, old: unknown, updated: unknown, audit?: AuditContext) {
  const remaining = imageUrls(updated);
  await queueStorageDeletes(tx, [...imageUrls(old)].filter(url => !remaining.has(url)).map(url => ({ url })), audit);
}
