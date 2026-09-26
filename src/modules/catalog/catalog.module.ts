import { Module } from '@nestjs/common';
import { AdminBrandsController, AdminModelsController, PublicCatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({ controllers: [PublicCatalogController, AdminBrandsController, AdminModelsController], providers: [CatalogService] })
export class CatalogModule {}
