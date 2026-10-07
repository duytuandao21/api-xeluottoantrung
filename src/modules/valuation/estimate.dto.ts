import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import type { EstimateInput } from './estimate.types.js';

export class EstimateDto implements EstimateInput {
  @ApiProperty() @IsUUID() brandId!: string;
  @ApiProperty() @IsUUID() modelId!: string;
  @ApiProperty() @IsUUID() variantId!: string;
  @ApiProperty({ example: 2022 }) @IsInt() @Min(1886) @Max(2100) modelYear!: number;
  @ApiPropertyOptional({ example: 60000, description: 'Omit when unknown; policy-specific maximum is also enforced.' }) @IsOptional() @IsInt() @Min(0) @Max(20000000) odometerKm?: number | null;
  @ApiPropertyOptional({ example: '2022-06-10' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) manufacturingDate?: string | null;
  @ApiPropertyOptional({ example: '2022-07-10' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) registrationDate?: string | null;
  @ApiPropertyOptional({ example: 'ORIGINAL', description: 'Active option code returned by /valuation/config.' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) exteriorCondition?: string | null;
  @ApiPropertyOptional({ example: 'GOOD' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) interiorCondition?: string | null;
  @ApiPropertyOptional({ example: 'NONE' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) accidentLevel?: string | null;
  @ApiPropertyOptional({ example: 'NONE' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) floodLevel?: string | null;
  @ApiPropertyOptional({ example: 'NORMAL' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) engineCondition?: string | null;
  @ApiPropertyOptional({ example: 'NORMAL' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) transmissionCondition?: string | null;
  @ApiPropertyOptional({ example: 'FULL' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) serviceHistory?: string | null;
  @ApiPropertyOptional({ example: 1 }) @IsOptional() @IsInt() @Min(1) @Max(100) ownerCount?: number | null;
  @ApiPropertyOptional({ example: 'PERSONAL' }) @IsOptional() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) usageType?: string | null;
  @ApiPropertyOptional({ description: 'car_colors.id, not a free-text color name.' }) @IsOptional() @IsUUID() colorId?: string | null;
}
export class ModelQuery { @ApiProperty() @IsUUID() brandId!: string; }
export class VariantQuery { @ApiProperty() @IsUUID() modelId!: string; }
export class YearQuery { @ApiProperty() @IsUUID() variantId!: string; }
export class SimulateEstimateDto extends EstimateDto {
  @ApiProperty() @IsUUID() policyId!: string;
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
  @ApiPropertyOptional({ example: '2026-10-06T12:00:00+07:00', description: 'Admin-only clock override; public estimate always uses server time.' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/) @IsDateString({ strict: true }) asOf?: string;
}
