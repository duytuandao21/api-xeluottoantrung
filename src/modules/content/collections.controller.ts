import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { auditContext } from '../../common/audit.js';
import { CurrentUser, Permissions, Public } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CollectionPayloadDto, CollectionQuery } from './collections.dto.js';
import { CollectionsService } from './collections.service.js';

@ApiTags('Public content collections')
@Public()
@Controller()
export class PublicCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get('articles') listArticles(@Query() query: CollectionQuery) { return this.collections.list('articles', query, true); }
  @Get('articles/:slug') article(@Param('slug') slug: string) { return this.collections.detail('articles', slug, true, true); }
  @Get('article-categories') categories(@Query() query: CollectionQuery) { return this.collections.list('article-categories', query, true); }
  @Get('faqs') faqs(@Query() query: CollectionQuery) { return this.collections.list('faqs', query, true); }
  @Get('testimonials') testimonials(@Query() query: CollectionQuery) { return this.collections.list('testimonials', query, true); }
  @Get('services') services(@Query() query: CollectionQuery) { return this.collections.list('services', query, true); }
  @Get('recruitments') recruitments(@Query() query: CollectionQuery) { return this.collections.list('recruitments', query, true); }
  @Get('slides') slides(@Query() query: CollectionQuery) { return this.collections.list('slides', query, true); }
  @Get('pages/by-path') @ApiOperation({ summary: 'Published page by its absolute path' })
  page(@Query('path') path: string) { return this.collections.detail('pages', path, true, true); }
}

@ApiTags('Admin content collections')
@ApiBearerAuth()
@Controller('admin/collections')
export class AdminCollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get(':collection') @Permissions('content.read')
  list(@Param('collection') collection: string, @Query() query: CollectionQuery) { return this.collections.list(collection, query, false); }

  @Get(':collection/:id') @Permissions('content.read')
  detail(@Param('collection') collection: string, @Param('id', ParseUUIDPipe) id: string) { return this.collections.detail(collection, id, false); }

  @Post(':collection') @Permissions('content.create')
  create(@Param('collection') collection: string, @Body() dto: CollectionPayloadDto,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.collections.create(collection, dto, auditContext(request, user));
  }

  @Patch(':collection/:id') @Permissions('content.update')
  update(@Param('collection') collection: string, @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectionPayloadDto, @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.collections.update(collection, id, dto, auditContext(request, user));
  }

  @Delete(':collection/:id') @Permissions('content.delete') @HttpCode(204)
  delete(@Param('collection') collection: string, @Param('id', ParseUUIDPipe) id: string,
    @Req() request: FastifyRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.collections.delete(collection, id, auditContext(request, user));
  }
}
