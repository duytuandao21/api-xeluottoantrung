import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, ForbiddenException, Get, Module, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AdminAccessService } from '../src/modules/auth/admin-access.service.js';
import { AdminMeController } from '../src/modules/auth/admin-me.controller.js';
import { Permissions } from '../src/modules/auth/auth.decorators.js';
import type { AdminAccess } from '../src/modules/auth/auth.types.js';
import { JwtAuthGuard } from '../src/modules/auth/jwt-auth.guard.js';
import { JwtVerifierService, verifyAsymmetricToken } from '../src/modules/auth/jwt-verifier.service.js';
import { PermissionsGuard } from '../src/modules/auth/permissions.guard.js';
import { DatabaseService } from '../src/database/database.service.js';

const issuer = 'https://test-project.supabase.co/auth/v1';
const authUserId = '9d2a096e-afd4-4acc-abd0-3d8587ba7cf9';

@Controller('probe')
class PermissionProbeController {
  @Get()
  @Permissions('car.delete')
  check(): { ok: boolean } { return { ok: true }; }
}

test('JWT and RBAC protect admin routes', async () => {
  const pair = await generateKeyPair('RS256');
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = 'test-key';
  jwk.alg = 'RS256';
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const sign = (privateKey: typeof pair.privateKey, tokenIssuer = issuer) => new SignJWT({ role: 'authenticated', email: 'admin@example.test' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(tokenIssuer).setAudience('authenticated').setSubject(authUserId)
    .setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const validToken = await sign(pair.privateKey);
  const otherPair = await generateKeyPair('RS256');
  const invalidToken = await sign(otherPair.privateKey);
  await assert.rejects(verifyAsymmetricToken(invalidToken, jwks, issuer));
  await assert.rejects(verifyAsymmetricToken(await sign(pair.privateKey, 'https://other.example/auth/v1'), jwks, issuer));
  assert.equal((await verifyAsymmetricToken(validToken, jwks, issuer)).id, authUserId);

  let access: AdminAccess | null = null;
  const verifiedAccess: AdminAccess = {
    profile: { id: '42622b7b-934b-4dc7-8800-4f2f548e9260', authUserId, fullName: 'Admin Test', email: 'admin@example.test', phone: null, status: 'active', createdAt: new Date(), updatedAt: new Date() },
    roles: ['CONTENT_EDITOR'], permissions: ['content.read'],
  };

  @Module({
    controllers: [AdminMeController, PermissionProbeController],
    providers: [
      { provide: DatabaseService, useValue: { db: {} } },
      { provide: JwtVerifierService, useValue: { verify: async (token: string) => {
        try { return await verifyAsymmetricToken(token, jwks, issuer); }
        catch { throw new UnauthorizedException('Invalid access token'); }
      } } },
      { provide: AdminAccessService, useValue: { forAuthUser: async (id: string) => {
        assert.equal(id, authUserId);
        if (!access) throw new ForbiddenException('Active admin profile required');
        return access;
      } } },
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: PermissionsGuard },
    ],
  })
  class TestAuthModule {}

  const app = await NestFactory.create<NestFastifyApplication>(TestAuthModule, new FastifyAdapter(), { logger: false });
  try {
    app.setGlobalPrefix('api/v1');
    await app.init();
    const server = app.getHttpAdapter().getInstance();
    const missing = await server.inject({ method: 'GET', url: '/api/v1/admin/me' });
    assert.equal(missing.statusCode, 401);
    const invalid = await server.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { authorization: `Bearer ${invalidToken}` } });
    assert.equal(invalid.statusCode, 401);
    const noProfile = await server.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { authorization: `Bearer ${validToken}` } });
    assert.equal(noProfile.statusCode, 403);
    access = verifiedAccess;
    const me = await server.inject({ method: 'GET', url: '/api/v1/admin/me', headers: { authorization: `Bearer ${validToken}` } });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json().roles, ['CONTENT_EDITOR']);
    assert.deepEqual(me.json().permissions, ['content.read']);
    assert.equal(me.json().profile.authUserId, authUserId);
    const denied = await server.inject({ method: 'GET', url: '/api/v1/probe', headers: { authorization: `Bearer ${validToken}` } });
    assert.equal(denied.statusCode, 403);
    access = { ...verifiedAccess, permissions: ['car.delete'] };
    const allowed = await server.inject({ method: 'GET', url: '/api/v1/probe', headers: { authorization: `Bearer ${validToken}` } });
    assert.equal(allowed.statusCode, 200);
  } finally {
    await app.close();
  }
});
