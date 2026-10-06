import { Module } from '@nestjs/common';
import { ChatbotController } from './chatbot.controller.js';
import { ChatbotService } from './chatbot.service.js';
import { ChatRateGuard, ChatRateStore, MemoryChatRateStore } from './chatbot.rate-limit.js';
import { AIProviderFactory } from './providers/ai-provider.factory.js';
import { OpenRouterProvider } from './providers/openrouter.provider.js';
import { GroqProvider } from './providers/groq.provider.js';

@Module({ controllers: [ChatbotController], providers: [ChatbotService, AIProviderFactory, OpenRouterProvider, GroqProvider, ChatRateGuard, { provide: ChatRateStore, useClass: MemoryChatRateStore }] })
export class ChatbotModule {}
