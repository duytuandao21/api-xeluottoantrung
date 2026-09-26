import { Module } from '@nestjs/common';
import { AdminCarsController, PublicCarsController } from './cars.controller.js';
import { CarsService } from './cars.service.js';

@Module({ controllers: [PublicCarsController, AdminCarsController], providers: [CarsService] })
export class CarsModule {}
