import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AssetDto, AssetUpdateDto, MilestoneDto, OrderDto, RevisionDto, SectionDto, StoryDto } from './dto.js';
import { AboutStoryService } from './service.js';

@ApiTags('Public about story')
@Public()
@Controller('about-story')
export class PublicAboutStoryController {
  constructor(@Inject(AboutStoryService) private readonly service: AboutStoryService) {}
  @Get() @Header('Cache-Control', 'no-store')
  page() { return this.service.publicPage(); }
}

@ApiTags('Admin about story')
@ApiBearerAuth()
@Controller('admin/about-story')
export class AdminAboutStoryController {
  constructor(@Inject(AboutStoryService) private readonly service: AboutStoryService) {}
  @Get() @Permissions('content.read') @Header('Cache-Control', 'private, no-store')
  content() { return this.service.content(); }

  @Patch('sections/:key') @Permissions('content.update') @Header('Cache-Control', 'private, no-store')
  section(@Param('key') key: string, @Body() dto: SectionDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.section(key, dto, auditContext(req, user));
  }
  @Post('milestones') @Permissions('content.create')
  createMilestone(@Body() dto: MilestoneDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createMilestone(dto, auditContext(req, user));
  }
  @Patch('milestones/:id') @Permissions('content.update')
  updateMilestone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneDto,
    @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateMilestone(id, dto, auditContext(req, user));
  }
  @Delete('milestones/:id') @Permissions('content.delete') @HttpCode(204)
  deleteMilestone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionDto,
    @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deleteMilestone(id, dto, auditContext(req, user));
  }
  @Post('stories') @Permissions('content.create')
  createStory(@Body() dto: StoryDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createStory(dto, auditContext(req, user));
  }
  @Patch('stories/:id') @Permissions('content.update')
  updateStory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StoryDto,
    @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateStory(id, dto, auditContext(req, user));
  }
  @Delete('stories/:id') @Permissions('content.delete') @HttpCode(204)
  deleteStory(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionDto,
    @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deleteStory(id, dto, auditContext(req, user));
  }
  @Post('assets') @Permissions('content.create')
  addAsset(@Body() dto: AssetDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.addAsset(dto, auditContext(req, user));
  }
  @Delete('assets/:id') @Permissions('content.delete') @HttpCode(204)
  deleteAsset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionDto,
    @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.deleteAsset(id, dto, auditContext(req, user));
  }
  @Patch('assets/:id') @Permissions('content.update')
  updateAsset(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssetUpdateDto,
    @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateAsset(id, dto, auditContext(req, user));
  }
  @Patch('order') @Permissions('content.update')
  reorder(@Body() dto: OrderDto, @Req() req: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.service.reorder(dto, auditContext(req, user));
  }
}
