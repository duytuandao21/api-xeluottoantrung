import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { LookupPayloadDto, LookupQuery } from './lookups.dto.js';
import { LookupPermissionsGuard } from './lookups.guard.js';
import { LookupsService } from './lookups.service.js';

@ApiTags('Public lookups') @Public() @Controller()
export class PublicLookupsController {
  constructor(private readonly lookups: LookupsService) {}
  @Get('lookups/:resource') @ApiOperation({ summary: 'Active versions, body styles, transmissions, colors, regions, branches or filter options' })
  list(@Param('resource') resource: string, @Query() query: LookupQuery) { return this.lookups.list(resource, query, true); }
  @Get('branches') branches(@Query() query: LookupQuery) { return this.lookups.list('branches', query, true); }
  @Get('branches/:slug') branch(@Param('slug') slug: string) { return this.lookups.detail('branches', slug, true, true); }
}

@ApiTags('Admin lookups') @ApiBearerAuth() @UseGuards(LookupPermissionsGuard) @Controller('admin/lookups/:resource')
export class AdminLookupsController {
  constructor(private readonly lookups: LookupsService) {}
  @Get() list(@Param('resource') resource: string, @Query() query: LookupQuery) { return this.lookups.list(resource, query, false); }
  @Get(':id') detail(@Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.lookups.detail(resource, id, false);
  }
  @Post() create(@Param('resource') resource: string, @Body() dto: LookupPayloadDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.lookups.create(resource, dto, auditContext(request, user));
  }
  @Patch(':id') update(@Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LookupPayloadDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.lookups.update(resource, id, dto, auditContext(request, user));
  }
  @Delete(':id') @HttpCode(204) delete(@Param('resource') resource: string, @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.lookups.delete(resource, id, auditContext(request, user));
  }
}
