import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, Equals, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ENVIRONMENTS, EVENT_TYPES, PASSENGERS, PRIORITIES, PURPOSES, STYLES, TECHNICAL, type TechnicalKey } from './domain.js';
export class BudgetDto {
  @IsInt() @Min(0) @Max(50000000000) min!: number;
  @IsInt() @Min(1) @Max(50000000000) max!: number;
}
export class TechnicalDto {
  @IsOptional() @IsString() @MaxLength(100) brand?: string;
  @IsOptional() @IsString() @MaxLength(100) bodyStyle?: string;
  @IsOptional() @IsString() @MaxLength(100) transmission?: string;
  @IsOptional() @IsString() @MaxLength(100) fuel?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsIn(TECHNICAL, { each: true }) required?: TechnicalKey[];
}
export class AnswersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique() @IsIn(PURPOSES, { each: true }) purposes!: string[];
  @IsObject() @ValidateNested() @Type(() => BudgetDto) budget!: BudgetDto;
  @IsIn(PASSENGERS) passengers!: string;
  @IsBoolean() requireSeats!: boolean;
  @IsIn(ENVIRONMENTS) environment!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @IsIn(PRIORITIES, { each: true }) priorities!: string[];
  @IsOptional() @IsObject() @ValidateNested() @Type(() => TechnicalDto) technical?: TechnicalDto;
  @IsOptional() @IsIn([...STYLES, '']) style?: string;
  @IsOptional() @IsObject() extras?: Record<string, string | string[]>;
}
export class CapabilityDto { @Matches(/^[A-Za-z0-9_-]{43}$/) capability!: string; }
export class ResultsPageDto extends CapabilityDto { @IsInt() @Min(0) @Max(5000) offset = 0; }
export class SessionDto extends CapabilityDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) configUpdatedAt?: string;
  @IsUUID() requestId!: string;
  @Equals(true) noticeAccepted!: true;
  @IsObject() @ValidateNested() @Type(() => AnswersDto) answers!: AnswersDto;
  @IsInt() @Min(0) @Max(86400000) completionMs!: number;
}
export class EventDto extends CapabilityDto {
  @IsIn(EVENT_TYPES) type!: typeof EVENT_TYPES[number];
  @IsOptional() @IsUUID() carId?: string;
}
export class SessionsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
