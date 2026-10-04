import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException } from '@nestjs/common';
import { asc, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { auspiciousChangeLogs, auspiciousReferenceCases, auspiciousRuleContents, auspiciousRules, auspiciousRuleSets, auspiciousRuleSources, auspiciousSettings } from '../../database/schema/index.js';
import { HANDLERS, type Handler, type RuleDefinition } from './domain.js';

export type Db = DatabaseService['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Connection = Db | Tx;
export type Settings = typeof auspiciousSettings.$inferSelect;
export type RuleSet = typeof auspiciousRuleSets.$inferSelect;
export interface Actor { id: string }
@Injectable()
export class AuspiciousRepository {
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  async settings(db: Connection = this.database.db): Promise<Settings> {
    const [row] = await db.select().from(auspiciousSettings).where(eq(auspiciousSettings.id, 1));
    if (!row) throw new NotFoundException('Chưa khởi tạo cấu hình tiện ích. Vui lòng chạy seed sau migration.');
    return row;
  }
  async set(id: string, db: Connection = this.database.db, lock = false) {
    const query = db.select().from(auspiciousRuleSets).where(eq(auspiciousRuleSets.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new NotFoundException('Không tìm thấy phiên bản.');
    return row;
  }
  async snapshot(id: string, db: Connection = this.database.db) {
    const set = await this.set(id, db);
    const rows = await db.select().from(auspiciousRules).where(eq(auspiciousRules.ruleSetId, id)).orderBy(asc(auspiciousRules.sortOrder), asc(auspiciousRules.code));
    const ids = rows.map(rule => rule.id);
    const readContents = () => ids.length ? db.select().from(auspiciousRuleContents).where(inArray(auspiciousRuleContents.ruleId, ids)) : [];
    const readSources = () => ids.length ? db.select().from(auspiciousRuleSources).where(inArray(auspiciousRuleSources.ruleId, ids)) : [];
    const readCases = () => db.select().from(auspiciousReferenceCases).where(eq(auspiciousReferenceCases.ruleSetId, id)).orderBy(asc(auspiciousReferenceCases.name));
    // A transaction owns one PostgreSQL client. Parallel queries on that client
    // are deprecated by pg; pool reads outside transactions can run in parallel.
    const [contents, sources, cases] = db === this.database.db
      ? await Promise.all([readContents(), readSources(), readCases()])
      : [await readContents(), await readSources(), await readCases()];
    const rules: RuleDefinition[] = rows.map(rule => ({ ...rule, engineHandler: rule.engineHandler as Handler }));
    return { set, rules, contents, sources, cases };
  }
  async editable(id: string, tx: Tx) {
    const set = await this.set(id, tx, true);
    if (['PUBLISHED', 'ARCHIVED'].includes(set.status)) throw new ConflictException('Phiên bản đã xuất bản/lưu trữ không được sửa. Hãy nhân bản thành phiên bản mới.');
    return set;
  }
  async invalidate(set: RuleSet, tx: Tx) {
    await tx.update(auspiciousRuleSets).set({ revision: set.revision + 1, status: 'DRAFT', validatedRevision: null, validationReport: null, updatedAt: new Date() }).where(eq(auspiciousRuleSets.id, set.id));
  }
  async log(tx: Tx, actor: Actor, action: string, entityType: string, entityId: string, before: unknown, after: unknown, reason: string, ruleSetId?: string) {
    await tx.insert(auspiciousChangeLogs).values({ adminUserId: actor.id, action, entityType, entityId, beforeData: before ?? null, afterData: after ?? null, reason, ruleSetId });
  }
  assertRule(rule: RuleDefinition) {
    if (!HANDLERS.includes(rule.engineHandler)) throw new BadRequestException('Handler không được engine hỗ trợ.');
    if (rule.hardExclusion && (rule.priority !== 'CRITICAL' || rule.effect !== 'NEGATIVE')) throw new BadRequestException('Loại trừ chỉ dành cho quy tắc CRITICAL có hiệu ứng NEGATIVE.');
    if (rule.effect === 'NEUTRAL' && rule.weight !== 0) throw new BadRequestException('Quy tắc trung tính phải có trọng số bằng 0.');
    if (rule.engineHandler === 'GOOD_HOURS' && (rule.effect !== 'NEUTRAL' || rule.hardExclusion)) throw new BadRequestException('GOOD_HOURS là dữ liệu hiển thị trung tính, không dùng để đánh giá ngày.');
    if (rule.engineHandler !== 'PURPOSE_OFFICER' && Object.keys(rule.parameters).length) throw new BadRequestException('Handler này không có tham số tùy chỉnh.');
    if (rule.isEnabled && rule.engineHandler === 'PURPOSE_OFFICER' && !rule.parameters.officers?.length) throw new BadRequestException('Nhập các Trực đã được nguồn xác minh cho phép.');
  }
}
export type Snapshot = Awaited<ReturnType<AuspiciousRepository['snapshot']>>;
