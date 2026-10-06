import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Readable } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../auth/auth.decorators.js';
import { ChatRequestDto } from './chatbot.dto.js';
import { ChatRateGuard } from './chatbot.rate-limit.js';
import { ChatbotService } from './chatbot.service.js';

@ApiTags('Public chatbot') @Public() @Controller('chat')
export class ChatbotController {
  constructor(private readonly chatbot: ChatbotService) {}
  @Post() @HttpCode(200) @SkipThrottle() @UseGuards(ChatRateGuard)
  @ApiOperation({ summary: 'Stream automotive AI answers and Google Search sources' })
  async chat(@Body() input: ChatRequestDto, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const abort = new AbortController();
    const disconnected = () => abort.abort();
    reply.raw.once('close', disconnected);
    try {
      const events = await this.chatbot.open(input, abort.signal, request.id);
      async function* encoded() {
        try { for await (const event of events) yield `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`; }
        finally { reply.raw.removeListener('close', disconnected); abort.abort(); }
      }
      reply.header('Content-Type', 'text/event-stream; charset=utf-8').header('Cache-Control', 'no-cache, no-store, no-transform').header('X-Accel-Buffering', 'no');
      return reply.send(Readable.from(encoded()));
    } catch (error) { reply.raw.removeListener('close', disconnected); abort.abort(); throw error; }
  }
}
