import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const mediaMimeTypes = {
  'image/jpeg': { type: 'image', extension: 'jpg', maxBytes: 10_000_000 },
  'image/png': { type: 'image', extension: 'png', maxBytes: 10_000_000 },
  'image/webp': { type: 'image', extension: 'webp', maxBytes: 10_000_000 },
  'image/avif': { type: 'image', extension: 'avif', maxBytes: 10_000_000 },
  'video/mp4': { type: 'video', extension: 'mp4', maxBytes: 100_000_000 },
  'video/webm': { type: 'video', extension: 'webm', maxBytes: 100_000_000 },
} as const;
export type MediaMimeType = keyof typeof mediaMimeTypes;
export const allowedMimeTypes = Object.keys(mediaMimeTypes);

export class PresignMediaDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() carId!: string;
  @ApiProperty({ enum: ['image', 'video'] }) @IsIn(['image', 'video']) type!: 'image' | 'video';
  @ApiProperty({ enum: allowedMimeTypes }) @IsIn(allowedMimeTypes) mimeType!: MediaMimeType;
  @ApiProperty({ minimum: 1, maximum: 100_000_000 }) @IsInt() @Min(1) @Max(100_000_000) sizeBytes!: number;
}

export class PresignAssetDto {
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/vnd.microsoft.icon', 'image/x-icon'] })
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/vnd.microsoft.icon', 'image/x-icon']) mimeType!: MediaMimeType | 'image/vnd.microsoft.icon' | 'image/x-icon';
  @ApiProperty({ minimum: 1, maximum: 10_000_000 })
  @IsInt() @Min(1) @Max(10_000_000) sizeBytes!: number;
}

export class AddMediaDto {
  @ApiProperty({ example: 'cars/UUID/UUID.jpg' }) @IsString() @Matches(/^cars\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|avif|mp4|webm)$/) storageKey!: string;
  @ApiProperty({ enum: ['image', 'video'] }) @IsIn(['image', 'video']) type!: 'image' | 'video';
  @ApiProperty({ enum: allowedMimeTypes }) @IsIn(allowedMimeTypes) mimeType!: MediaMimeType;
  @ApiProperty({ minimum: 1, maximum: 100_000_000 }) @IsInt() @Min(1) @Max(100_000_000) sizeBytes!: number;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) altText?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() isCover?: boolean;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) @Max(20_000) width?: number;
  @ApiPropertyOptional({ minimum: 1 }) @IsOptional() @IsInt() @Min(1) @Max(20_000) height?: number;
}

export class UpdateMediaDto {
  @ApiPropertyOptional({ maxLength: 500, nullable: true }) @IsOptional() @IsString() @MaxLength(500) altText?: string | null;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @IsBoolean() isCover?: boolean;
  @ApiPropertyOptional({ minimum: 0 }) @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class ReorderMediaDto {
  @ApiProperty({ type: [String], description: 'Every active media ID exactly once, in display order' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsUUID('all', { each: true }) mediaIds!: string[];
}
