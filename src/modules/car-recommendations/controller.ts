import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CapabilityDto, EventDto, ResultsPageDto, SessionDto } from './dto.js';
import { RecommendationService } from './service.js';
import { RecommendationAdminService } from './admin.service.js';
import { RecommendationReporting } from './reporting.js';
import { BatchProfilesDto, DateRangeQuery, HistoryQuery, PreviewDto, ProfileDto, ProfileQuery, SettingsDto } from './admin.dto.js';
@ApiTags('Public car recommendations') @Public() @Controller('car-recommendations')
export class RecommendationPublicController {
  constructor(private readonly service: RecommendationService) {}
  @Get('config') @Header('Cache-Control', 'no-store') config() { return this.service.config(); }
  @Post('sessions') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 20, ttl: 60000 } })
  submit(@Body() dto: SessionDto) { return this.service.submit(dto); }
  @Post('sessions/:id/resume') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 30, ttl: 60000 } })
  resume(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CapabilityDto) { return this.service.resume(id, dto.capability); }
  @Post('sessions/:id/results') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 30, ttl: 60000 } })
  results(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResultsPageDto) { return this.service.resume(id, dto.capability, dto.offset); }
  @Post('sessions/:id/events') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 60, ttl: 60000 } })
  event(@Param('id', ParseUUIDPipe) id: string, @Body() dto: EventDto) { return this.service.event(id, dto); }
}
@ApiTags('Admin car recommendation history') @ApiBearerAuth() @Controller('admin/car-recommendations')
export class RecommendationHistoryController {
  constructor(private readonly admin: RecommendationAdminService, private readonly reporting: RecommendationReporting) {}
  @Get('sessions') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  sessions(@Query() query: HistoryQuery) { return this.reporting.sessions(query); }
  @Get('sessions/:id') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  async detail(@Param('id', ParseUUIDPipe) id: string) { const row = await this.reporting.detail(id); if (!row) throw new NotFoundException('Không tìm thấy khảo sát.'); return row; }
  @Get('overview') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  overview(@Query() dto: DateRangeQuery) { return this.reporting.overview(dto); }
  @Get('settings') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  settings() { return this.admin.settings(); }
  @Put('settings') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.settings.update')
  saveSettings(@Body() dto: SettingsDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.admin.saveSettings(dto, auditContext(req, user)); }
  @Post('preview') @HttpCode(200) @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  preview(@Body() dto: PreviewDto) { return this.admin.preview(dto); }
  @Get('car-profiles') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  profiles(@Query() dto: ProfileQuery) { return this.reporting.profiles(dto); }
  @Get('car-profiles/:id') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.sessions.read')
  profile(@Param('id', ParseUUIDPipe) id: string) { return this.admin.profile(id); }
  @Put('car-profiles/batch') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.profiles.update')
  batch(@Body() dto: BatchProfilesDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.admin.saveProfiles(dto, auditContext(req, user)); }
  @Put('car-profiles/:id') @Header('Cache-Control', 'no-store') @Permissions('car_recommendation.profiles.update')
  saveProfile(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProfileDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.admin.saveProfiles({ items: [{ carId: id, ...dto }] }, auditContext(req, user)); }
}
