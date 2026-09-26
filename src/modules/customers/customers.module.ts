import { Module } from '@nestjs/common';
import { AdminCustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Module({ controllers: [AdminCustomersController], providers: [CustomersService] })
export class CustomersModule {}
