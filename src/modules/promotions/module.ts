import { Module } from '@nestjs/common';
import { AdminPromotionsController, PublicPromotionsController } from './controller.js';
import { PromotionsService } from './service.js';
@Module({ controllers: [AdminPromotionsController, PublicPromotionsController], providers: [PromotionsService] })
export class PromotionsModule {}
