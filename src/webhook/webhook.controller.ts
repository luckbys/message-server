import { Controller, Post, Body, Get } from '@nestjs/common';
import { WebhookService } from './webhook.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  handleWebhook(@Body() payload: any) {
    this.webhookService.addMessageToQueue(payload);
    return { status: 'ok' };
  }

  @Get()
  ping() {
    return { status: 'ok' };
  }
}
