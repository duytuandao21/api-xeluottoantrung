import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AdminAccessService } from '../auth/admin-access.service.js';
import { lookupConfig } from './lookups.service.js';

@Injectable()
export class LookupPermissionsGuard implements CanActivate {
  constructor(@Inject(AdminAccessService) private readonly access: AdminAccessService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.authUser) throw new UnauthorizedException('Bearer access token required');
    const resource = (request.params as { resource?: string }).resource ?? '';
    const config = lookupConfig(resource);
    const action = { GET: 'read', POST: 'create', PATCH: 'update', DELETE: 'delete' }[request.method];
    if (!action) throw new ForbiddenException('Unsupported lookup operation');
    const access = await this.access.forAuthUser(request.authUser.id);
    if (!access.permissions.includes(`${config.permission}.${action}`)) throw new ForbiddenException('Insufficient permission');
    request.authUser.adminAccess = access;
    return true;
  }
}
