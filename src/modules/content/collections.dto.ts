import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const collectionNames = ['articles', 'article-categories', 'pages', 'faqs', 'testimonials', 'services', 'recruitments', 'slides'] as const;
export type CollectionName = typeof collectionNames[number];

export class CollectionQuery {
  @ApiPropertyOptional({ type: Number, default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ type: Number, default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['active', 'inactive', 'draft', 'published']) status?: string;
}

// A shared payload covers the fields used by the existing admin content forms.
// CollectionService checks required fields and allowed fields for each collection.
export class CollectionPayloadDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(180) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(240) slug?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\/(?:[a-z0-9-]+\/?)*$/) @MaxLength(300) path?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) question?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20_000) answer?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40_000) content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20_000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10_000) requirements?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) excerpt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) authorName?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) avatarUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) link?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) icon?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) carBought?: string | null;
  @ApiPropertyOptional({ example: '2026-09-28', description: 'Ngày mua xe, định dạng YYYY-MM-DD' })
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) purchaseDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) salary?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) deadline?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() featured?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['active', 'inactive', 'draft', 'published']) status?: string;
}
