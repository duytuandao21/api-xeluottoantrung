import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsDefined, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CLASSIFICATIONS, EFFECTS, PRIORITIES, PURPOSES, SOURCE_STATUSES, type Classification, type Effect, type Priority, type Purpose, type ReferenceExpectation } from './domain.js';

export class PersonDto {
  @ApiProperty({ example: '1998-08-15' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) birthDate!: string;
  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] }) @IsOptional() @IsIn(['MALE', 'FEMALE', 'OTHER']) gender?: string;
  @ApiProperty({ enum: PURPOSES }) @IsIn(PURPOSES) purpose!: Purpose;
}
export class SearchDto extends PersonDto {
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) from!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) to!: string;
}
export class DetailDto extends PersonDto {
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) targetDate!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d+\.\d+\.\d+$/) expectedRulesetVersion?: string;
}
export class SimulateDto extends DetailDto {
  @ApiProperty() @IsUUID() ruleSetId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() compareRuleSetId?: string;
}
export class ChangeDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) @Matches(/\S/) reason!: string;
}
export class SettingsDto extends ChangeDto {
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) @Matches(/\S/) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(90) maxSearchDays!: number;
  @ApiProperty({ enum: PURPOSES }) @IsIn(PURPOSES) defaultPurpose!: Purpose;
  @ApiProperty({ enum: PURPOSES, isArray: true }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @IsIn(PURPOSES, { each: true }) supportedPurposes!: Purpose[];
  @ApiProperty() @IsBoolean() showLunarDate!: boolean;
  @ApiProperty() @IsBoolean() showCanChi!: boolean;
  @ApiProperty() @IsBoolean() showGoodHours!: boolean;
  @ApiProperty() @IsBoolean() showExplanation!: boolean;
  @ApiProperty() @IsBoolean() showScore!: boolean;
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2000) @Matches(/\S/) disclaimer!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) @Matches(/\S/) ctaLabel!: string;
  @ApiProperty() @IsString() @MaxLength(160) seoTitle!: string;
  @ApiProperty() @IsString() @MaxLength(320) seoDescription!: string;
}
export class VersionDto extends ChangeDto {
  @ApiProperty() @Matches(/^\d+\.\d+\.\d+$/) @MaxLength(40) version!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) @Matches(/\S/) name!: string;
  @ApiProperty({ enum: PURPOSES }) @IsIn(PURPOSES) purpose!: Purpose;
}
export class PublishDto extends ChangeDto { @ApiProperty() @IsIn([true]) confirmed!: boolean }
export class ParametersDto {
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @ArrayUnique() @IsInt({ each: true }) @Min(0, { each: true }) @Max(11, { each: true }) officers?: number[];
}
export class RuleDto extends ChangeDto {
  @ApiProperty({ enum: PRIORITIES }) @IsIn(PRIORITIES) priority!: Priority;
  @ApiProperty({ enum: EFFECTS }) @IsIn(EFFECTS) effect!: Effect;
  @ApiProperty() @IsInt() @Min(0) @Max(50) weight!: number;
  @ApiProperty() @IsBoolean() hardExclusion!: boolean;
  @ApiProperty() @IsBoolean() isEnabled!: boolean;
  @ApiProperty() @IsInt() @Min(0) @Max(1000) sortOrder!: number;
  @ApiProperty({ type: ParametersDto }) @IsDefined() @IsObject() @ValidateNested() @Type(() => ParametersDto) parameters!: ParametersDto;
}
export class ContentDto extends ChangeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) title!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1500) @Matches(/\S/) shortDescription!: string;
  @ApiProperty() @IsString() @MaxLength(6000) detailDescription!: string;
}
export class SourceDto extends ChangeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) @Matches(/\S/) title!: string;
  @ApiProperty() @IsString() @MaxLength(200) author!: string;
  @ApiProperty() @IsString() @MaxLength(200) publisher!: string;
  @ApiProperty() @IsString() @MaxLength(150) edition!: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(2099) publishedYear?: number | null;
  @ApiProperty() @IsString() @MaxLength(200) pageReference!: string;
  @ApiProperty() @IsString() @MaxLength(2000) @Matches(/^(https:\/\/[^\s]+)?$/) url!: string;
  @ApiProperty() @IsString() @MaxLength(4000) note!: string;
  @ApiProperty({ enum: SOURCE_STATUSES }) @IsIn(SOURCE_STATUSES) verificationStatus!: typeof SOURCE_STATUSES[number];
}
export class CaseDto extends PersonDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/) name!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsDateString({ strict: true }) targetDate!: string;
  @ApiProperty({ type: Object }) @IsObject() expected!: ReferenceExpectation;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(3000) @Matches(/\S/) sourceNote!: string;
  @ApiProperty() @IsBoolean() isActive!: boolean;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) @Matches(/\S/) reason!: string;
}
export class AuditQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export function validClassification(value: unknown): value is Classification { return CLASSIFICATIONS.includes(value as Classification); }
