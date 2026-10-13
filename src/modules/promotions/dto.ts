import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/swagger';

export class PromotionQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 6;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(['ongoing', 'upcoming', 'ended']) status?: 'ongoing' | 'upcoming' | 'ended';
}
export class CreatePromotionDto {
  @IsString() @MinLength(1) @MaxLength(240) title!: string;
  @IsOptional() @IsIn(['promotion', 'event']) kind?: 'promotion' | 'event';
  @IsString() @MaxLength(2000) @Matches(/^(?:https:\/\/[^\s<>]+|\/(?!\/)[^\s<>]+)$/) imageUrl!: string;
  @IsOptional() @IsString() @MaxLength(40000) content?: string;
  @IsDateString({ strict: true }) @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) startsAt!: string;
  @IsDateString({ strict: true }) @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/) endsAt!: string;
  @IsOptional() @IsBoolean() isPublished?: boolean;
  @IsOptional() @IsBoolean() popupEnabled?: boolean;
}
export class UpdatePromotionDto extends PartialType(CreatePromotionDto) {}
export class TogglePromotionPopupDto { @IsBoolean() enabled!: boolean; }
