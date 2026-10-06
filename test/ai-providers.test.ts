import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { assertFreeModel, validateAIConfig } from '../src/config/ai-models.js';
import { validateEnv } from '../src/config/env.js';
import { AIProviderFactory } from '../src/modules/chatbot/providers/ai-provider.factory.js';
import { AIProviderError } from '../src/modules/chatbot/providers/ai-provider.js';
import { OpenRouterProvider } from '../src/modules/chatbot/providers/openrouter.provider.js';
import { GroqProvider } from '../src/modules/chatbot/providers/groq.provider.js';
import { ChatbotService } from '../src/modules/chatbot/chatbot.service.js';
import { CHAT_SYSTEM_PROMPT } from '../src/modules/chatbot/chatbot.prompt.js';

const configFor = (provider: 'openrouter' | 'groq') => new ConfigService({ AI_PROVIDER: provider,
  OPENROUTER_API_KEY: 'openrouter-test-secret', OPENROUTER_MODEL: 'qwen/qwen3.8-27b:free',
  GROQ_API_KEY: 'groq-test-secret', GROQ_MODEL: 'openai/gpt-oss-20b', GROQ_FREE_TIER_CONFIRMED: true, CHAT_TIMEOUT_MS: 2000 });
const factoryFor = (config: ConfigService) => new AIProviderFactory(config, new OpenRouterProvider(config), new GroqProvider(config));
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const text = (content: string, finish_reason: string | null = null) => event({ choices: [{ index: 0, delta: { content }, finish_reason }] });
const done = 'data: [DONE]\n\n';
const response = (body: string) => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });

test('free-only configuration rejects paid models, auto routers, unsupported providers and unconfirmed Groq', () => {
  const base = { DATABASE_URL: 'postgresql://test:test@localhost/test', SUPABASE_URL: 'https://test.supabase.co' };
  for (const model of ['openai/gpt-4o', 'qwen/qwen3.8-27b', 'unknown/paid:free', 'openrouter/free', 'openrouter/auto', 'qwen/qwen3.8-27b:free:online'])
    assert.throws(() => validateEnv({ ...base, AI_PROVIDER: 'openrouter', OPENROUTER_MODEL: model }), /only allowlisted free/);
  assert.throws(() => validateAIConfig({ AI_PROVIDER: 'gemini' }), /AI_PROVIDER/);
  assert.throws(() => validateAIConfig({ AI_PROVIDER: 'groq', GROQ_MODEL: 'unknown' }), /only allowlisted free/);
  assert.throws(() => validateAIConfig({ AI_PROVIDER: 'groq', GROQ_MODEL: 'openai/gpt-oss-20b' }), /Free Plan/);
  assert.throws(() => assertFreeModel('openrouter', ''), /only allowlisted free/);
  assert.equal(validateEnv({ ...base, AI_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'qwen/qwen3.8-27b:free' }).AI_PROVIDER, 'openrouter');
  assert.equal(validateEnv({ ...base, AI_PROVIDER: 'groq', GROQ_MODEL: 'openai/gpt-oss-20b', GROQ_FREE_TIER_CONFIRMED: 'true' }).GROQ_FREE_TIER_CONFIRMED, true);
  assert.equal(validateEnv(base).AI_PROVIDER, '', 'Unconfigured chatbot does not break other API modules');
  const config = configFor('openrouter');
  config.set('OPENROUTER_MODEL', 'openai/gpt-4o');
  assert.throws(() => factoryFor(config).get(), /allowlisted free/);
});

test('OpenRouter and Groq produce identical streamed Markdown with no sources or model fallback', async () => {
  const original = globalThis.fetch;
  try {
    for (const selected of ['openrouter', 'groq'] as const) {
      const config = configFor(selected); const service = new ChatbotService(config, factoryFor(config));
      let calls = 0;
      globalThis.fetch = async (url, init) => {
        calls++;
        assert.equal(String(url), selected === 'openrouter' ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.groq.com/openai/v1/chat/completions');
        assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${selected}-test-secret`);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, selected === 'openrouter' ? 'qwen/qwen3.8-27b:free' : 'openai/gpt-oss-20b');
        assert.equal(body.stream, true); assert.equal(body.max_tokens, 2048);
        assert.equal(body.messages[0].content, CHAT_SYSTEM_PROMPT);
        assert.equal(body.messages[2].role, 'assistant');
        assert.equal(body.tools, undefined); assert.equal(body.plugins, undefined); assert.equal(body.models, undefined); assert.equal(body.service_tier, undefined);
        if (selected === 'openrouter') assert.deepEqual(body.provider, { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0 } });
        else assert.equal(body.provider, undefined);
        return response(': keepalive\n\n' + event({ choices: [{ index: 0, delta: { reasoning: 'private reasoning' } }] })
          + text('**So sánh**\n\n| Xe | ABS |\n| --- | --- |\n') + text('| A | Có |', 'stop') + event({ choices: [], usage: { completion_tokens: 10 } }) + done);
      };
      const stream = await service.open({ message: 'So sánh xe', history: [{ role: 'user', content: 'Xe A?' }, { role: 'assistant', content: 'Bạn muốn hỏi gì?' }] }, new AbortController().signal, 'test');
      const events = []; for await (const chunk of stream) events.push(chunk);
      assert.deepEqual(events.map(chunk => chunk.event), ['content', 'content', 'sources', 'done']);
      assert.deepEqual(events[2], { event: 'sources', data: { sources: [] } });
      assert(!JSON.stringify(events).includes('secret')); assert(!JSON.stringify(events).includes('private reasoning'));
      assert.equal(calls, 1);
      for (const status of [401, 429, 503]) {
        calls = 0; globalThis.fetch = async () => { calls++; return new Response('private upstream error', { status }); };
        await assert.rejects(service.open({ message: 'ABS?' }, new AbortController().signal, 'test'), error => {
          const body = (error as { getResponse(): { code: string; message: string } }).getResponse();
          assert.equal(body.code, status === 401 ? 'AI_CONFIGURATION_ERROR' : status === 429 ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_UNAVAILABLE');
          assert(!body.message.includes('private')); return true;
        });
        assert.equal(calls, 1, 'No retry, provider switch or paid model fallback');
      }
    }
  } finally { globalThis.fetch = original; }
});

test('provider stream errors, missing keys and denied Groq never leak raw errors or call another model', async () => {
  const original = globalThis.fetch;
  try {
    for (const selected of ['openrouter', 'groq'] as const) {
      const config = configFor(selected); const service = new ChatbotService(config, factoryFor(config));
      for (const body of [text('Chưa xong') + event({ error: { code: 429, message: 'secret' } }), text('Chưa xong') + 'data: {bad}\n\n', text('Không có finish') + done]) {
        globalThis.fetch = async () => response(body);
        const stream = await service.open({ message: 'ABS?' }, new AbortController().signal, 'test');
        const events = []; for await (const item of stream) events.push(item);
        assert.equal(events.at(-1)?.event, 'error'); assert(!events.some(item => item.event === 'done'));
        assert(!JSON.stringify(events).includes('secret'));
      }
      let called = false; globalThis.fetch = async () => { called = true; throw Error('Should not call provider'); };
      config.set(selected === 'openrouter' ? 'OPENROUTER_API_KEY' : 'GROQ_API_KEY', '');
      await assert.rejects(factoryFor(config).get().open({ message: 'ABS?', systemPrompt: CHAT_SYSTEM_PROMPT }, new AbortController().signal), /API key is missing/);
      assert.equal(called, false);
    }
    const config = configFor('groq'); config.set('GROQ_FREE_TIER_CONFIRMED', false);
    assert.throws(() => factoryFor(config).get(), /Free Plan/);
    await assert.rejects(new GroqProvider(config).open({ message: 'ABS?', systemPrompt: CHAT_SYSTEM_PROMPT }, new AbortController().signal), AIProviderError);
  } finally { globalThis.fetch = original; }
});
