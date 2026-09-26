import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminAccessService } from './admin-access.service.js';
import { AdminMeController } from './admin-me.controller.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { JwtVerifierService } from './jwt-verifier.service.js';
import { PermissionsGuard } from './permissions.guard.js';

@Module({
  controllers: [AdminMeController],
  providers: [
    JwtVerifierService,
    AdminAccessService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AdminAccessService],
})
export class AuthModule {}
