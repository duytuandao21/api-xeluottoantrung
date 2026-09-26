import type { ConfigModuleOptions } from '@nestjs/config';

export type AppConfig = {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  CORS_ORIGINS: string;
  RATE_LIMIT_TTL_MS: number;
  RATE_LIMIT_MAX: number;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_JWT_ISSUER: string;
  SUPABASE_JWKS_URL: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  R2_PUBLIC_BASE_URL: string;
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
  const supabaseUrl = String(input.SUPABASE_URL || '').replace(/\/$/, '');
  let projectUrl: URL;
  try { projectUrl = new URL(supabaseUrl); } catch { throw new Error('SUPABASE_URL must be an HTTPS project URL without a path'); }
  if (projectUrl.protocol !== 'https:' || projectUrl.username || projectUrl.password || projectUrl.pathname !== '/' || projectUrl.search || projectUrl.hash || projectUrl.origin !== supabaseUrl) throw new Error('SUPABASE_URL must be an HTTPS project URL without a path');
  const issuer = String(input.SUPABASE_JWT_ISSUER || `${supabaseUrl}/auth/v1`).replace(/\/$/, '');
  const jwksUrl = String(input.SUPABASE_JWKS_URL || `${issuer}/.well-known/jwks.json`);
  for (const [name, value] of [['SUPABASE_JWT_ISSUER', issuer], ['SUPABASE_JWKS_URL', jwksUrl]]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.origin !== projectUrl.origin || url.username || url.password || url.search || url.hash) throw new Error(`${name} must be an HTTPS URL on the Supabase project origin`);
  }
  const r2 = Object.fromEntries(['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']
    .map((name) => [name, String(input[name] || '').trim()])) as Record<string, string>;
  if (Object.values(r2).some(Boolean) && Object.values(r2).some((value) => !value))
    throw new Error('All R2 settings are required when R2 is configured');
  if (r2.R2_ACCOUNT_ID && !/^[a-f0-9]{32}$/i.test(r2.R2_ACCOUNT_ID)) throw new Error('R2_ACCOUNT_ID must be a 32 character account ID');
  if (r2.R2_BUCKET && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(r2.R2_BUCKET)) throw new Error('R2_BUCKET is invalid');
  if (r2.R2_PUBLIC_BASE_URL) {
    let publicUrl: URL;
    try { publicUrl = new URL(r2.R2_PUBLIC_BASE_URL); } catch { throw new Error('R2_PUBLIC_BASE_URL must be an HTTPS URL'); }
    if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash)
      throw new Error('R2_PUBLIC_BASE_URL must be an HTTPS URL');
  }
  return {
    NODE_ENV: mode as AppConfig['NODE_ENV'],
    PORT: positiveInt(input.PORT, 'PORT', 4000),
    DATABASE_URL: databaseUrl,
    CORS_ORIGINS: corsOrigins,
    RATE_LIMIT_TTL_MS: positiveInt(input.RATE_LIMIT_TTL_MS, 'RATE_LIMIT_TTL_MS', 60_000),
    RATE_LIMIT_MAX: positiveInt(input.RATE_LIMIT_MAX, 'RATE_LIMIT_MAX', 100),
    SUPABASE_URL: supabaseUrl,
    SUPABASE_ANON_KEY: String(input.SUPABASE_ANON_KEY || ''),
    SUPABASE_JWT_ISSUER: issuer,
    SUPABASE_JWKS_URL: jwksUrl,
    R2_ACCOUNT_ID: r2.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: r2.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: r2.R2_SECRET_ACCESS_KEY,
    R2_BUCKET: r2.R2_BUCKET,
    R2_PUBLIC_BASE_URL: r2.R2_PUBLIC_BASE_URL,
  };
}

export const configOptions: ConfigModuleOptions = { isGlobal: true, envFilePath: '.env', validate: validateEnv };
