import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsDefined, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { BASE_TYPES, CATEGORIES, OPTION_CATEGORIES, SCOPES, type Category, type OptionCategory, type PolicyConfig } from './domain.js';

export class ReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) @Matches(/\S/) reason!: string;
}
export class ChangeDto extends ReasonDto {
  @ApiProperty() @IsInt() @Min(1) expectedRevision!: number;
}
export class CreatePolicyDto extends ReasonDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) @Matches(/\S/) name!: string;
  @ApiProperty() @Matches(/^\d+\.\d+\.\d+$/) @MaxLength(40) version!: string;
}
export class ConfidenceWeightsDto {
  @ApiProperty() @IsInt() @Min(0) @Max(100) odo!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) exterior!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) interior!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) accident!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) flood!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) engine!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) transmission!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) service!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) owners!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) usage!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100) color!: number;
}
export class ConfigDto implements PolicyConfig {
  @ApiProperty() @IsInt() @Min(1) @Max(200000) expectedKmPerYear!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(1) youngVehicleAgeFloor!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) odoMaxBonusPercent!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(95) odoMaxPenaltyPercent!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.01) @Max(1) minValueFactor!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 4 }) @Min(1) @Max(3) maxValueFactor!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(95) marketRangeMinusPercent!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) marketRangePlusPercent!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(95) dealerMarginMinPercent!: number;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(95) dealerMarginMaxPercent!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(10000000) roundingVnd!: number;
  @ApiProperty() @IsInt() @Min(1886) @Max(2100) minModelYear!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(100) maxVehicleAge!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(20000000) maxOdometerKm!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(99) mediumConfidenceThreshold!: number;
  @ApiProperty() @IsInt() @Min(2) @Max(100) highConfidenceThreshold!: number;
  @ApiProperty({ type: ConfidenceWeightsDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => ConfidenceWeightsDto) confidenceWeights!: ConfidenceWeightsDto;
  @ApiProperty() @IsBoolean() showSeverePriceRange!: boolean;
}
export class UpdatePolicyDto extends ChangeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) @Matches(/\S/) name!: string;
  @ApiProperty({ type: ConfigDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => ConfigDto) config!: ConfigDto;
}
export class SettingsDto extends ReasonDto {
  @ApiProperty({ description: 'Enabling requires a valid published policy, reviewed data and publish permission.' }) @IsBoolean() isEnabled!: boolean;
  @ApiPropertyOptional({ description: 'Required when switching from disabled to enabled; confirms reviewed prices and rules.' }) @IsOptional() @IsBoolean() confirmed?: boolean;
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2000) @Matches(/\S/) disclaimer!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) @Matches(/\S/) ctaLabel!: string;
}
export class PublishDto extends ChangeDto { @ApiProperty() @IsIn([true]) confirmed!: true; }
export class ReferenceDto extends ChangeDto {
  @ApiProperty() @IsUUID() policyId!: string;
  @ApiProperty() @IsUUID() variantId!: string;
  @ApiProperty() @IsInt() @Min(1886) @Max(2100) modelYear!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) originalMsrp?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) currentMsrp?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) marketReference?: number | null;
  @ApiProperty({ enum: BASE_TYPES }) @IsIn(BASE_TYPES) basePriceType!: typeof BASE_TYPES[number];
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) @Matches(/\S/) source!: string;
  @ApiProperty() @IsString() @MaxLength(3000) note = '';
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) referenceAgeYears?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(20000000) referenceOdometerKm?: number | null;
  @ApiProperty() @IsString() @MaxLength(2000) basisNote = '';
  @ApiProperty() @IsDateString({ strict: true }) effectiveFrom!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) effectiveTo?: string | null;
  @ApiProperty() @IsBoolean() active!: boolean;
}
export class OptionDto extends ChangeDto {
  @ApiProperty() @IsUUID() policyId!: string;
  @ApiProperty({ enum: OPTION_CATEGORIES }) @IsIn(OPTION_CATEGORIES) category!: OptionCategory;
  @ApiProperty() @Matches(/^[A-Z][A-Z0-9_]{0,59}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(180) @Matches(/\S/) label!: string;
  @ApiProperty() @IsString() @MaxLength(2000) description = '';
  @ApiProperty() @IsBoolean() isUnknown!: boolean;
  @ApiProperty() @IsBoolean() requiresInspection!: boolean;
  @ApiProperty() @IsBoolean() active!: boolean;
  @ApiProperty() @IsInt() @Min(0) @Max(100000) sortOrder!: number;
}
export class RuleDto extends ChangeDto {
  @ApiProperty() @IsUUID() policyId!: string;
  @ApiProperty({ enum: CATEGORIES }) @IsIn(CATEGORIES) category!: Category;
  @ApiProperty({ enum: SCOPES }) @IsIn(SCOPES) scope!: typeof SCOPES[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() modelId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() optionId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsUUID() colorId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-100) @Max(20000000) minValue?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-100) @Max(20000000) maxValue?: number | null;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(-95) @Max(100) adjustmentPercent!: number;
  @ApiProperty() @IsBoolean() manualInspectionRequired!: boolean;
  @ApiProperty() @IsBoolean() active!: boolean;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(180) @Matches(/\S/) label!: string;
  @ApiProperty() @IsString() @MaxLength(3000) note = '';
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) effectiveFrom?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) effectiveTo?: string | null;
}
export class ListQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() policyId?: string;
  @ApiPropertyOptional({ enum: CATEGORIES }) @IsOptional() @IsIn(CATEGORIES) category?: Category;
  @ApiPropertyOptional({ enum: SCOPES }) @IsOptional() @IsIn(SCOPES) scope?: typeof SCOPES[number];
  @ApiPropertyOptional() @IsOptional() @IsUUID() brandId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() modelId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() variantId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1886) @Max(2100) modelYear?: number;
  @ApiPropertyOptional({ enum: ['true', 'false'] }) @IsOptional() @IsIn(['true', 'false']) active?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) search?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
// A single current configuration: callers never choose a policy/version.
export class CurrentReferenceDto extends OmitType(ReferenceDto, ['policyId'] as const) {}
export class CurrentRuleDto extends OmitType(RuleDto, ['policyId'] as const) {}
export class CurrentOptionDto extends OmitType(OptionDto, ['policyId'] as const) {}
export class CurrentConfigDto extends OmitType(UpdatePolicyDto, ['name'] as const) {}
export class CurrentListQuery extends OmitType(ListQuery, ['policyId'] as const) {}
