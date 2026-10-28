import type { FastifyInstance, onRequestHookHandler } from 'fastify';
import { TV_MUSIC_MAX_BYTES } from '../content/tv-music.settings.js';

export function configureTVMusicTransport(server: FastifyInstance) {
  // Streaming parser: only audio/mpeg. JSON and all existing upload routes keep their parser/limits.
  server.addContentTypeParser('audio/mpeg', (_request, payload, done) => done(null, payload));
  server.addHook('onRoute', route => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes('PUT') || !/^\/api\/v1\/admin\/tv-music\/uploads\/:id$/.test(route.url)) return;
    route.bodyLimit = TV_MUSIC_MAX_BYTES;
    // Reject other MIME types before Fastify can buffer JSON up to this larger
    // streaming-only ceiling. DELETE and every other route keep their old limits.
    const check: onRequestHookHandler = (request, reply, done) => {
      if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'audio/mpeg') {
        void reply.code(415).send({ message: 'Upload nhạc phải dùng audio/mpeg.' }); return;
      }
      if (request.headers['content-length'] && (!Number.isSafeInteger(Number(request.headers['content-length'])) || Number(request.headers['content-length']) > TV_MUSIC_MAX_BYTES)) {
        void reply.code(413).send({ message: 'File nhạc vượt giới hạn 1 GB.' }); return;
      }
      done();
    };
    route.onRequest = [...(Array.isArray(route.onRequest) ? route.onRequest : route.onRequest ? [route.onRequest] : []), check];
  });
}
