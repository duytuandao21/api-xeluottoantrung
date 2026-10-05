import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchTermQuery {
  @ApiPropertyOptional({ description: 'Search by public car or accessory name', maxLength: 120 })
  @IsOptional() @IsString() @MaxLength(120) q?: string;
}

export class SearchResultsQuery extends SearchTermQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page = 1;

  @ApiPropertyOptional({ default: 12, maximum: 24 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) limit = 12;
}
