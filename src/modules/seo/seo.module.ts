import { Module } from '@nestjs/common';
import { AdminSeoController, PublicSeoController } from './seo.controller.js';
import { SeoService } from './seo.service.js';

@Module({ controllers: [PublicSeoController, AdminSeoController], providers: [SeoService] })
export class SeoModule {}
