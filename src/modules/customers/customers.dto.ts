import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CustomerQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) search?: string;
  @ApiPropertyOptional({ enum: ['active', 'blocked'] }) @IsOptional() @IsIn(['active', 'blocked']) status?: 'active' | 'blocked';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
export class CreateCustomerDto {
  @ApiProperty() @IsString() @MaxLength(160) name!: string;
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @Matches(/^[+0-9()\s.-]{9,24}$/) phone!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional({ enum: ['active', 'blocked'] }) @IsOptional() @IsIn(['active', 'blocked']) status?: 'active' | 'blocked';
}
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}
