import { InjectQueue } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bull';

@Injectable()
export class WebhookService {
  constructor(@InjectQueue('message-queue') private messageQueue: Queue) {}

  async addMessageToQueue(message: any) {
    await this.messageQueue.add('process-message', message);
  }
}
