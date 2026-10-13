import type { FastifyInstance } from 'fastify';
export function configureOwnershipTransport(server: FastifyInstance) {
  server.addHook('onRoute', route => {
    if (/^\/api\/v1\/cars\/[^/]+\/ownership-/.test(route.url)) route.bodyLimit = 8192;
    else if (route.url.startsWith('/api/v1/admin/ownership')) route.bodyLimit = 65536;
  });
}
