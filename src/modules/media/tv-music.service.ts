import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, siteSettings } from '../../database/schema/index.js';
import { parseTVMusic, TV_MUSIC_MAX_BYTES, TV_MUSIC_MAX_TRACKS, type TVMusicSettings, type TVMusicTrack } from '../content/tv-music.settings.js';
import { STORAGE_SERVICE, type StorageService } from './storage.service.js';
import { boundedTVAudio } from './tv-audio-stream.js';
import { lockTVMusic } from './tv-music-lock.js';
import { queueRemovedImages, queueStorageDeletes, type CleanupTransaction } from './storage-cleanup.js';

type Reservation = { key: string; sizeBytes: number; name: string; expiresAt: string };
const uploadTTL = 20 * 60_000;
const musicKey = (id: string) => `tv/music/${id}.mp3`;

@Injectable()
export class TVMusicService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}

  private async usageIn(tx: CleanupTransaction) {
    const rows = await tx.execute(sql`SELECT count(*)::int AS count, coalesce(sum((r.new_data->>'sizeBytes')::bigint), 0)::text AS bytes
      FROM audit_logs r WHERE r.entity_type = 'tv_music_upload' AND r.action = 'tv_music.reserved'
      AND NOT EXISTS (SELECT 1 FROM audit_logs d WHERE d.entity_type = 'tv_music_upload'
        AND d.entity_id = r.entity_id AND d.action = 'tv_music.released')`);
    return { count: Number(rows.rows[0]?.count ?? 0), bytes: Number(rows.rows[0]?.bytes ?? 0), maxCount: TV_MUSIC_MAX_TRACKS, maxBytes: TV_MUSIC_MAX_BYTES };
  }

  usage() { return this.database.db.transaction(tx => this.usageIn(tx)); }

  async reserve(name: string, sizeBytes: number, audit: AuditContext) {
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 3 || sizeBytes > TV_MUSIC_MAX_BYTES ||
      !name.trim() || name.trim().length > 120 || /[\u0000-\u001f]/.test(name)) throw new BadRequestException('Tên hoặc dung lượng MP3 không hợp lệ.');
    // Fail before reserving quota if storage is unavailable.
    if (!this.storage.putAudio) throw new ServiceUnavailableException('Upload nhạc chưa sẵn sàng.');
    const id = randomUUID();
    const key = musicKey(id);
    this.storage.publicUrl(key);
    return this.database.db.transaction(async tx => {
      await lockTVMusic(tx);
      const used = await this.usageIn(tx);
      if (used.count >= TV_MUSIC_MAX_TRACKS || used.bytes + sizeBytes > TV_MUSIC_MAX_BYTES)
        throw new BadRequestException('Kho nhạc tối đa 10 bài và 1 GB, gồm file chờ lưu/xóa. Hãy xóa bài cũ và chờ dọn xong trước khi tải bài mới.');
      const data: Reservation = { key, name: name.trim(), sizeBytes, expiresAt: new Date(Date.now() + uploadTTL).toISOString() };
      await tx.insert(auditLogs).values({ ...audit, action: 'tv_music.reserved', entityType: 'tv_music_upload', entityId: id, newData: data });
      // Durable orphan cleanup: survives tab close, failed saves and process restart.
      await queueStorageDeletes(tx, [{ key, notBefore: data.expiresAt }], audit);
      return { id, expiresAt: data.expiresAt };
    });
  }

  private async reservation(tx: CleanupTransaction, id: string, actor?: string) {
    const [row] = await tx.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'tv_music_upload'),
      eq(auditLogs.entityId, id), eq(auditLogs.action, 'tv_music.reserved')));
    if (!row) throw new NotFoundException('Không tìm thấy lượt upload nhạc.');
    if (actor && row.actorProfileId !== actor) throw new ForbiddenException('Lượt upload thuộc tài khoản khác.');
    const events = await tx.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entityType, 'tv_music_upload'), eq(auditLogs.entityId, id)));
    return { data: row.newData as Reservation, events: new Set(events.map(event => event.action)) };
  }

  async upload(id: string, source: Readable, declaredLength: number, audit: AuditContext, signal: AbortSignal): Promise<TVMusicTrack> {
    const ticket = await this.database.db.transaction(async tx => {
      await lockTVMusic(tx);
      const ticket = await this.reservation(tx, id, audit.actorProfileId);
      if (Date.parse(ticket.data.expiresAt) <= Date.now() || ticket.events.has('tv_music.started') || ticket.events.has('tv_music.released') || ticket.events.has('tv_music.cancelled'))
        throw new ConflictException('Lượt upload đã dùng, hết hạn hoặc đã hủy. Vui lòng chọn lại file.');
      if (Number.isFinite(declaredLength) && declaredLength !== ticket.data.sizeBytes) throw new BadRequestException('Dung lượng gửi lên không khớp lượt upload.');
      await tx.insert(auditLogs).values({ ...audit, action: 'tv_music.started', entityType: 'tv_music_upload', entityId: id });
      return ticket.data;
    });
    const bounded = boundedTVAudio(source, ticket.sizeBytes);
    const abort = () => bounded.destroy(new Error('Upload nhạc đã bị hủy.'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (signal.aborted) abort();
      await this.storage.putAudio!(ticket.key, bounded, ticket.sizeBytes, signal);
      const object = await this.storage.head(ticket.key);
      if (!object || object.mimeType !== 'audio/mpeg' || object.sizeBytes !== ticket.sizeBytes) throw new Error('File nhạc chưa được xác minh.');
      await this.database.db.insert(auditLogs).values({ ...audit, action: 'tv_music.uploaded', entityType: 'tv_music_upload', entityId: id });
      return { id, name: ticket.name, url: this.storage.publicUrl(ticket.key), sizeBytes: object.sizeBytes };
    } catch {
      await this.database.db.transaction(async tx => {
        await tx.insert(auditLogs).values({ ...audit, action: 'tv_music.failed', entityType: 'tv_music_upload', entityId: id });
        await queueStorageDeletes(tx, [{ key: ticket.key }], audit);
      });
      throw new BadRequestException('Upload MP3 thất bại hoặc sai dung lượng/định dạng. File lỗi được đưa vào hàng đợi dọn dẹp.');
    } finally { signal.removeEventListener('abort', abort); bounded.destroy(); }
  }

  async cancel(id: string, audit: AuditContext) {
    await this.database.db.transaction(async tx => {
      await lockTVMusic(tx);
      const ticket = await this.reservation(tx, id, audit.actorProfileId);
      if (ticket.events.has('tv_music.released') || ticket.events.has('tv_music.cancelled')) return;
      const [setting] = await tx.select().from(siteSettings).where(and(eq(siteSettings.group, 'tv-display'), eq(siteSettings.key, 'config')));
      if (setting?.value && parseTVMusic(JSON.parse(setting.value).music).tracks.some(track => track.id === id))
        throw new ConflictException('Bài đã lưu; hãy dùng chức năng xóa bài khỏi playlist.');
      await tx.insert(auditLogs).values({ ...audit, action: 'tv_music.cancelled', entityType: 'tv_music_upload', entityId: id });
      await queueStorageDeletes(tx, [{ key: ticket.data.key }], audit);
    });
  }

  async remove(id: string, revision: number, audit: AuditContext) {
    return this.database.db.transaction(async tx => {
      await lockTVMusic(tx);
      const [setting] = await tx.select().from(siteSettings).where(and(eq(siteSettings.group, 'tv-display'), eq(siteSettings.key, 'config'))).for('update');
      if (!setting?.value) throw new NotFoundException('Chưa có playlist TV.');
      const config = JSON.parse(setting.value) as Record<string, unknown>;
      const old = parseTVMusic(config.music);
      if (old.revision !== revision) throw new ConflictException('Playlist đã đổi ở nơi khác. Hãy tải lại trước khi xóa.');
      if (!old.tracks.some(track => track.id === id)) throw new NotFoundException('Bài nhạc không còn trong playlist.');
      const music = { ...old, revision: old.revision + 1, tracks: old.tracks.filter(track => track.id !== id) };
      const [updated] = await tx.update(siteSettings).set({ value: JSON.stringify({ ...config, music }), updatedAt: new Date(), updatedBy: audit.actorProfileId })
        .where(eq(siteSettings.id, setting.id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'setting.upsert', entityType: 'site_settings', entityId: setting.id, oldData: setting, newData: updated });
      await queueRemovedImages(tx, setting, updated, audit);
      return music;
    });
  }

  /** Caller holds lockTVMusic in the same transaction as publishing site_settings. */
  async prepareSave(tx: CleanupTransaction, incoming: TVMusicSettings, old: TVMusicSettings) {
    if (incoming.revision !== old.revision) throw new ConflictException('Nhạc TV đã được chỉnh ở nơi khác. Hãy tải lại cấu hình trước khi lưu.');
    const changed = JSON.stringify({ ...incoming, revision: 0 }) !== JSON.stringify({ ...old, revision: 0 });
    for (const track of incoming.tracks) {
      if (this.storage.publicUrl(musicKey(track.id)) !== track.url) throw new BadRequestException('Chỉ nhận nhạc TV đã upload vào R2 của hệ thống.');
      const ticket = await this.reservation(tx, track.id);
      if (!ticket.events.has('tv_music.uploaded') || ticket.events.has('tv_music.released') || ticket.events.has('tv_music.cancelled'))
        throw new BadRequestException('File nhạc chưa hoàn tất hoặc đã bị hủy/xóa.');
      if (track.sizeBytes !== ticket.data.sizeBytes) throw new BadRequestException('Dung lượng bài nhạc không khớp file đã upload.');
      // HEAD only on admin writes, never on TV snapshot/read/playback.
      if (changed) {
        const object = await this.storage.head(ticket.data.key);
        if (!object || object.mimeType !== 'audio/mpeg' || object.sizeBytes !== track.sizeBytes) throw new BadRequestException('File nhạc không tồn tại hoặc sai dung lượng.');
      }
    }
    return { ...incoming, revision: old.revision + (changed ? 1 : 0) };
  }
}
