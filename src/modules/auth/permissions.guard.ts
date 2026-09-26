import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ADMIN_KEY, PERMISSIONS_KEY, PUBLIC_KEY } from './auth.decorators.js';
import { AdminAccessService } from './admin-access.service.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(AdminAccessService) private readonly access: AdminAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets) ?? [];
    const adminRequired = this.reflector.getAllAndOverride<boolean>(ADMIN_KEY, targets) ?? false;
    if (!adminRequired && required.length === 0) return true;
    const user = context.switchToHttp().getRequest<FastifyRequest>().authUser;
    if (!user) throw new UnauthorizedException('Bearer access token required');
    const access = await this.access.forAuthUser(user.id);
    if (required.some((permission) => !access.permissions.includes(permission))) throw new ForbiddenException('Insufficient permission');
    user.adminAccess = access;
    return true;
  }
}
