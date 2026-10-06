import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionsProvider } from './chat-completions-provider.js';
import { AIProviderError } from './ai-provider.js';
@Injectable()
export class GroqProvider extends ChatCompletionsProvider {
  readonly name = 'groq' as const;
  protected readonly endpoint = 'https://api.groq.com/openai/v1/chat/completions';
  protected readonly keyVariable = 'GROQ_API_KEY';
  protected readonly modelVariable = 'GROQ_MODEL';
  constructor(@Inject(ConfigService) config: ConfigService) { super(config); }
  protected extraBody() {
    if (this.config.get<boolean>('GROQ_FREE_TIER_CONFIRMED') !== true) throw new AIProviderError('AI_CONFIGURATION_ERROR', undefined, 'Groq Free Plan has not been confirmed.');
    // No Flex/Performance tier, tools, browser search or billing endpoints.
    return {};
  }
}
