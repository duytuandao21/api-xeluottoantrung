import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from './auth.types.js';

export const PUBLIC_KEY = 'auth:isPublic';
export const ADMIN_KEY = 'auth:adminAccess';
export const PERMISSIONS_KEY = 'auth:permissions';

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const AdminAccessRequired = () => SetMetadata(ADMIN_KEY, true);
export const Permissions = (...codes: string[]) => SetMetadata(PERMISSIONS_KEY, codes);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedUser | undefined => {
  return context.switchToHttp().getRequest<FastifyRequest>().authUser;
});
