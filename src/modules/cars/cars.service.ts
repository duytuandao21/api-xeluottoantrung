import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { throwOnConstraint } from '../../common/database-errors.js';
import { toSlug } from '../../common/slug.js';
import type { AuditContext } from '../../common/audit.js';
import { DatabaseService } from '../../database/database.service.js';
import { auditLogs, bodyStyles, branches, brands, carColors, carMedia, carModels, carSpecifications, cars, carVersions, transmissions } from '../../database/schema/index.js';
import { CreateCarDto, ListCarsQuery, UpdateCarDto } from './cars.dto.js';

const publicStatuses = ['active', 'deposit', 'sold'] as const;
type CarRow = typeof cars.$inferSelect;

function auditSnapshot(car: CarRow) {
  return { id: car.id, slug: car.slug, name: car.name, brandId: car.brandId, modelId: car.modelId,
    year: car.year, price: car.price, status: car.status, publishedAt: car.publishedAt, deletedAt: car.deletedAt };
}

function validateRanges(query: ListCarsQuery): void {
  for (const [min, max, label] of [[query.year_from, query.year_to, 'year'], [query.price_min, query.price_max, 'price'], [query.mileage_min, query.mileage_max, 'mileage']] as const) {
    if (min !== undefined && max !== undefined && min > max) throw new BadRequestException(`${label} minimum cannot exceed maximum`);
  }
}

function slugFilter(column: typeof brands.slug, value: string): SQL;
function slugFilter(column: typeof bodyStyles.slug, value: string): SQL;
function slugFilter(column: typeof transmissions.slug, value: string): SQL;
function slugFilter(column: typeof carColors.slug, value: string): SQL;
function slugFilter(column: typeof brands.slug | typeof bodyStyles.slug | typeof transmissions.slug | typeof carColors.slug, value: string): SQL {
  const slugs = [...new Set(value.split(',').map(slug => slug.trim()).filter(Boolean))];
  if (!slugs.length || slugs.length > 20) throw new BadRequestException('Provide 1 to 20 filter values');
  return inArray(column, slugs);
}

function orderFor(sort: ListCarsQuery['sort']) {
  switch (sort) {
    case 'oldest': return [asc(cars.createdAt), asc(cars.id)];
    case 'price_asc': return [asc(cars.price), desc(cars.createdAt), asc(cars.id)];
    case 'price_desc': return [desc(cars.price), desc(cars.createdAt), asc(cars.id)];
    case 'year_desc': return [desc(cars.year), desc(cars.createdAt), asc(cars.id)];
    case 'mileage_asc': return [asc(cars.mileage), desc(cars.createdAt), asc(cars.id)];
    default: return [desc(cars.updatedAt), desc(cars.createdAt), asc(cars.id)];
  }
}

@Injectable()
export class CarsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private conditions(query: ListCarsQuery, admin: boolean, salePlateSearch = false): SQL[] {
    validateRanges(query);
    const filters: SQL[] = [isNull(cars.deletedAt)];
    if (!admin) {
      filters.push(isNotNull(cars.publishedAt), inArray(cars.status, publicStatuses), eq(brands.status, 'active'), eq(carModels.status, 'active'));
    }
    if (query.search?.trim()) {
      const term = `%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const plateTerm = `%${query.search.trim().replace(/[^a-z0-9]/gi, '')}%`;
      const search = admin ? or(ilike(cars.name, term), ilike(cars.sku, term))
        : salePlateSearch && plateTerm !== '%%'
          ? or(ilike(cars.name, term), ilike(sql`regexp_replace(coalesce(${cars.licensePlate}, ''), '[^A-Za-z0-9]', '', 'g')`, plateTerm))
          : ilike(cars.name, term);
      if (search) filters.push(search);
    }
    if (query.brand) filters.push(slugFilter(brands.slug, query.brand));
    if (query.model) filters.push(eq(carModels.slug, query.model));
    if (query.version) filters.push(eq(carVersions.slug, query.version));
    if (query.year_from !== undefined) filters.push(gte(cars.year, query.year_from));
    if (query.year_to !== undefined) filters.push(lte(cars.year, query.year_to));
    if (query.price_min !== undefined) filters.push(gte(cars.price, query.price_min));
    if (query.price_max !== undefined) filters.push(lte(cars.price, query.price_max));
    if (query.body_type) filters.push(slugFilter(bodyStyles.slug, query.body_type));
    if (query.fuel_type) filters.push(eq(cars.fuel, query.fuel_type));
    if (query.transmission) filters.push(slugFilter(transmissions.slug, query.transmission));
    if (query.color) filters.push(slugFilter(carColors.slug, query.color));
    if (query.branch) filters.push(eq(branches.slug, query.branch));
    if (query.mileage_min !== undefined) filters.push(gte(cars.mileage, query.mileage_min));
    if (query.mileage_max !== undefined) filters.push(lte(cars.mileage, query.mileage_max));
    if (query.status) filters.push(eq(cars.status, query.status));
    if (query.featured) filters.push(eq(cars.featured, query.featured === 'true'));
    return filters;
  }

  async list(query: ListCarsQuery, admin = false, salePlateSearch = false) {
    const where = and(...this.conditions(query, admin, salePlateSearch));
    const base = this.database.db.select({ total: count(cars.id) }).from(cars)
      .innerJoin(brands, eq(brands.id, cars.brandId))
      .innerJoin(carModels, eq(carModels.id, cars.modelId))
      .leftJoin(carVersions, eq(carVersions.id, cars.versionId))
      .leftJoin(bodyStyles, eq(bodyStyles.id, cars.bodyStyleId))
      .leftJoin(transmissions, eq(transmissions.id, cars.transmissionId))
      .leftJoin(carColors, eq(carColors.id, cars.colorId))
      .leftJoin(branches, eq(branches.id, cars.branchId))
      .where(where);
    const totalRow = await base;
    const rows = await this.database.db.select({
        id: cars.id, sku: cars.sku, slug: cars.slug, name: cars.name, year: cars.year, price: cars.price,
        originalPrice: cars.originalPrice, mileage: cars.mileage, seatCount: cars.seatCount,
        licensePlate: cars.licensePlate, status: cars.status,
        transmissionId: cars.transmissionId,
        featured: cars.featured, installment: cars.installment, newArrival: cars.newArrival,
        publishedAt: cars.publishedAt, createdAt: cars.createdAt,
        brand: { id: brands.id, name: brands.name, slug: brands.slug },
        model: { id: carModels.id, name: carModels.name, slug: carModels.slug },
        version: carVersions.name, branch: branches.name,
        bodyType: bodyStyles.name, transmission: transmissions.name, color: carColors.name,
        colorSlug: carColors.slug, fuel: cars.fuel,
        cover: carMedia.publicUrl,
      }).from(cars)
        .innerJoin(brands, eq(brands.id, cars.brandId))
        .innerJoin(carModels, eq(carModels.id, cars.modelId))
        .leftJoin(carVersions, eq(carVersions.id, cars.versionId))
        .leftJoin(bodyStyles, eq(bodyStyles.id, cars.bodyStyleId))
        .leftJoin(transmissions, eq(transmissions.id, cars.transmissionId))
        .leftJoin(carColors, eq(carColors.id, cars.colorId))
        .leftJoin(branches, eq(branches.id, cars.branchId))
        .leftJoin(carMedia, and(eq(carMedia.carId, cars.id), eq(carMedia.isCover, true), isNull(carMedia.deletionPendingAt)))
        .where(where).orderBy(...orderFor(query.sort)).limit(query.limit).offset((query.page - 1) * query.limit);
    const total = totalRow[0]?.total ?? 0;
    return { data: rows.map((row) => admin ? row : ({
      slug: row.slug, name: row.name, year: row.year, price: row.price,
      originalPrice: row.originalPrice, mileage: row.mileage, seatCount: row.seatCount,
      status: row.status,
      featured: row.featured, installment: row.installment, newArrival: row.newArrival,
      brand: row.brand, model: row.model, bodyType: row.bodyType, transmission: row.transmission,
      color: row.color, colorSlug: row.colorSlug,
      fuel: row.fuel, cover: row.cover, branch: row.branch,
    })), meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async publicDetail(slug: string) {
    const [row] = await this.database.db.select({ car: cars, brand: { id: brands.id, name: brands.name, slug: brands.slug },
      model: { id: carModels.id, name: carModels.name, slug: carModels.slug },
      version: carVersions.name, bodyType: bodyStyles.name, transmission: transmissions.name,
      color: carColors.name, branch: { id: branches.id, name: branches.name, slug: branches.slug, address: branches.address, phone: branches.phone, mapUrl: branches.mapUrl, imageUrl: branches.imageUrl },
    }).from(cars)
      .innerJoin(brands, eq(brands.id, cars.brandId)).innerJoin(carModels, eq(carModels.id, cars.modelId))
      .leftJoin(carVersions, eq(carVersions.id, cars.versionId)).leftJoin(bodyStyles, eq(bodyStyles.id, cars.bodyStyleId))
      .leftJoin(transmissions, eq(transmissions.id, cars.transmissionId)).leftJoin(carColors, eq(carColors.id, cars.colorId))
      .leftJoin(branches, eq(branches.id, cars.branchId))
      .where(and(eq(cars.slug, slug), isNull(cars.deletedAt), isNotNull(cars.publishedAt), inArray(cars.status, publicStatuses),
        eq(brands.status, 'active'), eq(carModels.status, 'active')));
    if (!row) throw new NotFoundException('Car not found');
    const media = await this.database.db.select({ type: carMedia.type, url: carMedia.publicUrl, altText: carMedia.altText, isCover: carMedia.isCover, sortOrder: carMedia.sortOrder })
      .from(carMedia).where(and(eq(carMedia.carId, row.car.id), isNull(carMedia.deletionPendingAt))).orderBy(desc(carMedia.isCover), asc(carMedia.sortOrder));
    const specifications = await this.database.db.select({ key: carSpecifications.key, label: carSpecifications.label, value: carSpecifications.value, sortOrder: carSpecifications.sortOrder })
      .from(carSpecifications).where(eq(carSpecifications.carId, row.car.id)).orderBy(asc(carSpecifications.sortOrder));
    const car = row.car;
    return { slug: car.slug, name: car.name, year: car.year, price: car.price, originalPrice: car.originalPrice,
      mileage: car.mileage, fuel: car.fuel, condition: car.condition, seatCount: car.seatCount,
      description: car.description, status: car.status, featured: car.featured, installment: car.installment,
      newArrival: car.newArrival, brand: row.brand, model: row.model, version: row.version,
      bodyType: row.bodyType, transmission: row.transmission, color: row.color, branch: row.branch?.id ? row.branch : null,
      media, specifications };
  }

  async saleLicensePlates(slugs: string[]) {
    const unique = [...new Set(slugs.map(slug => slug.trim()).filter(Boolean))];
    if (unique.length > 50 || unique.some(slug => slug.length > 200)) throw new BadRequestException('Provide at most 50 valid car slugs');
    if (!unique.length) return {};
    const rows = await this.database.db.select({ slug: cars.slug, licensePlate: cars.licensePlate }).from(cars)
      .innerJoin(brands, eq(brands.id, cars.brandId))
      .innerJoin(carModels, eq(carModels.id, cars.modelId))
      .where(and(inArray(cars.slug, unique), isNull(cars.deletedAt), isNotNull(cars.publishedAt),
        inArray(cars.status, publicStatuses), eq(brands.status, 'active'), eq(carModels.status, 'active')));
    return Object.fromEntries(rows.filter(row => row.licensePlate).map(row => [row.slug, row.licensePlate]));
  }

  async adminDetail(id: string) {
    const [car] = await this.database.db.select().from(cars).where(and(eq(cars.id, id), isNull(cars.deletedAt)));
    if (!car) throw new NotFoundException('Car not found');
    const media = await this.database.db.select().from(carMedia).where(and(eq(carMedia.carId, id), isNull(carMedia.deletionPendingAt))).orderBy(asc(carMedia.sortOrder));
    const specifications = await this.database.db.select().from(carSpecifications).where(eq(carSpecifications.carId, id)).orderBy(asc(carSpecifications.sortOrder));
    return { ...car, media, specifications };
  }

  private async validateReferences(input: { brandId: string; modelId: string; versionId?: string | null;
    bodyStyleId?: string | null; branchId?: string | null; transmissionId?: string | null; colorId?: string | null },
    database: Pick<DatabaseService['db'], 'select'> = this.database.db) {
    const [brand] = await database.select({ id: brands.id, status: brands.status }).from(brands).where(eq(brands.id, input.brandId));
    const [model] = await database.select({ id: carModels.id, brandId: carModels.brandId, bodyStyleId: carModels.bodyStyleId, status: carModels.status })
      .from(carModels).where(eq(carModels.id, input.modelId));
    if (!brand) throw new BadRequestException('brandId does not exist');
    if (!model || model.brandId !== brand.id) throw new BadRequestException('modelId does not belong to brandId');
    const bodyStyleId = input.bodyStyleId ?? model.bodyStyleId;
    if (input.bodyStyleId && model.bodyStyleId && input.bodyStyleId !== model.bodyStyleId) throw new BadRequestException('bodyStyleId does not match modelId');
    if (bodyStyleId) {
      const [bodyStyle] = await database.select({ id: bodyStyles.id }).from(bodyStyles).where(eq(bodyStyles.id, bodyStyleId));
      if (!bodyStyle) throw new BadRequestException('bodyStyleId does not exist');
    }
    if (input.versionId) {
      const [version] = await database.select({ modelId: carVersions.modelId }).from(carVersions).where(eq(carVersions.id, input.versionId));
      if (!version || version.modelId !== model.id) throw new BadRequestException('versionId does not belong to modelId');
    }
    for (const [value, table, column, label] of [
      [input.branchId, branches, branches.id, 'branchId'],
      [input.transmissionId, transmissions, transmissions.id, 'transmissionId'],
      [input.colorId, carColors, carColors.id, 'colorId'],
    ] as const) {
      if (!value) continue;
      const [found] = await database.select({ id: column }).from(table).where(eq(column, value));
      if (!found) throw new BadRequestException(`${label} does not exist`);
    }
    return { bodyStyleId, brandStatus: brand.status, modelStatus: model.status };
  }

  async create(dto: CreateCarDto, audit: AuditContext) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Name is required');
    try {
      return await this.database.db.transaction(async (tx) => {
        const refs = await this.validateReferences(dto, tx);
        const [created] = await tx.insert(cars).values({ ...dto, name, slug: dto.slug ?? toSlug(name),
          bodyStyleId: refs.bodyStyleId, publishedAt: null }).returning();
        await tx.insert(auditLogs).values({ ...audit, action: 'car.create', entityType: 'car', entityId: created.id, newData: auditSnapshot(created) });
        return created;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async update(id: string, dto: UpdateCarDto, audit: AuditContext) {
    if (Object.keys(dto).length === 0) throw new BadRequestException('At least one field is required');
    try {
      return await this.database.db.transaction(async (tx) => {
        const [old] = await tx.select().from(cars).where(and(eq(cars.id, id), isNull(cars.deletedAt))).for('update');
        if (!old) throw new NotFoundException('Car not found');
        const brandId = dto.brandId ?? old.brandId;
        const modelId = dto.modelId ?? old.modelId;
        const refs = await this.validateReferences({ brandId, modelId,
          versionId: dto.versionId === undefined ? old.versionId : dto.versionId,
          bodyStyleId: dto.bodyStyleId === undefined ? (dto.modelId ? null : old.bodyStyleId) : dto.bodyStyleId,
          branchId: dto.branchId === undefined ? old.branchId : dto.branchId,
          transmissionId: dto.transmissionId === undefined ? old.transmissionId : dto.transmissionId,
          colorId: dto.colorId === undefined ? old.colorId : dto.colorId,
        }, tx);
        const name = dto.name === undefined ? undefined : dto.name.trim();
        if (name === '') throw new BadRequestException('Name is required');
        const [updated] = await tx.update(cars).set({ ...dto, ...(name !== undefined ? { name } : {}),
          bodyStyleId: refs.bodyStyleId, updatedAt: new Date() })
          .where(and(eq(cars.id, id), isNull(cars.deletedAt))).returning();
        await tx.insert(auditLogs).values({ ...audit, action: 'car.update', entityType: 'car', entityId: id,
          oldData: auditSnapshot(old), newData: auditSnapshot(updated) });
        if (old.price !== updated.price) await tx.insert(auditLogs).values({ ...audit, action: 'car.price_change', entityType: 'car', entityId: id,
          oldData: { price: old.price }, newData: { price: updated.price } });
        if (old.status !== updated.status) await tx.insert(auditLogs).values({ ...audit, action: 'car.status_change', entityType: 'car', entityId: id,
          oldData: { status: old.status }, newData: { status: updated.status } });
        return updated;
      });
    } catch (error) { return throwOnConstraint(error); }
  }

  async delete(id: string, audit: AuditContext): Promise<void> {
    await this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(cars).where(and(eq(cars.id, id), isNull(cars.deletedAt))).for('update');
      if (!old) throw new NotFoundException('Car not found');
      const [deleted] = await tx.update(cars).set({ deletedAt: new Date(), publishedAt: null, status: 'inactive', updatedAt: new Date() })
        .where(eq(cars.id, id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'car.delete', entityType: 'car', entityId: id,
        oldData: auditSnapshot(old), newData: auditSnapshot(deleted) });
    });
  }

  async publish(id: string, audit: AuditContext) {
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(cars).where(and(eq(cars.id, id), isNull(cars.deletedAt))).for('update');
      if (!old) throw new NotFoundException('Car not found');
      const refs = await this.validateReferences(old, tx);
      if (refs.brandStatus !== 'active' || refs.modelStatus !== 'active') throw new ConflictException('Brand and model must be active before publishing');
      if (old.publishedAt && old.status !== 'inactive') return old;
      const [published] = await tx.update(cars).set({ status: old.status === 'inactive' ? 'active' : old.status,
        publishedAt: old.publishedAt ?? new Date(), updatedAt: new Date() }).where(eq(cars.id, id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'car.publish', entityType: 'car', entityId: id,
        oldData: auditSnapshot(old), newData: auditSnapshot(published) });
      if (old.status !== published.status) await tx.insert(auditLogs).values({ ...audit, action: 'car.status_change', entityType: 'car', entityId: id,
        oldData: { status: old.status }, newData: { status: published.status } });
      return published;
    });
  }

  async unpublish(id: string, audit: AuditContext) {
    return this.database.db.transaction(async (tx) => {
      const [old] = await tx.select().from(cars).where(and(eq(cars.id, id), isNull(cars.deletedAt))).for('update');
      if (!old) throw new NotFoundException('Car not found');
      if (!old.publishedAt) return old;
      const [updated] = await tx.update(cars).set({ publishedAt: null, updatedAt: new Date() }).where(eq(cars.id, id)).returning();
      await tx.insert(auditLogs).values({ ...audit, action: 'car.unpublish', entityType: 'car', entityId: id,
        oldData: auditSnapshot(old), newData: auditSnapshot(updated) });
      return updated;
    });
  }
}
