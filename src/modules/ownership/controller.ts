import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Permissions, Public } from '../auth/auth.decorators.js';
import { CalculateDto, ProfileDto, ProfileQuery, SettingsDto, SurveyQuery, TargetQuery } from './dto.js';
import { OwnershipService } from './service.js';
@ApiTags('Ownership cost') @Public() @Controller('cars')
export class OwnershipPublicController {
  constructor(private readonly service: OwnershipService) {}
  @Get(':id/ownership-config') @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 40, ttl: 60000 } })
  config(@Param('id', ParseUUIDPipe) id: string) { return this.service.config(id); }
  @Post(':id/ownership-calculate') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 15, ttl: 60000 } })
  calculate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CalculateDto) { return this.service.submit(id, dto); }
}
@ApiTags('Admin ownership') @ApiBearerAuth() @Controller('admin/ownership')
export class OwnershipAdminController {
  constructor(private readonly service: OwnershipService) {}
  @Get('settings') @Permissions('ownership.read') @Header('Cache-Control', 'no-store') settings() { return this.service.adminSettings(); }
  @Patch('settings') @Permissions('ownership.settings.update') save(@Body() dto: SettingsDto) { return this.service.saveSettings(dto); }
  @Get('profiles') @Permissions('ownership.read') profiles(@Query() dto: ProfileQuery) { return this.service.listProfiles(dto); }
  @Get('targets') @Permissions('ownership.read') targets(@Query() dto: TargetQuery) { return this.service.targets(dto); }
  @Put('profiles/:id') @Permissions('ownership.profiles.update') saveProfile(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProfileDto) { return this.service.saveProfile(id, dto); }
  @Delete('profiles/:id') @Permissions('ownership.profiles.update') deleteProfile(@Param('id', ParseUUIDPipe) id: string) { return this.service.deleteProfile(id); }
  @Get('surveys') @Permissions('ownership.read') @Header('Cache-Control', 'no-store') surveys(@Query() dto: SurveyQuery) { return this.service.surveys(dto); }
  @Get('surveys/:id') @Permissions('ownership.read') @Header('Cache-Control', 'no-store') detail(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id); }
  @Get('summary') @Permissions('ownership.read') @Header('Cache-Control', 'no-store') summary(@Query() dto: SurveyQuery) { return this.service.summary(dto); }
}
