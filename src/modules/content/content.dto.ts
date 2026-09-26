import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export const contentKeyPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
export class ContentGroupQuery {
  @ApiPropertyOptional() @IsOptional() @Matches(contentKeyPattern) @MaxLength(80) group?: string;
}
export class CreateContentEntryDto {
  @ApiProperty() @Matches(contentKeyPattern) @MaxLength(80) group!: string;
  @ApiProperty() @Matches(contentKeyPattern) @MaxLength(100) key!: string;
  @ApiProperty() @IsString() @MaxLength(240) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40_000) body?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) link?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}
export class UpdateContentEntryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40_000) body?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) imageUrl?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(https:\/\/|\/)/) @MaxLength(2000) link?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}
export class UpsertSettingDto {
  @ApiProperty() @IsString() @MaxLength(20_000) value!: string;
  @ApiPropertyOptional({ enum: ['text', 'number', 'boolean', 'json', 'url'] })
  @IsOptional() @IsIn(['text', 'number', 'boolean', 'json', 'url']) valueType?: 'text' | 'number' | 'boolean' | 'json' | 'url';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string | null;
}
