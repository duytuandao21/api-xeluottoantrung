import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { PASSENGERS, PRIORITIES, PURPOSES, type Assessments } from './domain.js';
import { AnswersDto } from './dto.js';
export class DateRangeQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
export class HistoryQuery extends DateRangeQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50000000000) minBudget?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50000000000) maxBudget?: number;
  @IsOptional() @IsIn(PURPOSES) purpose?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @IsOptional() @IsIn(PASSENGERS) passengers?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5000) resultCount?: number;
  @IsOptional() @IsIn(['result_viewed', 'car_clicked', 'contact_clicked', 'none']) interaction?: string;
  @IsOptional() @Matches(/^[0-9a-f-]{8,36}$/i) search?: string;
}
class OptionDto { @Matches(/^[a-z0-9][a-z0-9_]{0,39}$/) key!: string; @IsString() @MaxLength(160) label!: string; }
class QuestionDto {
  @IsString() @MaxLength(40) key!: string;
  @IsString() @MaxLength(240) title!: string;
  @IsString() @MaxLength(1000) description!: string;
  @IsIn(['single', 'multi', 'budget', 'technical']) type!: 'single' | 'multi' | 'budget' | 'technical';
  @IsBoolean() required!: boolean; @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(3) maxSelections!: number;
  @IsString() @MaxLength(1000) helpText!: string;
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => OptionDto) options!: OptionDto[];
}
class WeightsDto {
  @IsInt() @Min(1) @Max(100) budget!: number;
  @IsInt() @Min(0) @Max(100) purposes!: number;
  @IsInt() @Min(0) @Max(100) priorities!: number;
  @IsInt() @Min(0) @Max(100) environment!: number;
  @IsInt() @Min(0) @Max(100) seats!: number;
  @IsInt() @Min(0) @Max(100) technical!: number;
}
class PresetDto {
  @IsString() @MaxLength(100) label!: string;
  @IsInt() @Min(0) @Max(50000000000) min!: number;
  @IsInt() @Min(1) @Max(50000000000) max!: number;
}
export class ConfigDto {
  @IsArray() @ArrayMinSize(7) @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => QuestionDto) questions!: QuestionDto[];
  @IsObject() @ValidateNested() @Type(() => WeightsDto) weights!: WeightsDto;
  @IsInt() @Min(0) @Max(50000000000) minBudget!: number;
  @IsInt() @Min(1) @Max(50000000000) maxBudget!: number;
  @IsInt() @Min(1) @Max(5000) maxResults!: number;
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => PresetDto) budgetPresets!: PresetDto[];
}
export class SettingsDto {
  @IsISO8601({ strict: true }) expectedUpdatedAt!: string;
  @IsBoolean() enabled!: boolean;
  @IsInt() @Min(1) @Max(730) retentionDays!: number;
  @IsObject() @ValidateNested() @Type(() => ConfigDto) config!: ConfigDto;
}
export class ProfileQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsUUID() modelId?: string;
  @IsOptional() @IsIn(['active', 'deposit', 'sold', 'inactive']) status?: string;
  @IsOptional() @IsIn(['true', 'false']) missing?: string;
}
export class ProfileDto {
  @IsOptional() @IsISO8601({ strict: true }) expectedUpdatedAt?: string | null;
  @IsObject() assessments!: Assessments;
  @IsOptional() @IsBoolean() merge?: boolean;
}
class BatchItemDto extends ProfileDto { @IsUUID() carId!: string; }
export class BatchProfilesDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => BatchItemDto) items!: BatchItemDto[]; }
export class PreviewDto {
  @IsObject() @ValidateNested() @Type(() => ConfigDto) config!: ConfigDto;
  @IsObject() @ValidateNested() @Type(() => AnswersDto) answers!: AnswersDto;
}
