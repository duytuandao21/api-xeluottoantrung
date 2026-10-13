import { Module } from '@nestjs/common';
import { OwnershipAdminController, OwnershipPublicController } from './controller.js';
import { OwnershipService } from './service.js';
@Module({ controllers: [OwnershipPublicController, OwnershipAdminController], providers: [OwnershipService] })
export class OwnershipModule {}
