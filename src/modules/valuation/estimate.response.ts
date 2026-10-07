import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PriceRangeResponse {
  @ApiProperty({ example: 710000000 }) min!: number;
  @ApiProperty({ example: 740000000 }) max!: number;
}
export class EstimateResponse {
  @ApiPropertyOptional({ format: 'uuid', description: 'Public estimate record. Not issued by read-only Admin simulation.' }) recordId?: string;
  @ApiPropertyOptional({ description: 'Temporary capability for contact submission. Never put in URLs or logs.' }) leadToken?: string;
  @ApiPropertyOptional({ format: 'date-time' }) leadTokenExpiresAt?: string;
  @ApiProperty({ enum: ['ESTIMATED', 'MANUAL_INSPECTION', 'MISSING_REFERENCE', 'INSUFFICIENT_DATA'] }) status!: string;
  @ApiProperty() policyVersion!: string;
  @ApiProperty({ format: 'date-time' }) calculatedAt!: string;
  @ApiProperty({ type: 'object', properties: { brandId: { type: 'string', format: 'uuid' }, brandName: { type: 'string' }, modelId: { type: 'string', format: 'uuid' }, modelName: { type: 'string' }, variantId: { type: 'string', format: 'uuid' }, variantName: { type: 'string' }, modelYear: { type: 'integer' } } }) vehicle!: object;
  @ApiProperty({ type: Number, nullable: true, description: 'Selected reference price in VND, not a guaranteed sale price.' }) referencePrice!: number | null;
  @ApiProperty({ enum: ['ORIGINAL_MSRP', 'CURRENT_MSRP', 'MARKET_REFERENCE'], nullable: true }) referenceType!: string | null;
  @ApiProperty({ type: PriceRangeResponse, nullable: true }) marketRange!: PriceRangeResponse | null;
  @ApiProperty({ type: PriceRangeResponse, nullable: true }) dealerBuyingRange!: PriceRangeResponse | null;
  @ApiProperty({ minimum: 0, maximum: 100, description: 'Weighted data completeness, not a probability of price accuracy.' }) confidenceScore!: number;
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH'] }) confidenceLevel!: string;
  @ApiProperty({ type: [String] }) missingFields!: string[];
  @ApiProperty() manualInspectionRequired!: boolean;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } }) reasons!: object[];
  @ApiProperty({ type: 'array', maxItems: 5, items: { type: 'object', properties: { type: { type: 'string' }, label: { type: 'string' }, direction: { type: 'string', enum: ['INCREASE', 'DECREASE'] } } } }) summaryFactors!: object[];
  @ApiProperty() disclaimer!: string;
  @ApiProperty() ctaLabel!: string;
}
export class SimulationResponse extends EstimateResponse {
  @ApiProperty() policyId!: string;
  @ApiProperty() policyRevision!: number;
  @ApiProperty({ enum: ['DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED'] }) policyStatus!: string;
  @ApiProperty() simulated!: boolean;
  @ApiProperty() ageYears!: number;
  @ApiProperty({ enum: ['MANUFACTURING_DATE', 'REGISTRATION_DATE', 'MODEL_YEAR'] }) ageSource!: string;
  @ApiProperty() expectedOdometerKm!: number;
  @ApiProperty({ type: Number, nullable: true }) odometerDeviationPercent!: number | null;
  @ApiProperty({ type: String, nullable: true }) referenceId!: string | null;
  @ApiProperty({ type: Number, nullable: true }) estimatedMarketValue!: number | null;
  @ApiProperty({ type: PriceRangeResponse, nullable: true, description: 'Internal candidate only; not necessarily shown to customers.' }) candidateMarketRange!: PriceRangeResponse | null;
  @ApiProperty({ type: PriceRangeResponse, nullable: true }) candidateDealerBuyingRange!: PriceRangeResponse | null;
  @ApiProperty({ type: 'object', nullable: true, properties: { ageYears: { type: 'number' }, odometerKm: { type: 'number' }, ageFactor: { type: 'number' }, odoFactor: { type: 'number' }, note: { type: 'string' } } }) referenceBasis!: object | null;
  @ApiProperty({ type: 'object', nullable: true, properties: { before: { type: 'number' }, after: { type: 'number' }, min: { type: 'number' }, max: { type: 'number' }, applied: { type: 'boolean' } } }) cap!: object | null;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, label: { type: 'string' }, ruleId: { type: 'string', nullable: true }, scope: { type: 'string', nullable: true }, configuredPercentage: { type: 'number' }, percentage: { type: 'number' }, factor: { type: 'number' }, before: { type: 'number' }, after: { type: 'number' }, manualInspectionRequired: { type: 'boolean' }, fallback: { type: 'boolean' } } } }) adjustments!: object[];
}
export class ValuationConfigResponse {
  @ApiProperty() enabled!: boolean;
  @ApiProperty() disclaimer!: string;
  @ApiProperty() ctaLabel!: string;
  @ApiPropertyOptional() policyVersion?: string;
  @ApiPropertyOptional({ description: 'Opaque current configuration key for refreshing catalog caches after edits.' }) configurationKey?: string;
  @ApiPropertyOptional({ type: 'object', properties: { minModelYear: { type: 'integer' }, maxModelYear: { type: 'integer' }, maxVehicleAge: { type: 'integer' }, maxOdometerKm: { type: 'integer' } } }) limits?: object;
  @ApiPropertyOptional({ type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, category: { type: 'string' }, code: { type: 'string' }, label: { type: 'string' }, isUnknown: { type: 'boolean' } } } }) conditionOptions?: object[];
  @ApiPropertyOptional({ type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, colorCode: { type: 'string', nullable: true } } } }) colors?: object[];
}
export class CatalogResponse {
  @ApiProperty() policyVersion!: string;
  @ApiPropertyOptional() configurationKey?: string;
  @ApiProperty({ type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, imageUrl: { type: 'string', nullable: true }, brandId: { type: 'string', format: 'uuid' }, modelId: { type: 'string', format: 'uuid' } }, required: ['id', 'name', 'imageUrl'] } }) data!: object[];
}
