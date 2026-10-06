import type { FastifyInstance } from 'fastify';

export const CHAT_BODY_LIMIT = 65536;
export function configureChatTransport(server: FastifyInstance) {
  server.addHook('onRoute', route => {
    if (route.url === '/api/v1/chat' && route.method === 'POST') route.bodyLimit = CHAT_BODY_LIMIT;
  });
}
