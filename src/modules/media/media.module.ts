import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { StorageCleanupService } from './storage-cleanup.service.js';
import { StorageCleanupInterceptor } from './storage-cleanup.interceptor.js';
import { CarMediaController, MediaUploadController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { R2StorageService, STORAGE_SERVICE } from './storage.service.js';
import { TVMusicService } from './tv-music.service.js';
import { TVMusicController } from './tv-music.controller.js';

@Module({ controllers: [MediaUploadController, CarMediaController, TVMusicController],
  providers: [MediaService, TVMusicService, StorageCleanupService, { provide: APP_INTERCEPTOR, useClass: StorageCleanupInterceptor },
    { provide: STORAGE_SERVICE, useClass: R2StorageService }], exports: [STORAGE_SERVICE, TVMusicService] })
export class MediaModule {}
