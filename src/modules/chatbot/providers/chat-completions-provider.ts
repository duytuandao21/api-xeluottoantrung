import { ConfigService } from '@nestjs/config';
import { assertFreeModel } from '../../../config/ai-models.js';
import { AIProvider, AIProviderError, upstreamFailure, type AIRequest } from './ai-provider.js';
import { completionEvents } from './openai-stream.js';
export abstract class ChatCompletionsProvider extends AIProvider {
  constructor(protected readonly config: ConfigService) { super(); }
  protected abstract readonly endpoint: string;
  protected abstract readonly keyVariable: string;
  protected abstract readonly modelVariable: string;
  protected extraBody(): Record<string, unknown> { return {}; }
  get model(): string { return this.config.get<string>(this.modelVariable) || ''; }
  async open(input: AIRequest, signal: AbortSignal) {
    const key = this.config.get<string>(this.keyVariable);
    if (!key) throw new AIProviderError('AI_CONFIGURATION_ERROR', undefined, `${this.name} API key is missing (${this.keyVariable}).`);
    try { assertFreeModel(this.name, this.model); }
    catch { throw new AIProviderError('AI_CONFIGURATION_ERROR', undefined, 'Configured AI model is not an allowlisted free model.'); }
    const response = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${key}` }, signal,
      body: JSON.stringify({ model: this.model, stream: true, max_tokens: 2048,
        messages: [{ role: 'system', content: input.systemPrompt }, ...(input.history || []), { role: 'user', content: input.message }], ...this.extraBody() }),
    });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel();
      throw response.ok ? new AIProviderError('AI_PROVIDER_UNAVAILABLE') : upstreamFailure(response.status);
    }
    return completionEvents(response.body, signal);
  }
}
