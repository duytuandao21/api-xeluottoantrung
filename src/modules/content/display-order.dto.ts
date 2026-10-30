import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class SaveDisplayOrderDto {
  @IsArray() @ArrayMaxSize(2000) @IsUUID('4', { each: true }) expectedIds!: string[];
  @IsArray() @ArrayMaxSize(2000) @IsUUID('4', { each: true }) ids!: string[];
}
