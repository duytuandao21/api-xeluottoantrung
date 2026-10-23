import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { AdminAboutStoryController, PublicAboutStoryController } from './controller.js';
import { AboutStoryService } from './service.js';

@Module({ imports: [MediaModule], controllers: [PublicAboutStoryController, AdminAboutStoryController],
  providers: [AboutStoryService] })
export class AboutStoryModule {}
