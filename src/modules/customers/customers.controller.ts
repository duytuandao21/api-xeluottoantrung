import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CreateCustomerDto, CustomerQuery, UpdateCustomerDto } from './customers.dto.js';
import { CustomersService } from './customers.service.js';

@ApiTags('Admin customers') @ApiBearerAuth() @Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}
  @Get() @Permissions('customer.read') list(@Query() query: CustomerQuery) { return this.customers.list(query); }
  @Get(':id') @Permissions('customer.read') detail(@Param('id', ParseUUIDPipe) id: string) { return this.customers.detail(id); }
  @Post() @Permissions('customer.create') create(@Body() dto: CreateCustomerDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.customers.create(dto, auditContext(request, user));
  }
  @Patch(':id') @Permissions('customer.update') update(@Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.customers.update(id, dto, auditContext(request, user));
  }
  @Delete(':id') @Permissions('customer.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.customers.delete(id, auditContext(request, user));
  }
}
