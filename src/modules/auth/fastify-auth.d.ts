import 'fastify';
import type { AuthenticatedUser } from './auth.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}
