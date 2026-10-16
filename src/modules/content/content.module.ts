import { Module } from '@nestjs/common';
import { AdminCollectionsController, PublicCollectionsController } from './collections.controller.js';
import { CollectionsService } from './collections.service.js';
import { AdminContentController, AdminSettingsController, PublicContentController } from './content.controller.js';
import { ContentService } from './content.service.js';
import { PublicCacheModule } from '../../common/cache/public-cache.module.js';
import { PublicHomeContentController } from './home-content.controller.js';

@Module({ imports: [PublicCacheModule], controllers: [PublicCollectionsController, AdminCollectionsController, PublicContentController, PublicHomeContentController,
  AdminContentController, AdminSettingsController], providers: [CollectionsService, ContentService] })
export class ContentModule {}
