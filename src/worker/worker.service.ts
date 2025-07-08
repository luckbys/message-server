import { Process, Processor } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Job } from 'bull';

@Injectable()
@Processor('message-queue')
export class WorkerService {
  private supabase: SupabaseClient;

  constructor(private configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_KEY');
    if (!url || !key) {
      throw new Error('SUPABASE_URL ou SUPABASE_KEY não definidos');
    }
    this.supabase = createClient(url, key);
  }

  @Process('process-message')
  async processMessage(job: Job<any>) {
    console.log('Processing message:', job.data);

    const { data, error } = await this.supabase
      .from('messages')
      .insert([{ content: job.data }]);

    if (error) {
      console.error('Error saving message to Supabase:', error);
    } else {
      console.log('Message saved to Supabase:', data);
    }
  }
}
