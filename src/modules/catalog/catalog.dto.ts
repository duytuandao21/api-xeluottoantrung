import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateBrandDto {
  @ApiProperty({ example: 'Toyota' })
  @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional({ example: 'toyota', description: 'Generated from name when omitted' })
  @IsOptional() @Matches(slugPattern) @MaxLength(160) slug?: string;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string | null;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
}

export class UpdateBrandDto extends PartialType(CreateBrandDto) {}

export class CreateModelDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID() brandId!: string;
  @ApiProperty({ example: 'Vios' })
  @IsString() @MaxLength(120) name!: string;
  @ApiPropertyOptional({ example: 'vios', description: 'Generated from name when omitted' })
  @IsOptional() @Matches(slugPattern) @MaxLength(160) slug?: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional() @IsUUID() bodyStyleId?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string | null;
  @ApiPropertyOptional({ enum: ['active', 'inactive'] })
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @ApiPropertyOptional({ type: Number, default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) sortOrder?: number;
}

export class UpdateModelDto extends PartialType(CreateModelDto) {}

export class ListModelsQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional() @IsUUID() brandId?: string;
}
