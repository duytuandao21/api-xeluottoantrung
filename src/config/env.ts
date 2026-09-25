import type { ConfigModuleOptions } from '@nestjs/config';

export type AppConfig = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  CORS_ORIGINS: string;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
};

function positiveInt(value: unknown, name: string, fallback: number): number {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

export function validateEnv(input: Record<string, unknown>): AppConfig {
  const mode = input.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(String(mode))) throw new Error('NODE_ENV must be development, test or production');
  const databaseUrl = String(input.DATABASE_URL || '');
  if (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://')) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  const corsOrigins = String(input.CORS_ORIGINS || (mode === 'production' ? '' : 'http://localhost:3000,http://localhost:3001'));
  if (!corsOrigins.trim()) throw new Error('CORS_ORIGINS is required');
  for (const origin of corsOrigins.split(',').map((item) => item.trim())) {
    if (!origin || origin === '*' || !/^https?:\/\/[^/]+$/.test(origin)) throw new Error('CORS_ORIGINS must contain explicit origins without paths');
  }
  return {
    NODE_ENV: mode as AppConfig['NODE_ENV'],
    PORT: positiveInt(input.PORT, 'PORT', 4000),
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins,
    RATE_LIMIT_TTL_MS: positiveInt(input.RATE_LIMIT_TTL_MS, 'RATE_LIMIT_TTL_MS', 60_000),
    RATE_LIMIT_MAX: positiveInt(input.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 100),
  };
}

export const configOptions: ConfigModuleOptions = { isGlobal: true, envFilePath: '.env', validate: validateEnv };
