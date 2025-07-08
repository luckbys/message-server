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

    // Extrair dados do payload da EvolutionAPI
    const payload = job.data;
    const messageData = payload.data || payload;
    
    // Extrair ID do contato WhatsApp
    const whatsappContactId = messageData.key?.remoteJid || messageData.from || messageData.to;
    const contactName = messageData.pushName || messageData.notifyName || 'Desconhecido';
    
    // Buscar ou criar conversa
    let conversationId = null;
    if (whatsappContactId) {
      const { data: existingConversation } = await this.supabase
        .from('conversations')
        .select('id')
        .eq('whatsapp_contact_id', whatsappContactId)
        .single();
      
      if (existingConversation) {
        conversationId = existingConversation.id;
      } else {
        // Criar nova conversa
        const { data: newConversation } = await this.supabase
          .from('conversations')
          .insert([{
            whatsapp_contact_id: whatsappContactId,
            contact_name: contactName
          }])
          .select('id')
          .single();
        
        conversationId = newConversation?.id;
      }
    }
    
    // Mapear campos conforme estrutura da EvolutionAPI
    const messageToSave = {
      content: messageData,
      sender: messageData.key?.fromMe ? 'bot' : 'user',
      status: messageData.status || 'received',
      supabase_message_id: messageData.key?.id || messageData.id,
      conversation_id: conversationId,
    };

    const { data, error } = await this.supabase
      .from('messages')
      .insert([messageToSave]);

    if (error) {
      console.error('Error saving message to Supabase:', error);
    } else {
      console.log('Message saved to Supabase:', data);
    }
  }
}
