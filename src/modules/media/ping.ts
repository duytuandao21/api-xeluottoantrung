import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../../config/env.js';
import { R2StorageService } from './storage.service.js';

async function main() {
  const config = new ConfigService(validateEnv(process.env));
  await new R2StorageService(config).ping();
  console.log('R2 bucket connection OK');
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
