import { Body, Controller, Delete, Get, HttpCode, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { SeoRouteQuery, UpsertSeoDto } from './seo.dto.js';
import { SeoService } from './seo.service.js';

@ApiTags('Public SEO') @Public() @Controller('seo')
export class PublicSeoController {
  constructor(private readonly seo: SeoService) {}
  @Get() detail(@Query() query: SeoRouteQuery) { return this.seo.byRoute(query.route); }
}

@ApiTags('Admin SEO') @ApiBearerAuth() @Controller('admin/seo')
export class AdminSeoController {
  constructor(private readonly seo: SeoService) {}
  @Get() @Permissions('seo.read') list() { return this.seo.list(); }
  @Get('by-route') @Permissions('seo.read') detail(@Query() query: SeoRouteQuery) { return this.seo.byRoute(query.route); }
  @Put() @Permissions('seo.update') upsert(@Body() dto: UpsertSeoDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.seo.upsert(dto, auditContext(request, user));
  }
  @Delete() @Permissions('seo.update') @HttpCode(204) delete(@Query() query: SeoRouteQuery,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.seo.delete(query.route, auditContext(request, user));
  }
}
