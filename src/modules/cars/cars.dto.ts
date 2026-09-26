import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const statusValues = ['active', 'deposit', 'sold', 'inactive'] as const;
const sortValues = ['newest', 'oldest', 'price_asc', 'price_desc', 'year_desc', 'mileage_asc'] as const;

export class ListCarsQuery {
  @ApiPropertyOptional({ description: 'Search car name; admin also searches SKU' })
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ description: 'Brand slug' })
  @IsOptional() @IsString() @MaxLength(160) brand?: string;
  @ApiPropertyOptional({ description: 'Model slug' })
  @IsOptional() @IsString() @MaxLength(160) model?: string;
  @ApiPropertyOptional({ description: 'Version slug' })
  @IsOptional() @IsString() @MaxLength(160) version?: string;
  @ApiPropertyOptional({ type: Number })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1886) @Max(2100) year_from?: number;
  @ApiPropertyOptional({ type: Number })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1886) @Max(2100) year_to?: number;
  @ApiPropertyOptional({ type: Number, description: 'VND' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) price_min?: number;
  @ApiPropertyOptional({ type: Number, description: 'VND' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) price_max?: number;
  @ApiPropertyOptional({ description: 'Body style slug' })
  @IsOptional() @IsString() @MaxLength(160) body_type?: string;
  @ApiPropertyOptional({ description: 'Fuel value' })
  @IsOptional() @IsString() @MaxLength(100) fuel_type?: string;
  @ApiPropertyOptional({ description: 'Transmission slug' })
  @IsOptional() @IsString() @MaxLength(160) transmission?: string;
  @ApiPropertyOptional({ description: 'Color slug' })
  @IsOptional() @IsString() @MaxLength(160) color?: string;
  @ApiPropertyOptional({ description: 'Branch slug' })
  @IsOptional() @IsString() @MaxLength(160) branch?: string;
  @ApiPropertyOptional({ type: Number })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) mileage_min?: number;
  @ApiPropertyOptional({ type: Number })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) mileage_max?: number;
  @ApiPropertyOptional({ enum: statusValues })
  @IsOptional() @IsIn(statusValues) status?: typeof statusValues[number];
  @ApiPropertyOptional({ enum: ['true', 'false'], description: 'Only featured or non-featured cars' })
  @IsOptional() @IsIn(['true', 'false']) featured?: 'true' | 'false';
  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100_000) page = 1;
  @ApiPropertyOptional({ type: Number, default: 20, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional({ enum: sortValues, default: 'newest' })
  @IsOptional() @IsIn(sortValues) sort: typeof sortValues[number] = 'newest';
}

export class CreateCarDto {
  @ApiProperty({ example: 'Toyota Vios 2022' })
  @IsString() @MaxLength(240) name!: string;
  @ApiPropertyOptional({ description: 'Generated from name when omitted; stable on name changes' })
  @IsOptional() @Matches(slugPattern) @MaxLength(240) slug?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(100) sku?: string | null;
  @ApiProperty({ format: 'uuid' })
  @IsUUID() brandId!: string;
  @ApiProperty({ format: 'uuid' })
  @IsUUID() modelId!: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional() @IsUUID() versionId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional() @IsUUID() bodyStyleId?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional() @IsUUID() branchId?: string | null;
  @ApiProperty({ type: Number, minimum: 1886, maximum: 2100 })
  @Type(() => Number) @IsInt() @Min(1886) @Max(2100) year!: number;
  @ApiProperty({ type: Number, minimum: 0, description: 'VND' })
  @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) price!: number;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'VND' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) originalPrice?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) mileage?: number | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional() @IsUUID() transmissionId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(100) fuel?: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional() @IsUUID() colorId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(40) licensePlate?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(100) condition?: string | null;
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) seatCount?: number | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(20_000) description?: string | null;
  @ApiPropertyOptional({ enum: statusValues, default: 'inactive' })
  @IsOptional() @IsIn(statusValues) status?: typeof statusValues[number];
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional() @IsBoolean() featured?: boolean;
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional() @IsBoolean() installment?: boolean;
  @ApiPropertyOptional({ type: Boolean, default: false })
  @IsOptional() @IsBoolean() newArrival?: boolean;
}

export class UpdateCarDto extends PartialType(CreateCarDto) {}
