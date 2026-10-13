import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import type { Answers, Policy, SettingsConfig } from './domain.js';
export class CalculateDto {
  @IsUUID() interactionId!: string;
  @IsUUID() requestId!: string;
  @IsString() @Matches(/^[A-Za-z0-9_-]{43,64}$/) capability!: string;
  @IsInt() @Min(0) @Max(10000) expectedRevision!: number;
  @IsObject() answers!: Answers;
}
export class SettingsDto { @IsBoolean() enabled!: boolean; @IsObject() config!: SettingsConfig; @IsString() @Length(10, 40) updatedAt!: string; }
export class ProfileDto {
  @IsIn(['car', 'version', 'model', 'body', 'fuel']) scope!: 'car' | 'version' | 'model' | 'body' | 'fuel';
  @IsString() @Length(1, 36) target!: string;
  @IsString() @Length(1, 120) name!: string;
  @IsObject() policy!: Policy;
  @IsOptional() @IsString() @Length(10, 40) updatedAt?: string;
}
export class SurveyQuery {
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsIn(['cash', 'loan']) finance?: 'cash' | 'loan';
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsIn(['newest', 'oldest', 'cost']) sort = 'newest';
}
export class ProfileQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @Length(0, 100) search?: string;
}
export class TargetQuery {
  @IsIn(['car', 'version', 'model', 'body']) scope!: 'car' | 'version' | 'model' | 'body';
  @IsOptional() @IsString() @Length(0, 100) search?: string;
}
