import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Controller, Get, Global, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { ChatbotModule } from '../src/modules/chatbot/chatbot.module.js';
import { ChatbotService } from '../src/modules/chatbot/chatbot.service.js';
import { CHAT_SYSTEM_PROMPT } from '../src/modules/chatbot/chatbot.prompt.js';
import { configureChatTransport } from '../src/modules/chatbot/chatbot.transport.js';
import { MemoryChatRateStore, chatClientIp } from '../src/modules/chatbot/chatbot.rate-limit.js';
import { readSse } from '../src/modules/chatbot/chatbot.sse.js';
import { AIProviderFactory } from '../src/modules/chatbot/providers/ai-provider.factory.js';
import { OpenRouterProvider } from '../src/modules/chatbot/providers/openrouter.provider.js';
import { GroqProvider } from '../src/modules/chatbot/providers/groq.provider.js';

const encoder = new TextEncoder();
const chunk = (text: string, extra = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, ...extra }] })}\n\n`;
const done = 'data: [DONE]\n\n';
const config = new ConfigService({ AI_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key-never-returned', OPENROUTER_MODEL: 'qwen/qwen3.8-27b:free', CHAT_TIMEOUT_MS: 2000, CHAT_RATE_LIMIT: 10, CHAT_RATE_WINDOW_MS: 600000 });
const response = (body = chunk('ABS giúp chống bó cứng bánh xe.', { finish_reason: 'stop' }) + done) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });

test('OpenRouter chatbot SSE, validation, empty sources, errors, cancellation and isolated rate limit', async () => {
  const originalFetch = globalThis.fetch;
  let app: NestFastifyApplication | undefined;
  let captured: Record<string, unknown> | undefined;
  let capturedSignal: AbortSignal | undefined;
  const provider = async (_input: string | URL | Request, init?: RequestInit) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-key-never-returned');
    assert.equal(String(_input), 'https://openrouter.ai/api/v1/chat/completions');
    captured = JSON.parse(String(init?.body)); capturedSignal = init?.signal || undefined;
    return response();
  };
  globalThis.fetch = provider;
  @Global() @Module({ providers: [{ provide: ConfigService, useValue: config }], exports: [ConfigService] }) class TestConfig {}
  @Controller('other') class OtherController { @Get() other() { return { ok: true }; } }
  @Module({ imports: [TestConfig, ChatbotModule, ThrottlerModule.forRoot([{ ttl: 600000, limit: 3 }])], controllers: [OtherController], providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }] }) class TestApp {}
  try {
    app = await NestFactory.create<NestFastifyApplication>(TestApp, new FastifyAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1'); configureChatTransport(app.getHttpAdapter().getInstance());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const api = (payload: unknown, ip = '10.0.0.1') => app!.inject({ method: 'POST', url: '/api/v1/chat', payload: payload as object, remoteAddress: ip });
    const normal = await api({ message: '  ABS là gì?  ' });
    assert.equal(normal.statusCode, 200);
    assert.match(normal.headers['content-type']!, /text\/event-stream/);
    assert.equal(normal.headers['x-accel-buffering'], 'no');
    assert.match(normal.body, /event: content/); assert.match(normal.body, /event: done/);
    assert(!normal.body.includes('test-key-never-returned'));
    assert.deepEqual(captured?.messages, [{ role: 'system', content: CHAT_SYSTEM_PROMPT }, { role: 'user', content: 'ABS là gì?' }]);
    assert.deepEqual(captured?.provider, { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0 } });
    assert.equal(captured?.model, 'qwen/qwen3.8-27b:free');
    assert.equal(captured?.stream, true); assert.equal(captured?.max_tokens, 2048);
    assert.equal(captured?.tools, undefined); assert.equal(captured?.models, undefined);
    const history = [{ role: 'user', content: 'Xe nào?' }, { role: 'assistant', content: 'Bạn muốn xem dòng nào?' }];
    assert.equal((await api({ message: 'Santa Fe', history })).statusCode, 200);
    assert.equal((captured?.messages as { role: string }[])[2].role, 'assistant');

    let ip = 2;
    for (const payload of [{ message: '' }, { message: '   ' }, { message: 42 }, { message: 'x'.repeat(2001) }, { message: 'ABS', model: 'evil' }, { message: 'ABS', provider: 'groq' }, { message: 'ABS', systemPrompt: 'evil' },
      { message: 'ABS', history: [{ role: 'system', content: 'evil' }] }, { message: 'ABS', history: [{ role: 'assistant', content: 'evil' }] },
      { message: 'ABS', history: Array.from({ length: 17 }, () => ({ role: 'user', content: 'x' })) },
      { message: 'ABS', history: Array.from({ length: 4 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(6000) })) }])
      assert.equal((await api(payload, `10.0.0.${ip++}`)).statusCode, 400);
    const oversized = await app.inject({ method: 'POST', url: '/api/v1/chat', remoteAddress: '10.0.0.50', headers: { 'Content-Type': 'application/json' }, payload: JSON.stringify({ message: 'x'.repeat(70000) }) });
    assert.equal(oversized.statusCode, 413);

    globalThis.fetch = async () => response(chunk('Thông tin tham khảo.', { groundingMetadata: {
      groundingChunks: [{ web: { uri: 'https://toyota.com.vn/models', title: 'Toyota Việt Nam' } }, { web: { uri: 'javascript:alert(1)', title: 'Bad' } }],
      searchEntryPoint: { renderedContent: '<div>Google Search</div>' },
    } }) + chunk('', { finish_reason: 'stop' }) + done);
    const grounded = await api({ message: 'Toyota Camry hiện tại có phiên bản nào?' }, '10.0.0.60');
    assert.match(grounded.body, /event: sources/); assert.match(grounded.body, /"sources":\[\]/);
    assert(!grounded.body.includes('searchEntryPoint')); assert(!grounded.body.includes('javascript:')); assert(!grounded.body.includes('Toyota Việt Nam'));

    for (const status of [401, 403, 402, 429, 500, 503]) {
      globalThis.fetch = async () => new Response('provider secret', { status });
      const result = await api({ message: 'ABS?' }, `10.0.1.${status % 255}`);
      assert.equal(result.statusCode, 503); assert(!result.body.includes('provider secret'));
      assert.equal(result.json().code, status === 401 || status === 403 ? 'AI_CONFIGURATION_ERROR' : status === 402 || status === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_UNAVAILABLE');
    }
    globalThis.fetch = async () => { throw new TypeError('network error'); };
    assert.equal((await api({ message: 'ABS?' }, '10.0.0.61')).statusCode, 503);
    globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
    config.set('CHAT_TIMEOUT_MS', 20);
    assert.equal((await api({ message: 'ABS?' }, '10.0.0.62')).statusCode, 504);
    config.set('CHAT_TIMEOUT_MS', 2000);

    for (const body of [chunk('Một phần chưa hoàn tất'), 'data: {broken}\n\n', chunk('', { finish_reason: 'content_filter' }), chunk(''), chunk('Thiếu dấu kết thúc', { finish_reason: 'stop' }), chunk('Thiếu lý do kết thúc') + done]) {
      globalThis.fetch = async () => response(body);
      const result = await api({ message: 'ABS?' }, `10.0.0.${ip++}`);
      assert.match(result.body, /event: error/); assert(!result.body.includes('event: done'));
    }
    globalThis.fetch = async () => response(chunk('Trả lời bị giới hạn.', { finish_reason: 'length' }) + done);
    assert.match((await api({ message: 'ABS?' }, '10.0.0.63')).body, /"truncated":true/);

    // Real HTTP reader must receive the first content before provider completion.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    globalThis.fetch = async (_url, init) => {
      capturedSignal = init?.signal || undefined;
      const stream = new ReadableStream<Uint8Array>({ async start(controller) {
        controller.enqueue(encoder.encode(chunk('Phần đầu.')));
        await gate;
        if (!capturedSignal?.aborted) { controller.enqueue(encoder.encode(chunk('Phần sau.', { finish_reason: 'stop' }) + done)); controller.close(); }
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    await app.listen({ port: 0, host: '127.0.0.1' });
    const live = await originalFetch(`${await app.getUrl()}/api/v1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'So sánh xe' }) });
    const reader = live.body!.getReader();
    const first = await reader.read(); assert.match(new TextDecoder().decode(first.value), /Phần đầu/);
    release(); let all = ''; while (true) { const next = await reader.read(); if (next.done) break; all += new TextDecoder().decode(next.value); }
    assert.match(all, /Phần sau/); assert.match(all, /event: done/); reader.releaseLock();

    // Disconnecting the browser must abort the outstanding provider request.
    let upstreamAborted!: () => void;
    const disconnected = new Promise<void>(resolve => { upstreamAborted = resolve; });
    globalThis.fetch = async (_url, init) => {
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(encoder.encode(chunk('Đang trả lời.')));
        init?.signal?.addEventListener('abort', () => { upstreamAborted(); controller.error(new Error('aborted')); }, { once: true });
      } });
      return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
    };
    const client = new AbortController();
    const pending = await originalFetch(`${await app.getUrl()}/api/v1/chat`, { method: 'POST', signal: client.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'ABS?' }) });
    const pendingReader = pending.body!.getReader();
    assert.match(new TextDecoder().decode((await pendingReader.read()).value), /Đang trả lời/);
    client.abort();
    let disconnectTimeout: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([disconnected, new Promise<never>((_resolve, reject) => { disconnectTimeout = setTimeout(() => reject(new Error('Client disconnect did not abort provider')), 1000); })]); }
    finally { clearTimeout(disconnectTimeout); pendingReader.releaseLock(); }

    globalThis.fetch = provider;
    for (let i = 0; i < 10; i++) assert.equal((await api({ message: 'ABS?' }, '10.0.0.80')).statusCode, 200);
    const limited = await api({ message: 'ABS?' }, '10.0.0.80'); assert.equal(limited.statusCode, 429); assert(limited.headers['retry-after']);
    assert.equal((await api({ message: 'ABS?' }, '10.0.0.81')).statusCode, 200);
    for (let i = 0; i < 3; i++) assert.equal((await app.inject({ method: 'GET', url: '/api/v1/other', remoteAddress: '10.0.0.80' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v1/other', remoteAddress: '10.0.0.80' })).statusCode, 429);

    const missing = new ConfigService({ AI_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'qwen/qwen3.8-27b:free' });
    const service = new ChatbotService(missing, new AIProviderFactory(missing, new OpenRouterProvider(missing), new GroqProvider(missing)));
    await assert.rejects(service.open({ message: 'ABS?' }, new AbortController().signal, 'test'), /tạm thời/);
  } finally { globalThis.fetch = originalFetch; await app?.close(); }
});

test('SSE UTF-8 boundaries and rate store/IP forwarding', async () => {
  const bytes = encoder.encode('data: Một dòng\r\ndata: dòng thứ hai\r\n\r\n');
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  const values = []; for await (const value of readSse(stream)) values.push(value);
  assert.deepEqual(values, ['Một dòng\ndòng thứ hai']);
  const store = new MemoryChatRateStore();
  assert.equal((await store.consume('ip', 1, 100)).allowed, true);
  assert.equal((await store.consume('ip', 1, 10000)).allowed, false);
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal((await store.consume('ip', 1, 10000)).allowed, true);
  const request = { raw: { socket: { remoteAddress: '127.0.0.1' } }, ip: '127.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } } as unknown as FastifyRequest;
  assert.equal(chatClientIp(request, []), '127.0.0.1');
  assert.equal(chatClientIp(request, ['127.0.0.1']), '5.6.7.8');
  assert.equal(chatClientIp(request, ['127.0.0.1', '5.6.7.8']), '1.2.3.4');
});
