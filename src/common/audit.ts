import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../modules/auth/auth.types.js';

export type AuditContext = {
  actorProfileId: string;
  ipAddress: string;
  userAgent: string | null;
  requestId: string;
};

export function auditContext(request: FastifyRequest, user: AuthenticatedUser): AuditContext {
  if (!user.adminAccess) throw new Error('Admin access was not resolved');
  return {
    actorProfileId: user.adminAccess.profile.id,
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    requestId: request.id,
  };
}
