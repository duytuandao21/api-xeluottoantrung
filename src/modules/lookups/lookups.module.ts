import { Module } from '@nestjs/common';
import { AdminLookupsController, PublicLookupsController } from './lookups.controller.js';
import { LookupPermissionsGuard } from './lookups.guard.js';
import { LookupsService } from './lookups.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({ imports: [AuthModule], controllers: [PublicLookupsController, AdminLookupsController],
  providers: [LookupsService, LookupPermissionsGuard] })
export class LookupsModule {}
