import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HooksService } from './hooks.service.js';
import { WebhookDto } from './hooks.dto.js';
import { WebhookSignatureGuard } from './webhook-signature.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@ApiTags('hooks')
@Controller('hooks')
export class HooksController {
  constructor(private readonly hooksService: HooksService) {}

  @Post('webhook')
  @HttpCode(200)
  @UseGuards(WebhookSignatureGuard)
  async webhook(@Body() dto: WebhookDto) {
    const isNew = await this.hooksService.record('webhook', dto.eventId, {
      eventType: dto.eventType,
      ...dto.payload,
    });
    return { received: true, duplicate: !isNew };
  }

  @Get('events')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  events() {
    return this.hooksService.latest();
  }
}
