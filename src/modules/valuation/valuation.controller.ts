import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { CurrentUser, Permissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { auditContext } from '../../common/audit.js';
import { ChangeDto, CreatePolicyDto, CurrentConfigDto, CurrentListQuery, CurrentOptionDto, CurrentReferenceDto, CurrentRuleDto, ListQuery, OptionDto, PublishDto, ReferenceDto, RuleDto, SettingsDto, UpdatePolicyDto } from './valuation.dto.js';
import { ValuationAdminService } from './valuation.service.js';
import { ValuationEstimateService } from './estimate.service.js';
import { SimulateEstimateDto } from './estimate.dto.js';
import { SimulationResponse } from './estimate.response.js';
import { HistoryQuery, HistoryStatusDto } from './history.dto.js';
import { ValuationHistoryService } from './history.service.js';

@ApiTags('Admin used car valuation') @ApiBearerAuth() @Controller('admin/valuation')
export class ValuationAdminController {
  constructor(private readonly service: ValuationAdminService, private readonly estimates: ValuationEstimateService, private readonly history: ValuationHistoryService) {}
  @Get('current') @Permissions('valuation.read') @ApiOperation({ summary: 'The single current valuation configuration, options and availability; no version selection.' })
  current() { return this.service.current(); }
  @Patch('current/config') @Permissions('valuation.settings.update') @ApiOperation({ summary: 'Save and apply current configuration immediately; invalid changes roll back while public is enabled.' })
  currentConfig(@Body() dto: CurrentConfigDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentConfig(dto, auditContext(req, user)); }
  @Put('current/settings') @Permissions('valuation.settings.update')
  currentSettings(@Body() dto: SettingsDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentSettings(dto, auditContext(req, user)); }
  @Get('current/reference-prices') @Permissions('valuation.read')
  currentReferences(@Query() dto: CurrentListQuery) { return this.service.currentList('reference', dto); }
  @Post('current/reference-prices') @Permissions('valuation.reference_prices.manage')
  currentCreateReference(@Body() dto: CurrentReferenceDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentReference(null, dto, auditContext(req, user)); }
  @Patch('current/reference-prices/:id') @Permissions('valuation.reference_prices.manage')
  currentUpdateReference(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CurrentReferenceDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentReference(id, dto, auditContext(req, user)); }
  @Delete('current/reference-prices/:id') @HttpCode(204) @Permissions('valuation.reference_prices.manage')
  currentDeleteReference(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentRemove('reference', id, dto, auditContext(req, user)); }
  @Get('current/rules') @Permissions('valuation.read')
  currentRules(@Query() dto: CurrentListQuery) { return this.service.currentList('rule', dto); }
  @Post('current/rules') @Permissions('valuation.rules.manage')
  currentCreateRule(@Body() dto: CurrentRuleDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentRule(null, dto, auditContext(req, user)); }
  @Patch('current/rules/:id') @Permissions('valuation.rules.manage')
  currentUpdateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CurrentRuleDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentRule(id, dto, auditContext(req, user)); }
  @Delete('current/rules/:id') @HttpCode(204) @Permissions('valuation.rules.manage')
  currentDeleteRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentRemove('rule', id, dto, auditContext(req, user)); }
  @Get('current/options') @Permissions('valuation.read')
  currentOptions(@Query() dto: CurrentListQuery) { return this.service.currentList('option', dto); }
  @Post('current/options') @Permissions('valuation.rules.manage')
  currentCreateOption(@Body() dto: CurrentOptionDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentOption(null, dto, auditContext(req, user)); }
  @Patch('current/options/:id') @Permissions('valuation.rules.manage')
  currentUpdateOption(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CurrentOptionDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentOption(id, dto, auditContext(req, user)); }
  @Delete('current/options/:id') @HttpCode(204) @Permissions('valuation.rules.manage')
  currentDeleteOption(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.currentRemove('option', id, dto, auditContext(req, user)); }
  @Get('records') @Permissions('valuation.history.read') @ApiOperation({ summary: 'Saved valuation history and optional contacts; filter dates are inclusive Asia/Ho_Chi_Minh dates, price range is estimated market value in VND.' })
  records(@Query() dto: HistoryQuery) { return this.history.list(dto); }
  @Get('records/:id') @Permissions('valuation.history.read') @ApiOperation({ summary: 'Immutable input/rules/result snapshot and linked sell enquiry; never returns the public capability hash.' })
  record(@Param('id', ParseUUIDPipe) id: string) { return this.history.detail(id); }
  @Patch('records/:id/status') @Permissions('valuation.history.read', 'valuation.history.update') @ApiOperation({ summary: 'Update contact workflow with optimistic concurrency and audit; snapshot is never recalculated or modified.' })
  recordStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: HistoryStatusDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.history.status(id, dto, auditContext(request, user)); }
  @Post('simulate') @HttpCode(200) @Permissions('valuation.simulate') @ApiOperation({ summary: 'Read-only simulation of a specific draft/published policy and revision, including internal breakdown.' }) @ApiOkResponse({ type: SimulationResponse }) @ApiConflictResponse({ description: 'Policy revision changed.' })
  simulate(@Body() dto: SimulateEstimateDto) { return this.estimates.simulate(dto); }
  @ApiExcludeEndpoint() @Get('overview') @Permissions('valuation.read') @ApiOperation({ summary: 'Master data overview, policy versions and current public availability' }) overview() { return this.service.overview(); }
  @Get('catalog') @Permissions('valuation.read') catalog() { return this.service.catalog(); }
  @ApiExcludeEndpoint() @Get('settings') @Permissions('valuation.read') settings() { return this.service.repo.settings(); }
  @ApiExcludeEndpoint() @Put('settings') @Permissions('valuation.settings.update') @ApiOperation({ summary: 'Update availability and public copy. Switching on also requires publish permission, confirmed review, and valid current published data.' }) updateSettings(@Body() dto: SettingsDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.settings(dto, auditContext(request, user), user.adminAccess?.permissions.includes('valuation.publish') ?? false); }
  @ApiExcludeEndpoint() @Get('policies') @Permissions('valuation.read') async policies() { return (await this.service.overview()).policies; }
  @ApiExcludeEndpoint() @Get('policies/:id') @Permissions('valuation.read') policy(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id); }
  @ApiExcludeEndpoint() @Post('policies') @Permissions('valuation.policies.manage') create(@Body() dto: CreatePolicyDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.createPolicy(dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Patch('policies/:id') @Permissions('valuation.settings.update') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePolicyDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.updatePolicy(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Post('policies/:id/clone') @Permissions('valuation.policies.manage') clone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePolicyDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.createPolicy(dto, auditContext(request, user), id); }
  @ApiExcludeEndpoint() @Post('policies/:id/validate') @Permissions('valuation.policies.manage') validate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.validate(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Post('policies/:id/publish') @Permissions('valuation.publish') publish(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.publish(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Post('policies/:id/archive') @Permissions('valuation.publish') archive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.archive(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Get('reference-prices') @Permissions('valuation.read') references(@Query() query: ListQuery) { return this.service.references(query); }
  @ApiExcludeEndpoint() @Post('reference-prices') @Permissions('valuation.reference_prices.manage') createReference(@Body() dto: ReferenceDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.saveReference(null, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Patch('reference-prices/:id') @Permissions('valuation.reference_prices.manage') updateReference(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReferenceDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.saveReference(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Delete('reference-prices/:id') @Permissions('valuation.reference_prices.manage') @HttpCode(204) removeReference(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.remove('reference', id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Get('rules') @Permissions('valuation.read') rules(@Query() query: ListQuery) { return this.service.rules(query); }
  @ApiExcludeEndpoint() @Post('rules') @Permissions('valuation.rules.manage') createRule(@Body() dto: RuleDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.saveRule(null, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Patch('rules/:id') @Permissions('valuation.rules.manage') updateRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RuleDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.saveRule(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Delete('rules/:id') @Permissions('valuation.rules.manage') @HttpCode(204) removeRule(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.remove('rule', id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Get('options') @Permissions('valuation.read') options(@Query() query: ListQuery) { return this.service.options(query); }
  @ApiExcludeEndpoint() @Post('options') @Permissions('valuation.rules.manage') createOption(@Body() dto: OptionDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.saveOption(null, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Patch('options/:id') @Permissions('valuation.rules.manage') updateOption(@Param('id', ParseUUIDPipe) id: string, @Body() dto: OptionDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.saveOption(id, dto, auditContext(request, user)); }
  @ApiExcludeEndpoint() @Delete('options/:id') @Permissions('valuation.rules.manage') @HttpCode(204) removeOption(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ChangeDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.remove('option', id, dto, auditContext(request, user)); }
  @Get('audit') @Permissions('valuation.audit.read') audit(@Query() query: ListQuery) { return this.service.audit(query); }
}
