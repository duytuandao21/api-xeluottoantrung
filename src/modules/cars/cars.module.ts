import { Module } from '@nestjs/common';
import { AdminCarsController, PublicCarsController, SaleCarsController } from './cars.controller.js';
import { CarsService } from './cars.service.js';

@Module({ controllers: [PublicCarsController, AdminCarsController, SaleCarsController], providers: [CarsService] })
export class CarsModule {}
