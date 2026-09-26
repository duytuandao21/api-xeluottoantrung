import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ContentGroupQuery, CreateContentEntryDto, UpdateContentEntryDto, UpsertSettingDto } from './content.dto.js';
import { ContentService } from './content.service.js';

@ApiTags('Public content')
@Public()
@Controller()
export class PublicContentController {
  constructor(private readonly content: ContentService) {}
  @Get('content') @ApiOperation({ summary: 'Active content entries, optionally filtered by group' })
  list(@Query() query: ContentGroupQuery) { return this.content.entries(query.group); }
  @Get('content/:group/:key')
  detail(@Param('group') group: string, @Param('key') key: string) { return this.content.entry(group, key); }
  @Get('site-settings/:group')
  settings(@Param('group') group: string) { return this.content.settings(group); }
}

@ApiTags('Admin content')
@ApiBearerAuth()
@Controller('admin/content')
export class AdminContentController {
  constructor(private readonly content: ContentService) {}
  @Get() @Permissions('content.read')
  list(@Query() query: ContentGroupQuery) { return this.content.entries(query.group, true); }
  @Get(':group/:key') @Permissions('content.read')
  detail(@Param('group') group: string, @Param('key') key: string) { return this.content.entry(group, key, true); }
  @Post() @Permissions('content.create')
  create(@Body() dto: CreateContentEntryDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.content.createEntry(dto, auditContext(request, user));
  }
  @Patch(':group/:key') @Permissions('content.update')
  update(@Param('group') group: string, @Param('key') key: string, @Body() dto: UpdateContentEntryDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.content.updateEntry(group, key, dto, auditContext(request, user));
  }
  @Delete(':group/:key') @Permissions('content.delete') @HttpCode(204)
  delete(@Param('group') group: string, @Param('key') key: string,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.content.deleteEntry(group, key, auditContext(request, user));
  }
}

@ApiTags('Admin site settings')
@ApiBearerAuth()
@Controller('admin/site-settings')
export class AdminSettingsController {
  constructor(private readonly content: ContentService) {}
  @Get(':group') @Permissions('content.read')
  list(@Param('group') group: string) { return this.content.settings(group); }
  @Put(':group/:key') @Permissions('content.update')
  upsert(@Param('group') group: string, @Param('key') key: string, @Body() dto: UpsertSettingDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.content.upsertSetting(group, key, dto, auditContext(request, user));
  }
}
