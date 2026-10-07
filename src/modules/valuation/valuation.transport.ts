import type { FastifyInstance } from 'fastify';

export const VALUATION_PUBLIC_BODY_LIMIT = 16 * 1024;
export const VALUATION_ADMIN_BODY_LIMIT = 64 * 1024;
/** Bound body parsing before validation; other API modules keep their own limits. */
export function configureValuationTransport(server: FastifyInstance) {
  server.addHook('onRoute', route => {
    if (route.url.startsWith('/api/v1/valuation/')) route.bodyLimit = VALUATION_PUBLIC_BODY_LIMIT;
    else if (route.url.startsWith('/api/v1/admin/valuation/')) route.bodyLimit = VALUATION_ADMIN_BODY_LIMIT;
  });
}
