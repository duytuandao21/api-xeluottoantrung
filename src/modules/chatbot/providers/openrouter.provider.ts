import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatCompletionsProvider } from './chat-completions-provider.js';
@Injectable()
export class OpenRouterProvider extends ChatCompletionsProvider {
  readonly name = 'openrouter' as const;
  protected readonly endpoint = 'https://openrouter.ai/api/v1/chat/completions';
  protected readonly keyVariable = 'OPENROUTER_API_KEY';
  protected readonly modelVariable = 'OPENROUTER_MODEL';
  constructor(@Inject(ConfigService) config: ConfigService) { super(config); }
  protected extraBody() {
    return { provider: { allow_fallbacks: false, max_price: { prompt: 0, completion: 0, request: 0 } } };
  }
}
