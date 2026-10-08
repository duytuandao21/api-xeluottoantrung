import { Module } from '@nestjs/common';
import { RecommendationPublicController, RecommendationHistoryController } from './controller.js';
import { RecommendationRepository } from './repository.js';
import { RecommendationService } from './service.js';
import { RecommendationAdminService } from './admin.service.js';
import { RecommendationReporting } from './reporting.js';
@Module({ controllers: [RecommendationPublicController, RecommendationHistoryController], providers: [RecommendationRepository, RecommendationService, RecommendationAdminService, RecommendationReporting] })
export class CarRecommendationsModule {}
