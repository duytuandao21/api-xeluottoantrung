import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthenticatedUser } from './auth.types.js';

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function verifyAsymmetricToken(token: string, jwks: JWTVerifyGetKey, issuer: string): Promise<AuthenticatedUser> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer, audience: 'authenticated', algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'],
  });
  if (typeof payload.sub !== 'string' || !USER_ID.test(payload.sub) || payload.role !== 'authenticated') throw new UnauthorizedException('Invalid access token');
  return {
    id: payload.sub,
    ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
    ...(typeof payload.session_id === 'string' ? { sessionId: payload.session_id } : {}),
  };
}

@Injectable()
export class JwtVerifierService {
  private readonly issuer: string;
  private readonly jwks: JWTVerifyGetKey;
  private readonly userEndpoint: string;
  private readonly anonKey: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.issuer = config.getOrThrow<string>('SUPABASE_JWT_ISSUER');
    this.jwks = createRemoteJWKSet(new URL(config.getOrThrow<string>('SUPABASE_JWKS_URL')), { timeoutDuration: 5_000 });
    this.userEndpoint = `${config.getOrThrow<string>('SUPABASE_URL')}/auth/v1/user`;
    this.anonKey = config.getOrThrow<string>('SUPABASE_ANON_KEY');
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    let alg: string | undefined;
    try { alg = decodeProtectedHeader(token).alg; } catch { throw new UnauthorizedException('Invalid access token'); }
    if (alg === 'HS256') return this.verifyLegacyToken(token);
    if (alg !== 'RS256' && alg !== 'ES256') throw new UnauthorizedException('Invalid access token');
    try {
      return await verifyAsymmetricToken(token, this.jwks, this.issuer);
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private async verifyLegacyToken(token: string): Promise<AuthenticatedUser> {
    if (!this.anonKey) throw new ServiceUnavailableException('Supabase publishable key is required for legacy JWT verification');
    let response: Response;
    try {
      response = await fetch(this.userEndpoint, { headers: { apikey: this.anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) });
    } catch { throw new ServiceUnavailableException('Supabase Auth is unavailable'); }
    if (!response.ok) throw new UnauthorizedException('Invalid access token');
    let user: unknown;
    try { user = await response.json(); } catch { throw new ServiceUnavailableException('Invalid Supabase Auth response'); }
    if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !USER_ID.test(user.id)) throw new UnauthorizedException('Invalid access token');
    return { id: user.id, ...('email' in user && typeof user.email === 'string' ? { email: user.email } : {}) };
  }
}
