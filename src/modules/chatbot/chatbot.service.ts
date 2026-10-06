import { BadRequestException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CHAT_SYSTEM_PROMPT } from './chatbot.prompt.js';
import type { ChatRequestDto } from './chatbot.dto.js';
import type { ChatEvent } from './chatbot.types.js';
import { AIProviderFactory } from './providers/ai-provider.factory.js';
import { AIProviderError, type AIChunk, type AIProvider } from './providers/ai-provider.js';

const unavailable = 'Xin lỗi, trợ lý AI đang tạm thời không thể phản hồi. Vui lòng thử lại sau.';
const limit = 'Trợ lý AI hiện đang đạt giới hạn sử dụng. Vui lòng thử lại sau.';
const timeoutMessage = 'Trợ lý AI phản hồi quá lâu. Vui lòng thử lại.';

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  constructor(@Inject(ConfigService) private readonly config: ConfigService, private readonly providers: AIProviderFactory) {}

  async open(input: ChatRequestDto, clientSignal: AbortSignal, requestId: string): Promise<AsyncIterable<ChatEvent>> {
    const history = input.history || [];
    if (history.reduce((total, item) => total + item.content.length, 0) > 20000) throw new BadRequestException('Lịch sử hội thoại quá dài. Hãy bắt đầu cuộc trò chuyện mới.');
    if (history.some((item, index) => item.role !== (index % 2 === 0 ? 'user' : 'assistant')) || history.length % 2 !== 0)
      throw new BadRequestException('Lịch sử hội thoại không hợp lệ.');
    const started = Date.now();
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), this.config.get<number>('CHAT_TIMEOUT_MS') ?? 30000);
    const signal = AbortSignal.any([clientSignal, timeout.signal]);
    const cleanup = () => clearTimeout(timer);
    let provider: AIProvider | undefined;
    try {
      provider = this.providers.get();
      const stream = await provider.open({ ...input, systemPrompt: CHAT_SYSTEM_PROMPT }, signal);
      return this.events(stream, provider, signal, clientSignal, timeout.signal, cleanup, requestId, started);
    } catch (error) {
      cleanup();
      const failure = this.failure(error, timeout.signal);
      if (!clientSignal.aborted) this.log(provider, requestId, started, failure);
      throw new HttpException({ code: failure.code, message: this.message(failure) }, failure.code === 'AI_TIMEOUT' ? 504 : 503);
    }
  }
  private failure(error: unknown, timeout: AbortSignal): AIProviderError {
    return timeout.aborted ? new AIProviderError('AI_TIMEOUT') : error instanceof AIProviderError ? error : new AIProviderError('AI_PROVIDER_UNAVAILABLE');
  }
  private message(failure: AIProviderError) {
    return failure.code === 'AI_RATE_LIMIT' ? limit : failure.code === 'AI_TIMEOUT' ? timeoutMessage : unavailable;
  }
  private log(provider: AIProvider | undefined, requestId: string, started: number, failure?: AIProviderError) {
    const entry = JSON.stringify({ requestId, provider: provider?.name || 'unconfigured', model: provider?.model || undefined,
      duration: Date.now() - started, status: failure ? 'error' : 'done', code: failure?.code, upstreamStatus: failure?.status,
      configuration: failure?.code === 'AI_CONFIGURATION_ERROR' ? failure.message : undefined });
    if (failure) this.logger.error(entry); else this.logger.log(entry);
  }
  private async *events(stream: AsyncIterable<AIChunk>, provider: AIProvider, signal: AbortSignal, client: AbortSignal, timeout: AbortSignal,
    cleanup: () => void, requestId: string, started: number): AsyncGenerator<ChatEvent> {
    try {
      for await (const chunk of stream) {
        if (signal.aborted) throw new AIProviderError('AI_STREAM_INTERRUPTED');
        if (chunk.type === 'content') yield { event: 'content', data: { text: chunk.text } };
        else {
          // These providers have no configured search tool. Never invent sources.
          yield { event: 'sources', data: { sources: [] } };
          yield { event: 'done', data: { truncated: chunk.truncated } };
          this.log(provider, requestId, started);
        }
      }
    } catch (error) {
      if (!client.aborted) {
        const failure = this.failure(error, timeout);
        this.log(provider, requestId, started, failure);
        yield { event: 'error', data: { code: failure.code, message: this.message(failure) } };
      }
    } finally { cleanup(); }
  }
}
