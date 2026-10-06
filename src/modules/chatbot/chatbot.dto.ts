import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';

const trimmed = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class ChatHistoryDto {
  @IsIn(['user', 'assistant']) role!: 'user' | 'assistant';
  @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(8000) content!: string;
}

export class ChatRequestDto {
  @Transform(trimmed) @IsString() @MinLength(1) @MaxLength(2000) message!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(16) @ValidateNested({ each: true }) @Type(() => ChatHistoryDto)
  history?: ChatHistoryDto[];
}
