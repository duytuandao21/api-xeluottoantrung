import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { auditContext } from '../../common/audit.js';
import { AdminAccessRequired, CurrentUser, Permissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { TV_MUSIC_MAX_BYTES } from '../content/tv-music.settings.js';
import { TVMusicService } from './tv-music.service.js';

export class TVMusicUploadDto {
  @IsString() @MaxLength(120) name!: string;
  @IsInt() @Min(3) @Max(TV_MUSIC_MAX_BYTES) sizeBytes!: number;
}
export class TVMusicRevisionDto { @IsInt() @Min(0) revision!: number; }

@ApiTags('Admin TV music')
@ApiBearerAuth()
@AdminAccessRequired()
@Controller('admin/tv-music')
export class TVMusicController {
  constructor(private readonly music: TVMusicService) {}
  @Get('usage') @Permissions('content.read')
  usage() { return this.music.usage(); }

  @Post('uploads') @Permissions('content.update')
  reserve(@Body() dto: TVMusicUploadDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.music.reserve(dto.name, dto.sizeBytes, auditContext(req, user));
  }

  @Put('uploads/:id') @Permissions('content.update')
  async upload(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest,
    @Headers('content-length') length: string, @CurrentUser() user: AuthenticatedUser) {
    if (!(req.body instanceof Readable)) throw new BadRequestException('Upload phải dùng audio/mpeg.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10 * 60_000);
    const aborted = () => controller.abort();
    req.raw.once('aborted', aborted);
    try { return await this.music.upload(id, req.body, Number(length), auditContext(req, user), controller.signal); }
    finally { clearTimeout(timer); req.raw.off('aborted', aborted); }
  }

  @Delete('uploads/:id') @Permissions('content.update') @HttpCode(204)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.music.cancel(id, auditContext(req, user));
  }

  @Delete('tracks/:id') @Permissions('content.update')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TVMusicRevisionDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.music.remove(id, dto.revision, auditContext(req, user));
  }
}
