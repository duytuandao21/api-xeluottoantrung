import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const routePattern = /^\/(?:[a-z0-9-]+\/?)*$/;
export class SeoRouteQuery {
  @ApiProperty({ example: '/tin-tuc' }) @Matches(routePattern) @MaxLength(300) route!: string;
}
export class UpsertSeoDto {
  @ApiProperty({ example: '/tin-tuc' }) @Matches(routePattern) @MaxLength(300) routePath!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) metaTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) metaDescription?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) keywords?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) ogTitle?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) ogDescription?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) ogImageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^https:\/\//) @MaxLength(2000) canonicalUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() robotsIndex?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() robotsFollow?: boolean;
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() structuredData?: Record<string, unknown> | null;
}
