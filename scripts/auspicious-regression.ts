import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../src/database/database.service.js';
import { ReferenceValidation } from '../src/modules/auspicious-date/engine/reference-validation.js';
import { AuspiciousRepository } from '../src/modules/auspicious-date/repository.js';

const id = process.argv[process.argv.indexOf('--version') + 1];
if (!process.argv.includes('--version') || !/^[0-9a-f-]{36}$/i.test(id ?? '')) throw new Error('Usage: npm run auspicious:regression -- --version <UUID>');
const database = new DatabaseService(new ConfigService({ DATABASE_URL: process.env.DATABASE_URL }));
try {
  const repo = new AuspiciousRepository(database);
  const report = new ReferenceValidation(repo).run(await repo.snapshot(id), false);
  console.log(`Total: ${report.total}\nPass: ${report.pass}\nFail: ${report.fail}\nChanged: ${report.changed}`);
  for (const item of report.cases.filter(item => item.status !== 'PASS')) console.log(`${item.name}: ${item.status} ${item.differences.join(', ')}`);
  for (const error of report.errors) console.log(error);
  if (!report.passed) process.exitCode = 1;
} finally { await database.onModuleDestroy(); }
