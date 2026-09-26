import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const leadTypes = ['sell', 'trade_in', 'callback', 'finance'] as const;
export const leadStatuses = ['unread', 'read', 'replied'] as const;
export class CreateLeadDto {
  @ApiProperty({ enum: leadTypes }) @IsIn(leadTypes) type!: typeof leadTypes[number];
  @ApiProperty() @IsString() @Matches(/^[+0-9()\s.-]{9,24}$/) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5_000) content?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() carId?: string;
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
}
export class LeadQuery {
  @ApiPropertyOptional({ enum: leadTypes }) @IsOptional() @IsIn(leadTypes) type?: typeof leadTypes[number];
  @ApiPropertyOptional({ enum: leadStatuses }) @IsOptional() @IsIn(leadStatuses) status?: typeof leadStatuses[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class UpdateLeadDto {
  @ApiProperty({ enum: leadStatuses }) @IsIn(leadStatuses) status!: typeof leadStatuses[number];
}
export class NewsletterDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
}
export class NewsletterQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class UpdateNewsletterDto {
  @ApiProperty({ enum: ['active', 'inactive'] }) @IsIn(['active', 'inactive']) status!: 'active' | 'inactive';
}
