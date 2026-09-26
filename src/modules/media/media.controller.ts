import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { AdminAccessRequired, CurrentUser, Permissions } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AddMediaDto, PresignAssetDto, PresignMediaDto, ReorderMediaDto, UpdateMediaDto } from './media.dto.js';
import { MediaService } from './media.service.js';

@ApiTags('Admin media')
@ApiBearerAuth()
@Controller('admin/media')
export class MediaUploadController {
  constructor(private readonly media: MediaService) {}

  @Post('presign') @Permissions('media.create')
  @ApiOperation({ summary: 'Create a 5 minute signed R2 PUT URL for a car media object' })
  presign(@Body() dto: PresignMediaDto) { return this.media.presign(dto); }

  @Post('assets/presign') @AdminAccessRequired()
  @ApiOperation({ summary: 'Create a signed R2 PUT URL for an admin content image' })
  presignAsset(@Body() dto: PresignAssetDto, @CurrentUser() user: AuthenticatedUser) {
    if (!['media.create', 'content.update', 'seo.update'].some(permission => user.adminAccess?.permissions.includes(permission)))
      throw new ForbiddenException('Insufficient permission to upload content images');
    return this.media.presignAsset(dto);
  }
}

@ApiTags('Admin media')
@ApiBearerAuth()
@Controller('admin/cars/:id/media')
export class CarMediaController {
  constructor(private readonly media: MediaService) {}

  @Get() @Permissions('media.read')
  list(@Param('id', ParseUUIDPipe) id: string) { return this.media.list(id); }

  @Post() @Permissions('media.create')
  @ApiOperation({ summary: 'Verify uploaded R2 object and register its metadata' })
  add(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddMediaDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.media.add(id, dto, auditContext(request, user));
  }

  @Patch('order') @Permissions('media.update')
  reorder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReorderMediaDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.media.reorder(id, dto, auditContext(request, user));
  }

  @Patch(':mediaId') @Permissions('media.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() dto: UpdateMediaDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.media.update(id, mediaId, dto, auditContext(request, user));
  }

  @Delete(':mediaId') @Permissions('media.delete') @HttpCode(204)
  delete(@Param('id', ParseUUIDPipe) id: string, @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.media.delete(id, mediaId, auditContext(request, user));
  }
}
