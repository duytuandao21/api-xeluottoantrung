import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, valuationOptions, valuationPolicies, valuationReferencePrices, valuationRules, valuationSettings } from '../../database/schema/index.js';
import type { AuditContext } from '../../common/audit.js';
import type { Snapshot } from './estimate.types.js';
export type Db = DatabaseService['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Connection = Db | Tx;
@Injectable()
export class ValuationRepository {
  private readonly publishedCache = new Map<string, { until: number; snapshot: Snapshot }>();
  // Set only on a transaction-local repository by the current configuration editor.
  mutablePolicyId: string | null = null;
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  async settings(db: Connection = this.database.db, lock = false) {
    const query = db.select().from(valuationSettings).where(eq(valuationSettings.id, 1));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Chưa khởi tạo định giá. Chạy migration và seed valuation trước.');
    return row;
  }
  async policy(id: string, db: Connection = this.database.db, lock = false) {
    const query = db.select().from(valuationPolicies).where(eq(valuationPolicies.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Không tìm thấy phiên bản định giá.');
    return row;
  }
  async editable(id: string, revision: number, tx: Tx) {
    const policy = await this.policy(id, tx, true);
    if (!['DRAFT', 'VALIDATED'].includes(policy.status) && id !== this.mutablePolicyId) throw new ConflictException('Cấu hình lưu trữ chỉ đọc.');
    if (policy.revision !== revision) throw new ConflictException('Cấu hình đã thay đổi. Tải lại trước khi lưu.');
    return policy;
  }
  async current(db: Connection = this.database.db, lock = false) {
    const settings = await this.settings(db);
    if (settings.activePolicyId) return this.policy(settings.activePolicyId, db, lock);
    const query = db.select().from(valuationPolicies).orderBy(desc(valuationPolicies.createdAt), asc(valuationPolicies.id)).limit(1);
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Chưa khởi tạo cấu hình định giá. Chạy seed valuation trước.');
    return row;
  }
  async invalidate(id: string, actor: AuditContext, tx: Tx) {
    const old = await this.policy(id, tx);
    await tx.update(valuationPolicies).set({ revision: old.revision + 1, status: 'DRAFT', validatedRevision: null, validationReport: null, updatedBy: actor.actorProfileId, updatedAt: new Date() }).where(eq(valuationPolicies.id, id));
  }
  async snapshot(id: string, db: Connection = this.database.db) {
    const policy = await this.policy(id, db);
    // Sequential queries also work on a single pg transaction client.
    const options = await db.select().from(valuationOptions).where(eq(valuationOptions.policyId, id)).orderBy(asc(valuationOptions.category), asc(valuationOptions.sortOrder));
    const rules = await db.select().from(valuationRules).where(eq(valuationRules.policyId, id));
    const references = await db.select().from(valuationReferencePrices).where(eq(valuationReferencePrices.policyId, id));
    return { policy, options, rules, references };
  }
  /** Settings/catalog stay fresh. All reads in one request observe the same committed DB snapshot. */
  async runtime<T>(work: (settings: typeof valuationSettings.$inferSelect, snapshot: Snapshot, tx: Tx) => Promise<T>, policyId?: string, write = false) {
    return this.database.db.transaction(async tx => {
      const settings = await this.settings(tx);
      if (!policyId && (!settings.isEnabled || !settings.activePolicyId)) throw new ServiceUnavailableException('Tiện ích định giá chưa được bật. Vui lòng liên hệ Toàn Trung để được tư vấn.');
      const policy = await this.policy(policyId ?? settings.activePolicyId!, tx);
      if (!policyId && (policy.status !== 'PUBLISHED' || policy.validatedRevision !== policy.revision)) throw new ServiceUnavailableException('Chưa có cấu hình định giá đã xuất bản hợp lệ.');
      const key = `${policy.id}:${policy.revision}:${policy.updatedAt.toISOString()}`;
      const cached = policy.status === 'PUBLISHED' ? this.publishedCache.get(key) : undefined;
      const snapshot = cached && cached.until > Date.now() ? cached.snapshot : await this.snapshot(policy.id, tx);
      if (policy.status === 'PUBLISHED' && snapshot !== cached?.snapshot) {
        if (this.publishedCache.size >= 8) this.publishedCache.delete(this.publishedCache.keys().next().value!);
        this.publishedCache.set(key, { until: Date.now() + 30000, snapshot });
      }
      return work(settings, snapshot, tx);
    }, { isolationLevel: 'repeatable read', accessMode: write ? 'read write' : 'read only' });
  }
  async log(tx: Tx, actor: AuditContext, action: string, entityType: string, entityId: string, oldData: unknown, newData: unknown, reason: string) {
    await tx.insert(auditLogs).values({ ...actor, action: `valuation.${action}`, entityType: `valuation_${entityType}`, entityId, oldData: { reason, data: oldData ?? null }, newData: { reason, data: newData ?? null } });
  }
}
