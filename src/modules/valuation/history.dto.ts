import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ReasonDto } from './valuation.dto.js';
import { VALUATION_LEAD_STATUSES, type ValuationLeadStatus } from './history.types.js';
export class ValuationContactDto {
  @ApiProperty({ description: 'Capability issued with the estimate; never put in URLs.' }) @Matches(/^[A-Za-z0-9_-]{43}$/) leadToken!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(160) @Matches(/\S/) name?: string;
  @ApiProperty() @IsString() @Matches(/^[+0-9()\s.-]{9,24}$/) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @ApiProperty({ description: 'Explicit consent to contact for this enquiry.' }) @IsIn([true]) consent!: true;
}
export class HistoryQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() modelId?: string;
  @ApiPropertyOptional({ example: '2026-10-06', description: 'Inclusive Vietnamese calendar date.' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;
  @ApiPropertyOptional({ example: '2026-10-06' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;
  @ApiPropertyOptional({ enum: [...VALUATION_LEAD_STATUSES, 'NONE'] }) @IsOptional() @IsIn([...VALUATION_LEAD_STATUSES, 'NONE']) leadStatus?: ValuationLeadStatus | 'NONE';
  @ApiPropertyOptional({ description: 'Estimated market value in VND; records with no estimate do not match.' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) priceMin?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) priceMax?: number;
}
export class HistoryStatusDto extends ReasonDto {
  @ApiProperty({ enum: VALUATION_LEAD_STATUSES }) @IsIn(VALUATION_LEAD_STATUSES) leadStatus!: ValuationLeadStatus;
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
}
