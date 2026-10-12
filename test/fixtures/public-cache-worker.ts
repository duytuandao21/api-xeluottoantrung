import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { PublicResponseCache } from '../../src/common/cache/public-cache.js';
import { publicCacheEnabled } from '../../src/common/cache/public-cache.module.js';

const enabled = publicCacheEnabled(new ConfigService({
  PUBLIC_CACHE_ENABLED: !process.argv.includes('--off'), PUBLIC_CACHE_MODE: 'single-process',
  PUBLIC_CACHE_PROCESS_COUNT: process.argv.includes('--single-fork') ? 1 : 2,
}));
const cache = new PublicResponseCache({ enabled });
process.on('message', (message: number | { revision: number; invalidate: boolean }) => {
  const revision = typeof message === 'number' ? message : message.revision;
  if (typeof message !== 'number' && message.invalidate) cache.invalidate();
  void cache.read('shared-upstream', 60000, async () => ({ value: revision, shareable: true }))
    .then(value => process.send?.({ revision: value, enabled }));
});
