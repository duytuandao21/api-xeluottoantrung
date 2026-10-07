import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, getTableColumns, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { throwOnConstraint } from '../../common/database-errors.js';
import { toSlug } from '../../common/slug.js';
import { DatabaseService } from '../../database/database.service.js';
import { bodyStyles, brands, carModels, cars } from '../../database/schema/index.js';
import { CreateBrandDto, CreateModelDto, UpdateBrandDto, UpdateModelDto } from './catalog.dto.js';

function cleanName(value: string): string {
  const name = value.trim();
  if (!name) throw new BadRequestException('Name is required');
  return name;
}

@Injectable()
export class CatalogService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async publicBrands() {
    // Count public cars still in stock, including deposits awaiting handover.
    const inventory = this.database.db.select({ brandId: cars.brandId, stockCount: count(cars.id).as('stock_count') })
      .from(cars).innerJoin(carModels, eq(carModels.id, cars.modelId))
      .where(and(isNull(cars.deletedAt), isNotNull(cars.publishedAt), inArray(cars.status, ['active', 'deposit']), eq(carModels.status, 'active')))
      .groupBy(cars.brandId).as('brand_inventory');
    const stockCount = sql<number>`coalesce(${inventory.stockCount}, 0)::int`;
    return this.database.db.select({ id: brands.id, name: brands.name, slug: brands.slug, imageUrl: brands.imageUrl, stockCount })
      .from(brands).leftJoin(inventory, eq(brands.id, inventory.brandId)).where(eq(brands.status, 'active'))
      .orderBy(desc(stockCount), asc(brands.sortOrder), asc(brands.name), asc(brands.id));
  }

  async publicModels(brandSlug: string) {
    const [brand] = await this.database.db.select({ id: brands.id }).from(brands)
      .where(and(eq(brands.slug, brandSlug), eq(brands.status, 'active')));
    if (!brand) throw new NotFoundException('Brand not found');
    return this.database.db.select({ id: carModels.id, name: carModels.name, slug: carModels.slug, imageUrl: carModels.imageUrl })
      .from(carModels).where(and(eq(carModels.brandId, brand.id), eq(carModels.status, 'active')))
      .orderBy(asc(carModels.sortOrder), asc(carModels.name));
  }

  async adminBrands() {
    return this.database.db.select({ ...getTableColumns(brands),
      count: sql<number>`(SELECT count(*)::int FROM ${cars} counted_cars WHERE counted_cars.brand_id = ${brands}.id AND counted_cars.deleted_at IS NULL)`,
    }).from(brands).orderBy(asc(brands.sortOrder), asc(brands.name));
  }

  async adminBrand(id: string) {
    const [brand] = await this.database.db.select().from(brands).where(eq(brands.id, id));
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async createBrand(dto: CreateBrandDto) {
    const name = cleanName(dto.name);
    try {
      const [created] = await this.database.db.insert(brands).values({ name, slug: dto.slug ?? toSlug(name), imageUrl: dto.imageUrl, status: dto.status, sortOrder: dto.sortOrder }).returning();
      return created;
    } catch (error) { return throwOnConstraint(error); }
  }

  async updateBrand(id: string, dto: UpdateBrandDto) {
    const values = { ...dto, ...(dto.name !== undefined ? { name: cleanName(dto.name) } : {}), updatedAt: new Date() };
    try {
      const [updated] = await this.database.db.update(brands).set(values).where(eq(brands.id, id)).returning();
      if (!updated) throw new NotFoundException('Brand not found');
      return updated;
    } catch (error) { return throwOnConstraint(error); }
  }

  async deleteBrand(id: string): Promise<void> {
    try {
      const [deleted] = await this.database.db.delete(brands).where(eq(brands.id, id)).returning({ id: brands.id });
      if (!deleted) throw new NotFoundException('Brand not found');
    } catch (error) { throwOnConstraint(error); }
  }

  async adminModels(brandId?: string) {
    return this.database.db.select({ ...getTableColumns(carModels),
      count: sql<number>`(SELECT count(*)::int FROM ${cars} counted_cars WHERE counted_cars.model_id = ${carModels}.id AND counted_cars.deleted_at IS NULL)`,
    }).from(carModels).where(brandId ? eq(carModels.brandId, brandId) : undefined)
      .orderBy(asc(carModels.sortOrder), asc(carModels.name));
  }

  async adminModel(id: string) {
    const [model] = await this.database.db.select().from(carModels).where(eq(carModels.id, id));
    if (!model) throw new NotFoundException('Model not found');
    return model;
  }

  private async validateModelReferences(brandId: string, bodyStyleId?: string | null): Promise<void> {
    const [brand] = await this.database.db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId));
    if (!brand) throw new BadRequestException('brandId does not exist');
    if (bodyStyleId) {
      const [bodyStyle] = await this.database.db.select({ id: bodyStyles.id }).from(bodyStyles).where(eq(bodyStyles.id, bodyStyleId));
      if (!bodyStyle) throw new BadRequestException('bodyStyleId does not exist');
    }
  }

  async createModel(dto: CreateModelDto) {
    await this.validateModelReferences(dto.brandId, dto.bodyStyleId);
    const name = cleanName(dto.name);
    try {
      const [created] = await this.database.db.insert(carModels).values({ ...dto, name, slug: dto.slug ?? toSlug(name) }).returning();
      return created;
    } catch (error) { return throwOnConstraint(error); }
  }

  async updateModel(id: string, dto: UpdateModelDto) {
    const current = await this.adminModel(id);
    if ((dto.brandId && dto.brandId !== current.brandId) || (dto.bodyStyleId !== undefined && dto.bodyStyleId !== current.bodyStyleId)) {
      const [existingCar] = await this.database.db.select({ id: cars.id }).from(cars).where(eq(cars.modelId, id)).limit(1);
      if (existingCar) throw new ConflictException('Cannot change brand or body style of a model used by cars');
    }
    await this.validateModelReferences(dto.brandId ?? current.brandId, dto.bodyStyleId === undefined ? current.bodyStyleId : dto.bodyStyleId);
    if (dto.brandId && dto.brandId !== current.brandId) {
      const linked = await this.database.db.execute(sql`SELECT id FROM valuation_rules WHERE model_id = ${id} UNION ALL SELECT r.id FROM valuation_reference_prices r JOIN car_versions v ON v.id = r.variant_id WHERE v.model_id = ${id} UNION ALL SELECT r.id FROM valuation_rules r JOIN car_versions v ON v.id = r.variant_id WHERE v.model_id = ${id} LIMIT 1`);
      if (linked.rows.length) throw new ConflictException('Dòng xe đã dùng trong định giá, không thể chuyển hãng.');
    }
    const values = { ...dto, ...(dto.name !== undefined ? { name: cleanName(dto.name) } : {}), updatedAt: new Date() };
    try {
      const [updated] = await this.database.db.update(carModels).set(values).where(eq(carModels.id, id)).returning();
      if (!updated) throw new NotFoundException('Model not found');
      return updated;
    } catch (error) { return throwOnConstraint(error); }
  }

  async deleteModel(id: string): Promise<void> {
    try {
      const [deleted] = await this.database.db.delete(carModels).where(eq(carModels.id, id)).returning({ id: carModels.id });
      if (!deleted) throw new NotFoundException('Model not found');
    } catch (error) { throwOnConstraint(error); }
  }
}
