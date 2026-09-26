import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { validateEnv } from '../src/config/env.js';

class PaginationQuery {
  page!: number;
}
Type(() => Number)(PaginationQuery.prototype, 'page');
IsInt()(PaginationQuery.prototype, 'page');
Min(1)(PaginationQuery.prototype, 'page');

test('environment rejects wildcard CORS origins', () => {
  assert.throws(() => validateEnv({ DATABASE_URL: 'postgresql://user:pass@localhost/db', CORS_ORIGINS: '*', SUPABASE_URL: 'https://project.supabase.co' }), /CORS_ORIGINS/);
});

test('global validation settings convert query numbers and reject unknown fields', async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const metadata = { type: 'query' as const, metatype: PaginationQuery, data: undefined };
  const valid = await pipe.transform({ page: '2' }, metadata) as PaginationQuery;
  assert.equal(valid.page, 2);
  await assert.rejects(pipe.transform({ page: '2', unexpected: 'value' }, metadata), BadRequestException);
  await assert.rejects(pipe.transform({ page: '0' }, metadata), BadRequestException);
});
