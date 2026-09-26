import { Module } from '@nestjs/common';
import { CarMediaController, MediaUploadController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { R2StorageService, STORAGE_SERVICE } from './storage.service.js';

@Module({ controllers: [MediaUploadController, CarMediaController],
  providers: [MediaService, { provide: STORAGE_SERVICE, useClass: R2StorageService }] })
export class MediaModule {}
