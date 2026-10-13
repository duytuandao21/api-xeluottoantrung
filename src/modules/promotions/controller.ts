import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreatePromotionDto, PromotionQuery, TogglePromotionPopupDto, UpdatePromotionDto } from './dto.js';
import { PromotionsService } from './service.js';

@ApiTags('Promotions') @Public() @Controller('promotions')
export class PublicPromotionsController {
  constructor(private readonly service: PromotionsService) {}
  @Get() @Header('Cache-Control', 'no-store') list(@Query() query: PromotionQuery) { return this.service.list(query); }
  @Get('popup') @Header('Cache-Control', 'no-store') popup() { return this.service.popup(); }
  @Get(':id') @Header('Cache-Control', 'no-store') detail(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id); }
}
@ApiTags('Admin promotions') @ApiBearerAuth() @Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(private readonly service: PromotionsService) {}
  @Get() @Permissions('content.read') list(@Query() query: PromotionQuery) { return this.service.list(query, true); }
  @Get(':id') @Permissions('content.read') detail(@Param('id', ParseUUIDPipe) id: string) { return this.service.detail(id, true); }
  @Post() @Permissions('content.create') create(@Body() dto: CreatePromotionDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(dto, auditContext(request, user));
  }
  @Patch(':id') @Permissions('content.update') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePromotionDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.update(id, dto, auditContext(request, user)); }
  @Patch(':id/popup') @Permissions('content.update') toggle(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TogglePromotionPopupDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.togglePopup(id, dto.enabled, auditContext(request, user)); }
  @Delete(':id') @Permissions('content.delete') @HttpCode(204) delete(@Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) { return this.service.delete(id, auditContext(request, user)); }
}
