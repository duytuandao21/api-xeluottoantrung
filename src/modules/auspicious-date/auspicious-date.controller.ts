import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuditQuery, CaseDto, ChangeDto, ContentDto, DetailDto, PublishDto, RuleDto, SearchDto, SettingsDto, SimulateDto, SourceDto, VersionDto } from './auspicious-date.dto.js';
import { AuspiciousAdminService } from './admin.service.js';
import { ReferenceValidation } from './engine/reference-validation.js';
import { AuspiciousPublicService } from './public.service.js';
import { AuspiciousRepository } from './repository.js';
import { AuspiciousVersionsService } from './versions.service.js';

function actor(user: AuthenticatedUser) { return { id: user.adminAccess!.profile.id }; }
@ApiTags('Public auspicious dates') @Public() @Controller('auspicious-dates')
export class AuspiciousPublicController {
  constructor(private readonly service: AuspiciousPublicService) {}
  @Get('config') config() { return this.service.config(); }
  @Post('search') search(@Body() dto: SearchDto) { return this.service.search(dto); }
  @Post('detail') detail(@Body() dto: DetailDto) { return this.service.detail(dto); }
}
@ApiTags('Admin auspicious dates') @ApiBearerAuth() @Controller('admin/auspicious-dates')
export class AuspiciousAdminController {
  constructor(private readonly service: AuspiciousAdminService, private readonly repo: AuspiciousRepository, private readonly versions: AuspiciousVersionsService, private readonly validation: ReferenceValidation) {}
  @Get('overview') @Permissions('auspicious_date.read') overview() { return this.service.overview(); }
  @Get('settings') @Permissions('auspicious_date.read') settings() { return this.repo.settings(); }
  @Put('settings') @Permissions('auspicious_date.settings.update') saveSettings(@Body() dto: SettingsDto, @CurrentUser() user: AuthenticatedUser) { return this.service.saveSettings(dto, actor(user)); }
  @Get('versions') @Permissions('auspicious_date.read') list() { return this.versions.list(); }
  @Post('versions') @Permissions('auspicious_date.versions.manage') create(@Body() dto: VersionDto, @CurrentUser() user: AuthenticatedUser) { return this.versions.create(dto, actor(user)); }
  @Get('versions/:id') @Permissions('auspicious_date.rules.read') snapshot(@Param('id', ParseUUIDPipe) id: string) { return this.repo.snapshot(id); }
  @Post('versions/:id/clone') @Permissions('auspicious_date.versions.manage') clone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VersionDto, @CurrentUser() user: AuthenticatedUser) { return this.versions.create(dto, actor(user), id); }
  @Post('versions/:id/review') @Permissions('auspicious_date.versions.manage') review(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @CurrentUser() user: AuthenticatedUser) { return this.versions.review(id, dto, actor(user)); }
  @Post('versions/:id/validate') @Permissions('auspicious_date.versions.manage') validate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @CurrentUser() user: AuthenticatedUser) { return this.versions.validate(id, dto, actor(user)); }
  @Post('versions/:id/publish') @Permissions('auspicious_date.publish') publish(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto, @CurrentUser() user: AuthenticatedUser) { return this.versions.publish(id, dto, actor(user)); }
  @Post('versions/:id/archive') @Permissions('auspicious_date.publish') archive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @CurrentUser() user: AuthenticatedUser) { return this.versions.archive(id, dto, actor(user)); }
  @Patch('rules/:id') @Permissions('auspicious_date.rules.update') rule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RuleDto, @CurrentUser() user: AuthenticatedUser) { return this.service.updateRule(id, dto, actor(user)); }
  @Put('rules/:id/content') @Permissions('auspicious_date.content.update') content(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ContentDto, @CurrentUser() user: AuthenticatedUser) { return this.service.saveContent(id, dto, actor(user)); }
  @Post('rules/:id/sources') @Permissions('auspicious_date.sources.manage') newSource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SourceDto, @CurrentUser() user: AuthenticatedUser) { return this.service.source(id, null, dto, actor(user)); }
  @Put('sources/:id') @Permissions('auspicious_date.sources.manage') source(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SourceDto, @CurrentUser() user: AuthenticatedUser) { return this.service.source('', id, dto, actor(user)); }
  @Delete('sources/:id') @Permissions('auspicious_date.sources.manage') deleteSource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @CurrentUser() user: AuthenticatedUser) { return this.service.source('', id, dto, actor(user), true); }
  @Post('simulate') @Permissions('auspicious_date.simulate') simulate(@Body() dto: SimulateDto) { return this.service.simulate(dto); }
  @Get('versions/:id/cases') @Permissions('auspicious_date.rules.read') async cases(@Param('id', ParseUUIDPipe) id: string) { return (await this.repo.snapshot(id)).cases; }
  @Post('versions/:id/cases') @Permissions('auspicious_date.versions.manage') newCase(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CaseDto, @CurrentUser() user: AuthenticatedUser) { return this.service.reference(id, null, dto, actor(user)); }
  @Put('cases/:id') @Permissions('auspicious_date.versions.manage') updateCase(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CaseDto, @CurrentUser() user: AuthenticatedUser) { return this.service.reference('', id, dto, actor(user)); }
  @Delete('cases/:id') @Permissions('auspicious_date.versions.manage') deleteCase(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @CurrentUser() user: AuthenticatedUser) { return this.service.reference('', id, dto, actor(user), true); }
  @Post('versions/:id/regression') @Permissions('auspicious_date.simulate') async regression(@Param('id', ParseUUIDPipe) id: string) { return this.validation.run(await this.repo.snapshot(id), false); }
  @Get('audit') @Permissions('auspicious_date.audit.read') audit(@Query() query: AuditQuery) { return this.service.audit(query); }
}
