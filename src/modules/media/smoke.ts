import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../../config/env.js';
import { R2StorageService } from './storage.service.js';

async function main() {
  const storage = new R2StorageService(new ConfigService(validateEnv(process.env)));
  const key = `phase6-smoke/${randomUUID()}.txt`;
  const body = 'R2 phase 6 smoke test';
  try {
    const signed = await storage.presignPut(key, 'text/plain');
    const response = await fetch(signed, { method: 'PUT', headers: { 'Content-Type': 'text/plain', Origin: 'http://localhost:3001' }, body });
    if (!response.ok) throw new Error(`R2 PUT failed (${response.status})`);
    if (response.headers.get('access-control-allow-origin') !== 'http://localhost:3001')
      throw new Error('R2 PUT response does not allow the admin origin');
    const object = await storage.head(key);
    if (object?.sizeBytes !== Buffer.byteLength(body) || object.mimeType !== 'text/plain') throw new Error('R2 HEAD metadata mismatch');
    const publicResponse = await fetch(storage.publicUrl(key));
    if (!publicResponse.ok || await publicResponse.text() !== body) throw new Error(`R2 public URL failed (${publicResponse.status})`);
    console.log('R2 presigned PUT, HEAD, and public GET OK');
  } finally {
    await storage.delete(key);
    if (await storage.head(key)) throw new Error('R2 smoke object was not deleted');
  }
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
