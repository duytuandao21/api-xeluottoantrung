import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../auth/auth.decorators.js';
import { DashboardService } from './dashboard.service.js';

@ApiTags('Admin dashboard') @ApiBearerAuth() @Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboard: DashboardService) {}
  @Get() @Permissions('dashboard.read')
  @ApiOperation({ summary: 'Business counts from database; websiteViews is null until analytics is configured' })
  summary() { return this.dashboard.summary(); }
}
