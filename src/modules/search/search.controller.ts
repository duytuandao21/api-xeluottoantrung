import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/auth.decorators.js';
import { SearchResultsQuery, SearchTermQuery } from './search.dto.js';
import { SearchService } from './search.service.js';

@Public()
@ApiTags('Public product search')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('suggestions')
  @ApiOperation({ summary: 'Related search tags and up to five matches; two cars and two accessories on focus' })
  suggestions(@Query() query: SearchTermQuery) { return this.search.suggestions(query.q); }

  @Get()
  @ApiOperation({ summary: 'Paginated name search across published cars and active accessories' })
  list(@Query() query: SearchResultsQuery) { return this.search.list(query); }
}
