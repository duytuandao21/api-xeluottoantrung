import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const lookupNames = ['car-versions', 'body-styles', 'transmissions', 'car-colors', 'branch-regions', 'branches', 'filter-options'] as const;
export type LookupName = typeof lookupNames[number];
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export class LookupQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(slugPattern) @MaxLength(80) group?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() modelId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() regionId?: string;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] }) @IsOptional() @IsIn(['active', 'inactive']) status?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}
export class LookupPayloadDto {
  @ApiProperty() @IsOptional() @IsString() @MaxLength(180) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(slugPattern) @MaxLength(180) slug?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(slugPattern) @MaxLength(80) group?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() modelId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() regionId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^https:\/\//) @MaxLength(2000) mapUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) colorCode?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) minValue?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) maxValue?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}
