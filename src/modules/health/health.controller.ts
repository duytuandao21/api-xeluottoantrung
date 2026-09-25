import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { DatabaseService } from '../../database/database.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({ summary: 'Application and database readiness' })
  @ApiResponse({ status: 200, description: 'Application and database are ready', schema: { example: { status: 'ok', database: 'ok' } } })
  @ApiResponse({ status: 503, description: 'Database is unavailable' })
  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      await this.database.ping();
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
