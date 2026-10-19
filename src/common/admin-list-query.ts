import { IsIn, IsOptional } from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

// A shared vocabulary is further restricted to fields of each resource.
export class AdminSortQuery {
  @IsOptional() @IsIn(['name', 'title', 'slug', 'createdAt', 'updatedAt', 'price', 'salePrice', 'mileage', 'email', 'lastLogin', 'question']) sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
}
export function adminOrder(query: AdminSortQuery, allowed: readonly string[]) {
  if (!query.sortBy) return undefined;
  const aliases: Record<string, string> = { lastLogin: 'last_login_at' };
  const field = aliases[query.sortBy] ?? query.sortBy.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  if (!allowed.includes(field)) throw new BadRequestException('Unsupported sort field');
  return sql`${sql.identifier(field)} ${query.sortDirection === 'desc' ? sql`DESC` : sql`ASC`}, id ASC`;
}
