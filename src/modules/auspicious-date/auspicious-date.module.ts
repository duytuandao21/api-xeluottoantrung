import { Module } from '@nestjs/common';
import { AuspiciousAdminService } from './admin.service.js';
import { AuspiciousAdminController, AuspiciousPublicController } from './auspicious-date.controller.js';
import { ReferenceValidation } from './engine/reference-validation.js';
import { AuspiciousPublicService } from './public.service.js';
import { AuspiciousRepository } from './repository.js';
import { AuspiciousVersionsService } from './versions.service.js';
@Module({ controllers: [AuspiciousAdminController, AuspiciousPublicController], providers: [AuspiciousRepository, AuspiciousPublicService, AuspiciousAdminService, AuspiciousVersionsService, ReferenceValidation] })
export class AuspiciousDateModule {}
