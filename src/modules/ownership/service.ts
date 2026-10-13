import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../../database/database.service.js';
import { throwOnConstraint } from '../../common/database-errors.js';
import { bodyStyles, brands, carMedia, carModels, cars, carVersions, ownershipProfiles, ownershipSettings, ownershipSurveys } from '../../database/schema/index.js';
import { calculateOwnership, normalizeFuel, resolvePolicy } from './calculator.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { numberIn, validateAnswers, validatePolicy, validateSettings } from './validation.js';
import type { CalculateDto, ProfileDto, ProfileQuery, SettingsDto, SurveyQuery, TargetQuery } from './dto.js';
import type { Profile, Vehicle } from './domain.js';
type Db = DatabaseService['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v !== null && typeof v === 'object' ? `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => `${JSON.stringify(k)}:${canonical(value)}`).join(',')}}` : JSON.stringify(v);
/** Bounded process cache; mutations detach pending reads before new requests use them. */
export class OwnershipCache {
  private entries = new Map<string, { expires: number; promise: Promise<unknown> }>();
  clear() { this.entries.clear(); }
  async get<T>(key: string, read: () => Promise<T>): Promise<T> {
    const old = this.entries.get(key); if (old && old.expires > Date.now()) return old.promise as Promise<T>;
    if (this.entries.size >= 1000) this.entries.delete(this.entries.keys().next().value!);
    const entry = { expires: Date.now() + 60000, promise: Promise.resolve().then(read) }; this.entries.set(key, entry);
    try { return await entry.promise; } catch (error) { if (this.entries.get(key) === entry) this.entries.delete(key); throw error; }
  }
}
@Injectable()
export class OwnershipService {
  readonly cache = new OwnershipCache();
  constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  private invalid<T>(action: () => T): T { try { return action(); } catch (e) { throw new BadRequestException(e instanceof Error ? e.message : 'Dữ liệu không hợp lệ.'); } }
  async settings() {
    return this.cache.get('settings', async () => { const [row] = await this.database.db.select().from(ownershipSettings).where(eq(ownershipSettings.id, 1)); if (!row) throw new ServiceUnavailableException('Bộ dự toán chưa được cấu hình.'); validateSettings(row.config); return row; });
  }
  async vehicle(id: string, db: Db | Tx = this.database.db): Promise<Vehicle> {
    const [row] = await db.select({ id: cars.id, name: cars.name, slug: cars.slug, price: cars.price, year: cars.year, mileage: cars.mileage, fuel: cars.fuel,
      modelId: cars.modelId, versionId: cars.versionId, bodyStyleId: cars.bodyStyleId, brand: brands.name, model: carModels.name, cover: carMedia.publicUrl,
    }).from(cars).innerJoin(brands, eq(brands.id, cars.brandId)).innerJoin(carModels, and(eq(carModels.id, cars.modelId), eq(carModels.brandId, cars.brandId)))
      .leftJoin(carMedia, and(eq(carMedia.carId, cars.id), eq(carMedia.isCover, true), eq(carMedia.type, 'image'), isNull(carMedia.deletionPendingAt)))
      .where(and(eq(cars.id, id), isNull(cars.deletedAt), isNotNull(cars.publishedAt), inArray(cars.status, ['active', 'deposit', 'sold']), eq(brands.status, 'active'), eq(carModels.status, 'active')));
    if (!row) throw new NotFoundException('Xe chưa công khai hoặc không còn tồn tại.'); return row;
  }
  async resolved(car: Vehicle, settings: Awaited<ReturnType<OwnershipService['settings']>>) {
    const fuel = normalizeFuel(car.fuel) || settings.config.defaultFuel;
    const refs = [['car', car.id], ['version', car.versionId], ['model', car.modelId], ['body', car.bodyStyleId], ['fuel', fuel]].filter(([, target]) => !!target);
    const key = refs.map(([scope, target]) => `${scope}:${target}`).join('|');
    const profiles = await this.cache.get(key, () => this.database.db.select().from(ownershipProfiles).where(or(...refs.map(([scope, target]) => and(eq(ownershipProfiles.scope, scope!), eq(ownershipProfiles.target, target!))))));
    return this.invalid(() => resolvePolicy(car, settings.config, profiles as Profile[]));
  }
  async config(id: string) {
    const car = await this.vehicle(id), settings = await this.settings();
    if (!settings.enabled) return { enabled: false };
    if (!numberIn(car.price, 1, 100000000000, true) || !numberIn(car.year, 1886, new Date().getUTCFullYear() + 1, true)) throw new BadRequestException('Giá hoặc năm sản xuất của xe chưa đủ điều kiện để dự toán. Vui lòng liên hệ Toàn Trung để cập nhật.');
    const resolved = await this.resolved(car, settings), c = settings.config;
    return { enabled: true, vehicle: car, fuel: resolved.fuel, odo: resolved.odo, consumption: resolved.policy.consumption[resolved.fuel], chargingLoss: resolved.policy.chargingLoss,
      assumptions: resolved.assumptions, profileName: resolved.profile?.name || 'Định mức mặc định (ước tính)', updatedAt: settings.updatedAt.toISOString(),
      defaults: { ...c.defaults, energyPrice: c.energyPrices[resolved.fuel] }, loanDefaults: c.loanDefaults, options: { parking: c.parkingOptions, wash: c.washOptions, toll: c.tollOptions, years: c.yearOptions, regions: c.regions, transactions: c.transactions } };
  }
  async submit(id: string, dto: CalculateDto) {
    const settings = await this.settings(); if (!settings.enabled) throw new ServiceUnavailableException('Bộ dự toán đang tạm ngừng.');
    this.invalid(() => validateAnswers(dto.answers, settings.config));
    return this.database.db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${dto.interactionId}, 845172))`);
      const [old] = await tx.select().from(ownershipSurveys).where(eq(ownershipSurveys.interactionId, dto.interactionId)).for('update');
      if (old && (old.vehicleId !== id || old.expiresAt.getTime() <= Date.now() || !timingSafeEqual(Buffer.from(old.capabilityHash, 'hex'), Buffer.from(digest(dto.capability), 'hex')))) throw new NotFoundException('Lượt tính không hợp lệ hoặc hết hạn; hãy bắt đầu lại.');
      // Always reload authoritative vehicle; no persistent car-price cache.
      const car = await this.vehicle(id, tx), resolved = await this.resolved(car, settings), result = this.invalid(() => calculateOwnership(car, dto.answers, settings.config, resolved, new Date().getUTCFullYear()));
      const hash = digest(canonical({ answers: dto.answers, price: car.price, operating: result.operatingTotal, tco: result.tco, resale: result.resale, cash: result.cashMonthly }));
      if (old && old.lastRequestId === dto.requestId) {
        if (old.answersHash !== hash) throw new ConflictException({ message: 'Dữ liệu đã đổi; hãy tính lại.', details: { revision: old.revision } });
        return { surveyId: old.id, revision: old.revision, expiresAt: old.expiresAt.toISOString(), result };
      }
      if (dto.expectedRevision !== (old?.revision || 0)) throw new ConflictException({ message: 'Lượt tính đã cập nhật; hãy tính lại.', details: { revision: old?.revision || 0 } });
      const a = dto.answers, values = {
        lastRequestId: dto.requestId, revision: (old?.revision || 0) + 1, answersHash: hash,
        vehicleSnapshot: { name: car.name, brand: car.brand, model: car.model, year: car.year, price: car.price, mileage: car.mileage },
        monthlyKm: a.monthlyKm, driving: a.driving, fuel: resolved.fuel, energyPrice: a.energyPrice, parking: a.parking, wash: a.wash, toll: a.toll, insurance: a.insurance,
        financed: a.financed, downPct: a.downPct === null ? null : String(a.downPct), termMonths: a.termMonths, annualRate: a.annualRate === null ? null : String(a.annualRate), years: a.years, region: a.region, transaction: a.transaction,
        operatingMonthly: result.operatingMonthly, cashMonthly: result.cashMonthly, tco: result.tco, resale: result.resale, updatedAt: new Date(),
      };
      const [row] = old ? await tx.update(ownershipSurveys).set(values).where(eq(ownershipSurveys.id, old.id)).returning({ id: ownershipSurveys.id, revision: ownershipSurveys.revision, expiresAt: ownershipSurveys.expiresAt }) :
        await tx.insert(ownershipSurveys).values({ ...values, interactionId: dto.interactionId, capabilityHash: digest(dto.capability), vehicleId: id, expiresAt: new Date(Date.now() + 2 * 3600000) }).returning({ id: ownershipSurveys.id, revision: ownershipSurveys.revision, expiresAt: ownershipSurveys.expiresAt });
      return { surveyId: row.id, revision: row.revision, expiresAt: row.expiresAt.toISOString(), result };
    });
  }
  async adminSettings() { return { ...await this.settings(), defaults: DEFAULT_SETTINGS }; }
  async saveSettings(dto: SettingsDto) {
    this.invalid(() => validateSettings(dto.config));
    const bodyIds = [...new Set(dto.config.fees.map(f => f.bodyId).filter((id): id is string => !!id))];
    if (bodyIds.length && (await this.database.db.select({ id: bodyStyles.id }).from(bodyStyles).where(inArray(bodyStyles.id, bodyIds))).length !== bodyIds.length) throw new BadRequestException('Nhóm kiểu dáng trong quy tắc phí không tồn tại.');
    const [row] = await this.database.db.update(ownershipSettings).set({ enabled: dto.enabled, config: dto.config, updatedAt: new Date() }).where(and(eq(ownershipSettings.id, 1), eq(ownershipSettings.updatedAt, this.invalid(() => { const d = new Date(dto.updatedAt); if (!Number.isFinite(d.getTime())) throw new Error('Thời điểm cập nhật không hợp lệ.'); return d; })))).returning();
    if (!row) throw new ConflictException('Cấu hình đã được sửa bởi người khác; hãy tải lại.'); this.cache.clear(); return row;
  }
  async listProfiles(q: ProfileQuery) {
    const db = this.database.db, filter = q.search ? ilike(ownershipProfiles.name, `%${q.search.replace(/[%_\\]/g, '\\$&')}%`) : undefined;
    const [data, [total]] = await Promise.all([db.select().from(ownershipProfiles).where(filter).orderBy(desc(ownershipProfiles.updatedAt), asc(ownershipProfiles.id)).limit(q.limit).offset((q.page - 1) * q.limit), db.select({ total: count() }).from(ownershipProfiles).where(filter)]);
    return { data, meta: { page: q.page, limit: q.limit, total: total.total, totalPages: Math.ceil(total.total / q.limit) } };
  }
  async targets(q: TargetQuery) {
    const table = { car: cars, model: carModels, version: carVersions, body: bodyStyles }[q.scope];
    return this.database.db.select({ id: table.id, name: table.name }).from(table).where(q.search ? ilike(table.name, `%${q.search.replace(/[%_\\]/g, '\\$&')}%`) : undefined).orderBy(asc(table.name)).limit(30);
  }
  async saveProfile(id: string, dto: ProfileDto) {
    this.invalid(() => validatePolicy(dto.policy));
    if (dto.scope === 'fuel') { if (!['gasoline', 'diesel', 'electric'].includes(dto.target)) throw new BadRequestException('Nhiên liệu không hợp lệ.'); }
    else {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.target)) throw new BadRequestException('ID danh mục không hợp lệ.');
      const table = { car: cars, model: carModels, version: carVersions, body: bodyStyles }[dto.scope];
      const [row] = await this.database.db.select({ id: table.id }).from(table).where(eq(table.id, dto.target)); if (!row) throw new BadRequestException('Xe/danh mục không tồn tại.');
    }
    try { await this.database.db.transaction(async tx => {
      const [old] = await tx.select().from(ownershipProfiles).where(eq(ownershipProfiles.id, id)).for('update');
      if (old && (!dto.updatedAt || dto.updatedAt !== old.updatedAt.toISOString()) || !old && dto.updatedAt) throw new ConflictException('Định mức đã thay đổi; hãy tải lại.');
      const values = { scope: dto.scope, target: dto.target, name: dto.name.trim(), policy: dto.policy, updatedAt: new Date() };
      if (old) await tx.update(ownershipProfiles).set(values).where(eq(ownershipProfiles.id, id)); else await tx.insert(ownershipProfiles).values({ id, ...values });
    }); } catch (e) { throwOnConstraint(e); } this.cache.clear(); return { saved: true };
  }
  async deleteProfile(id: string) { await this.database.db.delete(ownershipProfiles).where(eq(ownershipProfiles.id, id)); this.cache.clear(); return { deleted: true }; }
  range(q: SurveyQuery) {
    for (const date of [q.from, q.to]) if (date) {
      const d = new Date(`${date}T00:00:00Z`);
      if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new BadRequestException('Ngày không tồn tại.');
    }
    const today = new Date(), to = q.to ? new Date(`${q.to}T16:59:59.999Z`) : today;
    const from = q.from ? new Date(`${q.from}T00:00:00+07:00`) : new Date(to.getTime() - 30 * 86400000);
    if (![from, to].every(d => Number.isFinite(d.getTime())) || from > to || to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException('Chọn khoảng ngày hợp lệ, tối đa 366 ngày.');
    return { from, to, where: and(gte(ownershipSurveys.createdAt, from), lte(ownershipSurveys.createdAt, to), q.vehicleId ? eq(ownershipSurveys.vehicleId, q.vehicleId) : undefined, q.finance ? eq(ownershipSurveys.financed, q.finance === 'loan') : undefined) };
  }
  async surveys(q: SurveyQuery) {
    const { where } = this.range(q), db = this.database.db;
    const order = q.sort === 'oldest' ? asc(ownershipSurveys.createdAt) : q.sort === 'cost' ? desc(ownershipSurveys.operatingMonthly) : desc(ownershipSurveys.createdAt);
    // Explicit selection below excludes public edit credentials from admin output too.
    const columns = { id: ownershipSurveys.id, createdAt: ownershipSurveys.createdAt, updatedAt: ownershipSurveys.updatedAt, vehicleId: ownershipSurveys.vehicleId, vehicleSnapshot: ownershipSurveys.vehicleSnapshot, monthlyKm: ownershipSurveys.monthlyKm, financed: ownershipSurveys.financed, years: ownershipSurveys.years, operatingMonthly: ownershipSurveys.operatingMonthly, cashMonthly: ownershipSurveys.cashMonthly, tco: ownershipSurveys.tco, resale: ownershipSurveys.resale };
    const [data, [total]] = await Promise.all([db.select(columns).from(ownershipSurveys).where(where).orderBy(order, asc(ownershipSurveys.id)).limit(q.limit).offset((q.page - 1) * q.limit), db.select({ total: count() }).from(ownershipSurveys).where(where)]);
    return { data, meta: { page: q.page, limit: q.limit, total: total.total, totalPages: Math.ceil(total.total / q.limit) } };
  }
  async detail(id: string) {
    const [row] = await this.database.db.select().from(ownershipSurveys).where(eq(ownershipSurveys.id, id)); if (!row) throw new NotFoundException('Không tìm thấy khảo sát.');
    const { capabilityHash: _capability, interactionId: _interaction, lastRequestId: _request, answersHash: _hash, expiresAt: _expires, ...safe } = row; void [_capability, _interaction, _request, _hash, _expires]; return safe;
  }
  async summary(q: SurveyQuery) {
    const { from, to, where } = this.range(q), db = this.database.db;
    return db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '4s'`);
      const [totals] = await tx.select({ total: count(), financed: sql<number>`count(*) filter (where ${ownershipSurveys.financed})`.mapWith(Number), averageOperating: sql<number>`coalesce(round(avg(${ownershipSurveys.operatingMonthly})),0)`.mapWith(Number), averageKm: sql<number>`coalesce(round(avg(${ownershipSurveys.monthlyKm})),0)`.mapWith(Number) }).from(ownershipSurveys).where(where);
      const topCars = await tx.select({ vehicleId: ownershipSurveys.vehicleId, name: sql<string>`max(${ownershipSurveys.vehicleSnapshot}->>'name')`, total: count() }).from(ownershipSurveys).where(where).groupBy(ownershipSurveys.vehicleId).orderBy(desc(count())).limit(10);
      const commonKm = await tx.select({ km: ownershipSurveys.monthlyKm, total: count() }).from(ownershipSurveys).where(where).groupBy(ownershipSurveys.monthlyKm).orderBy(desc(count())).limit(5);
      return { ...totals, loanPct: totals.total ? Math.round(totals.financed / totals.total * 100) : 0, from: from.toISOString(), to: to.toISOString(), topCars, commonKm };
    });
  }
}
