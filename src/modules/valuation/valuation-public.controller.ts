import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/auth.decorators.js';
import { EstimateDto, ModelQuery, VariantQuery, YearQuery } from './estimate.dto.js';
import { ValuationEstimateService } from './estimate.service.js';
import { CatalogResponse, EstimateResponse, ValuationConfigResponse } from './estimate.response.js';
import { ValuationContactDto } from './history.dto.js';
import { ValuationHistoryService } from './history.service.js';

@ApiTags('Public used car valuation') @Public() @Controller('valuation')
@ApiServiceUnavailableResponse({ description: 'Feature disabled, published policy unavailable, or configuration invalid.' })
@ApiTooManyRequestsResponse({ description: 'Rate limit exceeded.' })
export class ValuationPublicController {
  constructor(private readonly service: ValuationEstimateService, private readonly history: ValuationHistoryService) {}
  @Post('records/:id/lead') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Submit an optional sell enquiry bound to a saved estimate. Requires its capability token and explicit contact consent; idempotent for retries.' })
  @ApiOkResponse({ schema: { type: 'object', properties: { accepted: { type: 'boolean' } } } }) @ApiBadRequestResponse({ description: 'Invalid contact or consent.' })
  contact(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ValuationContactDto) { return this.history.contact(id, dto); }
  @Get('config') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: 'Public availability, input choices and limits; never draft rules or internal percentages.' }) @ApiOkResponse({ type: ValuationConfigResponse })
  config() { return this.service.config(); }
  @Get('brands') @Header('Cache-Control', 'no-store') @ApiOperation({ summary: 'Active brands with effective reference prices in the published policy.' }) @ApiOkResponse({ type: CatalogResponse })
  brands() { return this.service.catalog('brands'); }
  @Get('models') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CatalogResponse }) @ApiBadRequestResponse({ description: 'brandId must be a UUID.' }) @ApiOperation({ summary: 'Supported models for brandId.' })
  models(@Query() dto: ModelQuery) { return this.service.catalog('models', dto.brandId); }
  @Get('variants') @Header('Cache-Control', 'no-store') @ApiOkResponse({ type: CatalogResponse }) @ApiBadRequestResponse({ description: 'modelId must be a UUID.' }) @ApiOperation({ summary: 'Supported variants for modelId.' })
  variants(@Query() dto: VariantQuery) { return this.service.catalog('variants', dto.modelId); }
  @Get('years') @Header('Cache-Control', 'no-store') @ApiBadRequestResponse({ description: 'variantId must be a UUID.' }) @ApiOperation({ summary: 'Supported model years in descending order for variantId.' })
  @ApiOkResponse({ schema: { type: 'object', properties: { policyVersion: { type: 'string' }, data: { type: 'array', items: { type: 'integer' } } } } })
  years(@Query() dto: YearQuery) { return this.service.catalog('years', dto.variantId); }
  @Post('estimate') @HttpCode(200) @Header('Cache-Control', 'no-store') @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Deterministic reference ranges using server time and the published policy. Saves an immutable history snapshot; contact is optional afterwards.' })
  @ApiOkResponse({ type: EstimateResponse }) @ApiBadRequestResponse({ description: 'Invalid vehicle/input/condition/date or policy limit exceeded.' })
  estimate(@Body() dto: EstimateDto) { return this.service.estimate(dto); }
}
