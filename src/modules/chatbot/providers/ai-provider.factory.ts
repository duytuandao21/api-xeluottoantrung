import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { assertFreeModel } from '../../../config/ai-models.js';
import { AIProviderError, type AIProvider } from './ai-provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';
import { GroqProvider } from './groq.provider.js';
@Injectable()
export class AIProviderFactory {
  constructor(@Inject(ConfigService) private readonly config: ConfigService, private readonly openrouter: OpenRouterProvider, private readonly groq: GroqProvider) {}
  get(): AIProvider {
    const selected = this.config.get<string>('AI_PROVIDER');
    const provider = selected === 'openrouter' ? this.openrouter : selected === 'groq' ? this.groq : undefined;
    if (!provider) throw new AIProviderError('AI_CONFIGURATION_ERROR', undefined, 'AI_PROVIDER must be configured as openrouter or groq.');
    if (selected === 'groq' && this.config.get<boolean>('GROQ_FREE_TIER_CONFIRMED') !== true) throw new AIProviderError('AI_CONFIGURATION_ERROR', undefined, 'Groq requires a confirmed Free Plan.');
    if (provider.model) {
      try { assertFreeModel(provider.name, provider.model); }
      catch { throw new AIProviderError('AI_CONFIGURATION_ERROR', undefined, 'Configured AI model is not an allowlisted free model.'); }
    }
    return provider;
  }
}
