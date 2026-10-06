import { readSse } from '../chatbot.sse.js';
import { AIProviderError, upstreamFailure, type AIChunk } from './ai-provider.js';
type CompletionChunk = {
  error?: { code?: number | string };
  choices?: { index?: number; delta?: { content?: string }; finish_reason?: string | null }[];
};
// Both providers use Chat Completions SSE. Ignore reasoning and usage-only chunks.
export async function* completionEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<AIChunk> {
  let size = 0; let finish: string | undefined; let ended = false;
  try {
    for await (const data of readSse(body)) {
      if (signal.aborted) throw new AIProviderError('AI_STREAM_INTERRUPTED');
      if (data === '[DONE]') { ended = true; break; }
      const chunk = JSON.parse(data) as CompletionChunk;
      if (chunk.error) {
        const status = Number(chunk.error.code);
        if (Number.isInteger(status) && status >= 400 && status <= 599) throw upstreamFailure(status);
        throw new AIProviderError(chunk.error.code === 'rate_limit_exceeded' ? 'AI_RATE_LIMIT' : 'AI_PROVIDER_UNAVAILABLE');
      }
      const choice = chunk.choices?.find(item => item.index === undefined || item.index === 0);
      if (!choice) continue;
      if (choice.finish_reason) finish = choice.finish_reason;
      if (finish && !['stop', 'length'].includes(finish)) throw new AIProviderError('AI_PROVIDER_UNAVAILABLE');
      const text = choice.delta?.content;
      if (typeof text === 'string' && text) {
        size += text.length;
        if (size > 32000) throw new AIProviderError('AI_OUTPUT_LIMIT');
        yield { type: 'content', text };
      }
    }
    if (signal.aborted || !size || !ended || !['stop', 'length'].includes(finish || '')) throw new AIProviderError('AI_STREAM_INTERRUPTED');
    yield { type: 'done', truncated: finish === 'length' };
  } catch (error) {
    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError('AI_STREAM_INTERRUPTED');
  }
}
