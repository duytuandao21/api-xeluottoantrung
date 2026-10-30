import { AdminSortQuery } from '../../common/admin-list-query.js';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const leadTypes = ['sell', 'trade_in', 'callback', 'finance'] as const;
export const leadStatuses = ['unread', 'read', 'replied'] as const;
export class CreateLeadDto {
  @ApiProperty({ enum: leadTypes }) @IsIn(leadTypes) type!: typeof leadTypes[number];
  @ApiProperty() @IsString() @Matches(/^[+0-9()\s.-]{9,24}$/) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5_000) content?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() carId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() productId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) carName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) currentCar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(240) desiredCar?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) offeredBrand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) offeredModel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) offeredVersion?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^(19|20)\d{2}$/) offeredYear?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,9}$/) offeredMileage?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,15}$/) financeAmount?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{1,3}$/) financeTerm?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() submissionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) turnstileToken?: string;
}
export class LeadQuery extends AdminSortQuery {
  @ApiPropertyOptional({ enum: leadTypes }) @IsOptional() @IsIn(leadTypes) type?: typeof leadTypes[number];
  @ApiPropertyOptional({ enum: leadStatuses }) @IsOptional() @IsIn(leadStatuses) status?: typeof leadStatuses[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class UpdateLeadDto {
  @ApiProperty({ enum: leadStatuses }) @IsIn(leadStatuses) status!: typeof leadStatuses[number];
}
export class BulkLeadStatusDto extends UpdateLeadDto {
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('4', { each: true }) ids!: string[];
}
export class NewsletterDto {
  @ApiProperty() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail() @MaxLength(254) email!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() submissionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) turnstileToken?: string;
}
export class NewsletterQuery extends AdminSortQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ enum: ['unviewed', 'viewed'] }) @IsOptional() @IsIn(['unviewed', 'viewed']) view?: 'unviewed' | 'viewed';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class UpdateNewsletterDto {
  @ApiProperty({ enum: ['active', 'inactive'] }) @IsIn(['active', 'inactive']) status!: 'active' | 'inactive';
}
export class NewsletterViewDto {
  @ApiProperty() @IsIn([true, false]) viewed!: boolean;
}
export class BulkNewsletterViewDto extends NewsletterViewDto {
  @ApiProperty({ type: [String], format: 'uuid' }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('4', { each: true }) ids!: string[];
}
