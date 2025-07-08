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
    
    // Extrair dados do WhatsApp
    const whatsappChatId = messageData.key?.remoteJid || messageData.from || messageData.to;
    const senderPhone = messageData.key?.remoteJid || messageData.from || messageData.sender;
    const contactName = messageData.pushName || messageData.notifyName || 'Desconhecido';
    const isFromMe = messageData.key?.fromMe || false;
    const instanceId = messageData.instanceId || payload.instanceId || 'default';
    
    console.log('Dados extraídos:', {
      whatsappChatId,
      senderPhone,
      contactName,
      isFromMe,
      instanceId
    });
    
    // Buscar ou criar usuário (sender)
    let senderId = null;
    if (senderPhone) {
      // Limpar telefone para busca consistente
      const cleanPhone = senderPhone.replace('@s.whatsapp.net', '');
      
      console.log('Buscando usuário com telefone:', cleanPhone);
      const { data: existingUser, error: searchError } = await this.supabase
        .from('users')
        .select('id')
        .eq('phone', cleanPhone)
        .single();
      
      if (searchError && searchError.code !== 'PGRST116') {
        console.error('Erro ao buscar usuário:', searchError);
      }
      
      console.log('Usuário existente encontrado:', existingUser);
      
      if (existingUser) {
        senderId = existingUser.id;
      } else {
        // Criar novo usuário
        const safeEmail = `user_${cleanPhone.replace(/\D/g, '')}@temp.whatsapp`;
        
        const newUserData = {
          name: contactName,
          phone: cleanPhone,
          email: safeEmail,
          role: isFromMe ? 'agent' : 'customer'
        };
        console.log('Criando novo usuário:', newUserData);
        
        const { data: newUser, error } = await this.supabase
          .from('users')
          .insert([newUserData])
          .select('id')
          .single();
        
        if (error) {
          console.error('Erro ao criar usuário:', error);
          
          // Tentar uma abordagem mais simples se falhar
          console.log('Tentando criar usuário com dados mínimos...');
          const minimalUserData = {
            name: contactName || 'Usuário WhatsApp',
            email: `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}@whatsapp.local`,
            phone: cleanPhone
          };
          
          const { data: fallbackUser, error: fallbackError } = await this.supabase
            .from('users')
            .insert([minimalUserData])
            .select('id')
            .single();
          
          if (fallbackError) {
            console.error('Erro mesmo com dados mínimos:', fallbackError);
            throw new Error(`Falha ao criar usuário: ${fallbackError.message}`);
          }
          
          senderId = fallbackUser?.id;
        } else {
          senderId = newUser?.id;
        }
        
        console.log('Novo usuário criado:', newUser);
      }
    } else {
      console.error('ERRO: senderPhone não foi extraído corretamente do payload');
    }
    
    console.log('senderId final:', senderId);
    
    // Verificar se senderId foi definido
    if (!senderId) {
      console.error('ERRO CRÍTICO: senderId é null, não é possível salvar mensagem');
      throw new Error('Não foi possível determinar o sender_id da mensagem');
    }
    
    // Buscar ou criar conversa
    let conversationId = null;
    if (whatsappChatId) {
      const { data: existingConversation } = await this.supabase
        .from('conversations')
        .select('id')
        .eq('whatsapp_chat_id', whatsappChatId)
        .single();
      
      if (existingConversation) {
        conversationId = existingConversation.id;
      } else {
        // Criar nova conversa
        const { data: newConversation } = await this.supabase
          .from('conversations')
          .insert([{
            title: `Chat ${contactName}`,
            type: 'support',
            whatsapp_chat_id: whatsappChatId,
            evolution_instance_id: instanceId,
            created_by: senderId
          }])
          .select('id')
          .single();
        
        conversationId = newConversation?.id;
        
        // Adicionar participante à conversa
        if (conversationId && senderId) {
          await this.supabase
            .from('conversation_participants')
            .insert([{
              conversation_id: conversationId,
              user_id: senderId,
              role: isFromMe ? 'admin' : 'member'
            }]);
        }
      }
    }
    
    // Determinar tipo de mensagem
    const messageType = this.getMessageType(messageData);
    const messageContent = this.extractMessageContent(messageData);
    
    // Mapear campos para o novo schema
    const messageToSave = {
      content: messageContent,
      msg_type: messageType,
      msg_status: messageData.status || 'delivered',
      whatsapp_message_id: messageData.key?.id || messageData.id,
      evolution_message_id: messageData.key?.id || messageData.id,
      conversation_id: conversationId,
      sender_id: senderId,
      metadata: messageData
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

  private getMessageType(messageData: any): string {
    // Determinar tipo de mensagem baseado na estrutura da EvolutionAPI
    if (messageData.message?.imageMessage) return 'image';
    if (messageData.message?.videoMessage) return 'video';
    if (messageData.message?.audioMessage || messageData.message?.pttMessage) return 'audio';
    if (messageData.message?.documentMessage) return 'file';
    if (messageData.message?.locationMessage) return 'location';
    if (messageData.message?.contactMessage) return 'contact';
    if (messageData.messageType === 'system') return 'system';
    return 'text';
  }

  private extractMessageContent(messageData: any): string {
    // Extrair conteúdo baseado no tipo de mensagem
    const message = messageData.message || messageData;
    
    // Texto simples
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (messageData.text) return messageData.text;
    if (messageData.body) return messageData.body;
    
    // Mídia com caption
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.documentMessage?.caption) return message.documentMessage.caption;
    
    // Outros tipos
    if (message.locationMessage) {
      return `Localização: ${message.locationMessage.degreesLatitude}, ${message.locationMessage.degreesLongitude}`;
    }
    
    if (message.contactMessage) {
      return `Contato: ${message.contactMessage.displayName || message.contactMessage.vcard}`;
    }
    
    // Fallback para mensagens sem texto
    return '[Mídia]';
  }
}
