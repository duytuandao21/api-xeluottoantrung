import { Controller, Get, Header, Inject, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { Permissions } from '../auth/auth.decorators.js';
import { AnalyticsService } from './analytics.service.js';
import { ANALYTICS_RANGES } from './analytics.types.js';

export class AnalyticsQuery {
  @IsOptional() @IsIn(ANALYTICS_RANGES.map(range => range.id))
  range?: string;
}

@ApiTags('Admin analytics') @ApiBearerAuth() @Controller('admin/dashboard/analytics')
export class AdminAnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}
  @Get() @Permissions('analytics.read') @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Hostname-scoped Cloudflare aggregates; cached in backend for 10 minutes' })
  snapshot(@Query() query: AnalyticsQuery) { return this.analytics.snapshot(query.range); }
}
