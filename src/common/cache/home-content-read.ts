import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicContentController } from '../../modules/content/content.controller.js';

// Fixed public view only: no arbitrary groups, paths or query forwarding.
export const homeContentGroups = [
  'thiet-lap-nut-goi', 'thiet-lap-chinh-sach-dieu-kien', 'thiet-lap-mang-xa-hoi', 'thiet-lap-ung-dung',
  'thiet-lap-quy-trinh-ban-xe', 'thiet-lap-cac-buoc-mua-xe', 'thiet-lap-cac-buoc-ban-xe',
  'thiet-lap-cac-buoc-len-doi', 'thiet-lap-banner-dong-xe',
] as const;
export type HomeContentGroup = typeof homeContentGroups[number];
export const HOME_CONTENT_VIEW = 'public:home-content-view';
export const HomeContentView = () => SetMetadata(HOME_CONTENT_VIEW, true);
export type ContentFailure = { ok: false; status: number; retryAfterSeconds?: number };
export type HomeContentRead = { group: HomeContentGroup; context: ExecutionContext; headers: Map<string, unknown>; failure?: ContentFailure };
export const preparedHomeContent = Symbol('prepared-home-content');
export type HomeContentRequest = FastifyRequest & { [preparedHomeContent]?: HomeContentRead[] };

export function contentReadContext(request: FastifyRequest, group: HomeContentGroup): HomeContentRead {
  const headers = new Map<string, unknown>();
  // Reuse the original HTTP handler's metadata, tracker and cache policy without
  // an internal HTTP hop. Preserve Fastify getters (notably trusted request.ip).
  const child = new Proxy(request, { get(target, key) {
    if (key === 'url') return `/api/v1/content?group=${group}`;
    if (key === 'routeOptions') return { ...target.routeOptions, url: '/api/v1/content' };
    return Reflect.get(target, key, target) as unknown;
  } });
  const reply = { statusCode: 200, header: (name: string, value: unknown) => headers.set(name.toLowerCase(), value),
    getHeader: (name: string) => headers.get(name.toLowerCase()) } as unknown as FastifyReply;
  const context = new ExecutionContextHost([child, reply], PublicContentController, PublicContentController.prototype.list);
  context.setType('http');
  return { group, context, headers };
}
