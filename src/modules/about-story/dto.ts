import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const chapterKeys = ['opening', 'milestones', 'stories', 'people', 'future'] as const;
export type ChapterKey = typeof chapterKeys[number];
export const stageKeys = ['1997-2017', '2018-2022', '2024-2025', '2026'] as const;
const cleanText = /^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/;
const internalLink = /^\/(?!\/)[a-z0-9/\-]*(?:#[a-z0-9\-]+)?$/;

// Storytelling copy is plain text. React renders it as text, never raw HTML.
export class SectionDto {
  @IsString() @MaxLength(240) @Matches(cleanText) title!: string;
  @IsOptional() @IsString() @MaxLength(400) @Matches(cleanText) subtitle?: string | null;
  @IsOptional() @IsString() @MaxLength(10000) @Matches(cleanText) body?: string | null;
  @IsOptional() @IsString() @MaxLength(120) @Matches(cleanText) ctaLabel?: string | null;
  @IsOptional() @IsString() @Matches(internalLink) @MaxLength(300) ctaHref?: string | null;
  @IsBoolean() visible!: boolean;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class MilestoneDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(100) slug!: string;
  @IsString() @MaxLength(40) @Matches(cleanText) periodLabel!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) eventDate?: string | null;
  @IsIn(stageKeys) stage!: typeof stageKeys[number];
  @IsString() @MaxLength(240) @Matches(cleanText) title!: string;
  @IsString() @MaxLength(800) @Matches(cleanText) summary!: string;
  @IsOptional() @IsString() @MaxLength(10000) @Matches(cleanText) body?: string | null;
  @IsBoolean() featured!: boolean;
  @IsInt() @Min(0) @Max(100000) sortOrder!: number;
  @IsOptional() @IsString() @MaxLength(2000) sourceNote?: string | null;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class StoryDto {
  @IsString() @MaxLength(240) @Matches(cleanText) title!: string;
  @IsString() @MaxLength(10000) @Matches(cleanText) body!: string;
  @IsOptional() @IsString() @MaxLength(2000) @Matches(cleanText) quote?: string | null;
  @IsOptional() @IsString() @MaxLength(160) @Matches(cleanText) displayName?: string | null;
  @IsInt() @Min(0) @Max(100000) sortOrder!: number;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class AssetDto {
  @IsIn(['section', 'milestone', 'story']) ownerType!: 'section' | 'milestone' | 'story';
  @IsString() @MaxLength(100) ownerKey!: string;
  @IsIn(['desktop', 'mobile', 'gallery']) placement!: 'desktop' | 'mobile' | 'gallery';
  @Matches(/^assets\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/) storageKey!: string;
  @IsString() @MaxLength(300) @Matches(cleanText) altText!: string;
  @IsInt() @Min(1) @Max(20000) width!: number;
  @IsInt() @Min(1) @Max(20000) height!: number;
  @IsInt() @Min(0) @Max(100000) sortOrder!: number;
  @IsInt() @Min(0) expectedRevision!: number;
}

export class RevisionDto {
  @IsInt() @Min(0) expectedRevision!: number;
}

export class AssetUpdateDto extends RevisionDto {
  @IsString() @MaxLength(300) @Matches(cleanText) altText!: string;
  @IsIn(['desktop', 'mobile', 'gallery']) placement!: 'desktop' | 'mobile' | 'gallery';
  @IsInt() @Min(0) @Max(100000) sortOrder!: number;
}

export class OrderDto extends RevisionDto {
  @IsIn(['milestone', 'story', 'asset']) kind!: 'milestone' | 'story' | 'asset';
  @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) ids!: string[];
}
