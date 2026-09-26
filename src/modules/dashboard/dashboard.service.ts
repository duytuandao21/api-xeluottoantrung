import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import { cars, customers, leads } from '../../database/schema/index.js';

@Injectable()
export class DashboardService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}
  async summary() {
    const [carRows, featuredRows, leadRows, customerRows] = await Promise.all([
      this.database.db.select({ total: count() }).from(cars).where(isNull(cars.deletedAt)),
      this.database.db.select({ total: count() }).from(cars).where(and(isNull(cars.deletedAt), eq(cars.featured, true))),
      this.database.db.select({ total: count() }).from(leads).where(eq(leads.status, 'unread')),
      this.database.db.select({ total: count() }).from(customers).where(isNull(customers.deletedAt)),
    ]);
    return { cars: carRows[0]?.total ?? 0, featuredCars: featuredRows[0]?.total ?? 0,
      unreadLeads: leadRows[0]?.total ?? 0, customers: customerRows[0]?.total ?? 0,
      websiteViews: null, generatedAt: new Date().toISOString() };
  }
}
