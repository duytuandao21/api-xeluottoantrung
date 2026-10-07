import { Module } from '@nestjs/common';
import { ValuationAdminController } from './valuation.controller.js';
import { ValuationRepository } from './valuation.repository.js';
import { ValuationAdminService } from './valuation.service.js';
import { ValuationPublicController } from './valuation-public.controller.js';
import { ValuationEstimateService } from './estimate.service.js';
import { ValuationEngineService } from './valuation-engine.service.js';
import { ValuationHistoryService } from './history.service.js';
@Module({ controllers: [ValuationAdminController, ValuationPublicController], providers: [ValuationRepository, ValuationAdminService, ValuationEstimateService, ValuationEngineService, ValuationHistoryService] })
export class ValuationModule {}
