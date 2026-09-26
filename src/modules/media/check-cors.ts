import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../../config/env.js';
import { R2StorageService } from './storage.service.js';

async function main() {
  const storage = new R2StorageService(new ConfigService(validateEnv(process.env)));
  const origin = process.argv[2] ?? 'http://localhost:3001';
  const signed = await storage.presignPut(`phase6-cors-check/${randomUUID()}.txt`, 'text/plain');
  const response = await fetch(signed, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-type',
  } });
  if (!response.ok || response.headers.get('access-control-allow-origin') !== origin ||
    !response.headers.get('access-control-allow-methods')?.includes('PUT'))
    throw new Error(`R2 browser CORS preflight failed (${response.status})`);
  console.log(`R2 CORS preflight OK for ${origin}`);
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
