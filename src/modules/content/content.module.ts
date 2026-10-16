import { Module } from '@nestjs/common';
import { AdminCollectionsController, PublicCollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { AdminContentController, AdminSettingsController, PublicContentController } from './content.controller.js';
import { ContentService } from './content.service.js';

@Module({ controllers: [PublicCollectionsController, AdminCollectionsController, PublicContentController,
  AdminContentController, AdminSettingsController], providers: [CollectionsService, ContentService] })
export class ContentModule {}
