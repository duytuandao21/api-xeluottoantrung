import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import cluster from 'node:cluster';
import { PublicResponseCache } from './public-cache.js';
import { PublicCacheInterceptor } from './public-cache.interceptor.js';
import { ContentReadDiagnostics } from './content-read-diagnostics.js';

type CacheRuntime = { clusterWorker: boolean; pm2Instance?: string; pm2ExecMode?: string };
export function publicCacheState(config: ConfigService, runtime: CacheRuntime = {
  clusterWorker: cluster.isWorker, pm2Instance: process.env.NODE_APP_INSTANCE, pm2ExecMode: process.env.exec_mode,
}) {
  // Process count is an explicit deployment assertion, including PM2 fork.
  // It must describe ALL API replicas, not merely the current worker index.
  let reason = 'single-process';
  if (config.get('PUBLIC_CACHE_ENABLED') !== true) reason = 'flag-off';
  else if (config.get('PUBLIC_CACHE_MODE') !== 'single-process') reason = 'mode-off';
  else if (config.get('PUBLIC_CACHE_PROCESS_COUNT') !== 1) reason = 'process-count-not-one';
  else if (runtime.clusterWorker || runtime.pm2ExecMode === 'cluster_mode') reason = 'cluster-worker';
  else if (runtime.pm2ExecMode !== undefined && runtime.pm2ExecMode !== 'fork_mode') reason = 'unknown-exec-mode';
  return { enabled: reason === 'single-process', reason };
}

export function publicCacheEnabled(config: ConfigService, runtime?: CacheRuntime): boolean {
  return publicCacheState(config, runtime).enabled;
}

@Module({
  providers: [
    ContentReadDiagnostics,
    { provide: PublicResponseCache, inject: [ConfigService], useFactory: (config: ConfigService) => new PublicResponseCache({
      enabled: publicCacheEnabled(config), maxEntries: config.get<number>('PUBLIC_CACHE_MAX_ENTRIES'),
      maxBytes: config.get<number>('PUBLIC_CACHE_MAX_BYTES'),
    }) },
    { provide: APP_INTERCEPTOR, useClass: PublicCacheInterceptor },
  ],
  exports: [PublicResponseCache, ContentReadDiagnostics],
})
export class PublicCacheModule {}
