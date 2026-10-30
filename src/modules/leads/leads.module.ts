import { Module } from '@nestjs/common';
import { AdminLeadsController, AdminNewsletterController, PublicLeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';
import { FormProtectionService } from './form-protection.service.js';

@Module({ controllers: [PublicLeadsController, AdminLeadsController, AdminNewsletterController], providers: [LeadsService, FormProtectionService] })
export class LeadsModule {}
