import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateLeadDto, LeadQuery, NewsletterDto, NewsletterQuery, UpdateLeadDto, UpdateNewsletterDto } from './leads.dto.js';
import { LeadsService } from './leads.service.js';

@ApiTags('Public enquiries') @Public() @Controller()
export class PublicLeadsController {
  constructor(private readonly leads: LeadsService) {}
  @Post('leads') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit sell, trade-in, callback, or finance enquiry' })
  create(@Body() dto: CreateLeadDto) { return this.leads.create(dto); }
  @Post('newsletter-subscriptions') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  subscribe(@Body() dto: NewsletterDto) { return this.leads.subscribe(dto); }
}

@ApiTags('Admin leads') @ApiBearerAuth() @Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly leads: LeadsService) {}
  @Get() @Permissions('lead.read') list(@Query() query: LeadQuery) { return this.leads.list(query); }
  @Get(':id') @Permissions('lead.read') detail(@Param('id', ParseUUIDPipe) id: string) { return this.leads.detail(id); }
  @Patch(':id') @Permissions('lead.update') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.update(id, dto, auditContext(request, user));
  }
  @Delete(':id') @Permissions('lead.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.delete(id, auditContext(request, user));
  }
}

@ApiTags('Admin newsletter') @ApiBearerAuth() @Controller('admin/newsletter-subscribers')
export class AdminNewsletterController {
  constructor(private readonly leads: LeadsService) {}
  @Get() @Permissions('lead.read') list(@Query() query: NewsletterQuery) { return this.leads.subscribers(query); }
  @Get('export') @Permissions('lead.read') @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"')
  export() { return this.leads.exportSubscribers(); }
  @Patch(':id') @Permissions('lead.update') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNewsletterDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.updateSubscriber(id, dto, auditContext(request, user));
  }
  @Delete(':id') @Permissions('lead.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.leads.deleteSubscriber(id, auditContext(request, user));
  }
}
