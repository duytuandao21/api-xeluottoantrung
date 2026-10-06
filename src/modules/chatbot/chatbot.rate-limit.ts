import { CanActivate, ExecutionContext, HttpException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Replace this provider with a shared Redis implementation for multiple instances.
export abstract class ChatRateStore {
  abstract consume(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }>;
}
@Injectable()
export class MemoryChatRateStore extends ChatRateStore {
  private readonly entries = new Map<string, { hits: number; expires: number }>();
  private sweptAt = 0;
  async consume(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    if (now - this.sweptAt > 30000) {
      for (const [ip, entry] of this.entries) if (entry.expires <= now) this.entries.delete(ip);
      this.sweptAt = now;
    }
    let entry = this.entries.get(key);
    if (!entry || entry.expires <= now) {
      if (!entry && this.entries.size >= 10000) throw new ServiceUnavailableException('Trợ lý AI đang bận. Vui lòng thử lại sau.');
      entry = { hits: 0, expires: now + windowMs }; this.entries.set(key, entry);
    }
    entry.hits = Math.min(limit + 1, entry.hits + 1);
    return { allowed: entry.hits <= limit, retryAfter: Math.max(1, Math.ceil((entry.expires - now) / 1000)) };
  }
}
const normalizeIp = (ip: string) => ip.startsWith('::ffff:') ? ip.slice(7) : ip;
export function chatClientIp(request: FastifyRequest, trusted: string[]): string {
  const peer = normalizeIp(request.raw.socket.remoteAddress || request.ip);
  if (!trusted.includes(peer)) return peer;
  const header = request.headers['x-forwarded-for'];
  const chain = typeof header === 'string' ? header.split(',').map(ip => normalizeIp(ip.trim())) : [];
  if (!chain.length || chain.length > 20 || chain.some(ip => !isIP(ip))) return peer;
  // Work from the trusted server towards the client, never trust the first header blindly.
  return [...chain, peer].reverse().find(ip => !trusted.includes(ip)) || peer;
}
@Injectable()
export class ChatRateGuard implements CanActivate {
  constructor(@Inject(ChatRateStore) private readonly store: ChatRateStore, @Inject(ConfigService) private readonly config: ConfigService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const trusted = (this.config.get<string>('CHAT_TRUSTED_PROXY_IPS') || '').split(',').map(ip => normalizeIp(ip.trim())).filter(ip => isIP(ip));
    const result = await this.store.consume(chatClientIp(request, trusted), this.config.get<number>('CHAT_RATE_LIMIT') ?? 10, this.config.get<number>('CHAT_RATE_WINDOW_MS') ?? 600000);
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter);
      throw new HttpException('Bạn đã gửi khá nhiều câu hỏi trong thời gian ngắn. Vui lòng thử lại sau ít phút.', 429);
    }
    return true;
  }
}
