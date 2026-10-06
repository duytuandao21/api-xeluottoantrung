import 'reflect-metadata';
import 'dotenv/config';
import { Logger, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateEnv } from '../src/config/env.js';
import { ChatbotService } from '../src/modules/chatbot/chatbot.service.js';
import { AIProviderFactory } from '../src/modules/chatbot/providers/ai-provider.factory.js';
import { OpenRouterProvider } from '../src/modules/chatbot/providers/openrouter.provider.js';
import { GroqProvider } from '../src/modules/chatbot/providers/groq.provider.js';

// Explicit operator command: one real request, selected env model only, no fallback.
async function main() {
  const config = new ConfigService(validateEnv(process.env));
  const providers = new AIProviderFactory(config, new OpenRouterProvider(config), new GroqProvider(config));
  const provider = providers.get();
  const service = new ChatbotService(config, providers);
  const started = Date.now(); let firstChunkMs: number | undefined; let chunks = 0; let characters = 0; let completed = false; let sourceCount = 0;
  const stream = await service.open({ message: 'Giải thích ngắn gọn ABS trên ô tô bằng tiếng Việt, tối đa ba câu.', history: [] }, new AbortController().signal, 'provider-smoke');
  for await (const event of stream) {
    if (event.event === 'content') { firstChunkMs ??= Date.now() - started; chunks++; characters += event.data.text.length; }
    else if (event.event === 'sources') sourceCount += event.data.sources.length;
    else if (event.event === 'done') completed = true;
    else if (event.event === 'error') { console.error(JSON.stringify(event.data)); process.exitCode = 1; return; }
  }
  if (!completed || !characters || sourceCount) throw new Error('Unexpected provider stream contract');
  console.log(JSON.stringify({ provider: provider.name, model: provider.model, firstChunkMs, durationMs: Date.now() - started, chunks, characters, sourceCount, completed }));
}
Logger.overrideLogger(false);
void main().catch(error => {
  console.error(error instanceof HttpException ? JSON.stringify(error.getResponse()) : error instanceof Error ? error.message : 'Provider smoke test failed.');
  process.exitCode = 1;
});
