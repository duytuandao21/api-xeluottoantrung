import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { AdminAccessRequired, CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CarsService } from './cars.service.js';
import { CreateCarDto, ListCarsQuery, UpdateCarDto } from './cars.dto.js';

@ApiTags('Public cars')
@Public()
@Controller('cars')
export class PublicCarsController {
  constructor(private readonly cars: CarsService) {}

  @Get()
  @ApiOperation({ summary: 'Published cars with filters and pagination' })
  list(@Query() query: ListCarsQuery) { return this.cars.list(query); }

  @Get(':slug')
  @ApiOperation({ summary: 'Published car detail by slug' })
  detail(@Param('slug') slug: string) { return this.cars.publicDetail(slug); }
}

@ApiTags('Sale cars')
@ApiBearerAuth()
@AdminAccessRequired()
@Controller('sale/cars')
export class SaleCarsController {
  constructor(private readonly cars: CarsService) {}

  @Get()
  @ApiOperation({ summary: 'Published cars searchable by name or license plate for sales staff' })
  list(@Query() query: ListCarsQuery, @CurrentUser() user: AuthenticatedUser) {
    if (!user.adminAccess?.roles.includes('SALES')) throw new ForbiddenException('Sales role required');
    return this.cars.list(query, false, true);
  }

  @Get('license-plates')
  licensePlates(@Query('slugs') slugs: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    if (!user.adminAccess?.roles.includes('SALES')) throw new ForbiddenException('Sales role required');
    return this.cars.saleLicensePlates(typeof slugs === 'string' ? slugs.split(',') : []);
  }
}

@ApiTags('Admin cars')
@ApiBearerAuth()
@Controller('admin/cars')
export class AdminCarsController {
  constructor(private readonly cars: CarsService) {}

  @Get() @Permissions('car.read')
  list(@Query() query: ListCarsQuery) { return this.cars.list(query, true); }

  @Get(':id') @Permissions('car.read')
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.cars.adminDetail(id); }

  @Post() @Permissions('car.create')
  create(@Body() dto: CreateCarDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.cars.create(dto, auditContext(request, user));
  }

  @Patch(':id') @Permissions('car.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCarDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.cars.update(id, dto, auditContext(request, user));
  }

  @Delete(':id') @Permissions('car.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.cars.delete(id, auditContext(request, user));
  }

  @Post(':id/publish') @Permissions('car.publish')
  publish(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.cars.publish(id, auditContext(request, user));
  }

  @Post(':id/unpublish') @Permissions('car.publish')
  unpublish(@Param('id', ParseUUIDPipe) id: string, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.cars.unpublish(id, auditContext(request, user));
  }
}
