import type { ChatRequestDto } from '../chatbot.dto.js';
import type { AIProviderName } from '../../../config/ai-models.js';
export type AIRequest = ChatRequestDto & { systemPrompt: string };
export type AIChunk = { type: 'content'; text: string } | { type: 'done'; truncated: boolean };
export abstract class AIProvider {
  abstract readonly name: AIProviderName;
  abstract readonly model: string;
  abstract open(input: AIRequest, signal: AbortSignal): Promise<AsyncIterable<AIChunk>>;
}
export type AIErrorCode = 'AI_CONFIGURATION_ERROR' | 'AI_RATE_LIMIT' | 'AI_PROVIDER_UNAVAILABLE' | 'AI_TIMEOUT' | 'AI_STREAM_INTERRUPTED' | 'AI_OUTPUT_LIMIT';
export class AIProviderError extends Error {
  constructor(readonly code: AIErrorCode, readonly status?: number, detail: string = code) { super(detail); }
}
export function upstreamFailure(status?: number): AIProviderError {
  return new AIProviderError(status === 401 || status === 403 || status === 400 || status === 404 ? 'AI_CONFIGURATION_ERROR'
    : status === 429 || status === 402 ? 'AI_RATE_LIMIT' : status === 408 || status === 504 ? 'AI_TIMEOUT' : 'AI_PROVIDER_UNAVAILABLE', status);
}
