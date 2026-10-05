import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Permissions, Public } from '../auth/auth.decorators.js';
import { CatalogService } from './catalog.service.js';
import { CreateBrandDto, CreateModelDto, ListModelsQuery, UpdateBrandDto, UpdateModelDto } from './catalog.dto.js';

@ApiTags('Public catalog')
@Public()
@Controller()
export class PublicCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('brands')
  @ApiOperation({ summary: 'Active brands ordered by public in-stock car count, descending' })
  brands() { return this.catalog.publicBrands(); }

  @Get('brands/:slug/models')
  @ApiOperation({ summary: 'Active models for a brand slug' })
  models(@Param('slug') slug: string) { return this.catalog.publicModels(slug); }
}

@ApiTags('Admin brands')
@ApiBearerAuth()
@Controller('admin/brands')
export class AdminBrandsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get() @Permissions('brand.read')
  list() { return this.catalog.adminBrands(); }

  @Get(':id') @Permissions('brand.read')
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.adminBrand(id); }

  @Post() @Permissions('brand.create')
  create(@Body() dto: CreateBrandDto) { return this.catalog.createBrand(dto); }

  @Patch(':id') @Permissions('brand.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBrandDto) { return this.catalog.updateBrand(id, dto); }

  @Delete(':id') @Permissions('brand.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.deleteBrand(id); }
}

@ApiTags('Admin models')
@ApiBearerAuth()
@Controller('admin/car-models')
export class AdminModelsController {
  constructor(private readonly catalog: CatalogService) {}

  @Get() @Permissions('model.read')
  @ApiQuery({ name: 'brandId', required: false, type: String })
  list(@Query() query: ListModelsQuery) { return this.catalog.adminModels(query.brandId); }

  @Get(':id') @Permissions('model.read')
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.adminModel(id); }

  @Post() @Permissions('model.create')
  create(@Body() dto: CreateModelDto) { return this.catalog.createModel(dto); }

  @Patch(':id') @Permissions('model.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateModelDto) { return this.catalog.updateModel(id, dto); }

  @Delete(':id') @Permissions('model.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.deleteModel(id); }
}
