import { Module } from '@nestjs/common';
import { AdminCollectionsController, PublicCollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { AdminContentController, AdminSettingsController, PublicContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { DisplayOrderService } from './display-order.service.js';
import { MediaModule } from '../media/media.module.js';

@Module({ imports: [MediaModule], controllers: [PublicCollectionsController, AdminCollectionsController, PublicContentController,
  AdminContentController, AdminSettingsController], providers: [CollectionsService, ContentService, DisplayOrderService] })
export class ContentModule {}
