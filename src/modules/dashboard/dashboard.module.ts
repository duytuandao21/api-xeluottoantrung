import { Module } from '@nestjs/common';
import { AdminDashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { AdminAnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { CloudflareClient } from './cloudflare.client.js';
import { AnalyticsCarsService } from './analytics-cars.service.js';

@Module({ controllers: [AdminDashboardController, AdminAnalyticsController], providers: [DashboardService, AnalyticsService, CloudflareClient, AnalyticsCarsService] })
export class DashboardModule {}
