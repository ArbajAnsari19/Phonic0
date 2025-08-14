import { v4 as uuidv4 } from 'uuid';
import { LLMService } from './llm-service';

export interface Conversation {
  id: string;
  userId: string;
  brainId: string;
  brainInstructions: string;
  messages: ConversationMessage[];
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'error';
  metadata: {
    turnCount: number;
    totalTokens: number;
    averageResponseTime: number;
    userSatisfaction?: number;
  };
}

export interface ConversationMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: Date;
  metadata?: {
    tokens?: number;
    processingTime?: number;
    confidence?: number;
    audioLength?: number;
  };
}

export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  private readonly maxContextLength: number;

  constructor(
    private llmService: LLMService
  ) {
    this.maxContextLength = parseInt(process.env.MAX_CONTEXT_LENGTH || '10');
  }

  async createConversation(
    userId: string,
    brainId: string,
    brainInstructions: string
  ): Promise<string> {
    const conversationId = uuidv4();
    
    const conversation: Conversation = {
      id: conversationId,
      userId,
      brainId,
      brainInstructions,
      messages: [],
      startTime: new Date(),
      status: 'active',
      metadata: {
        turnCount: 0,
        totalTokens: 0,
        averageResponseTime: 0,
      },
    };

    // Add system message with brain instructions
    const systemMessage: ConversationMessage = {
      id: uuidv4(),
      role: 'system',
      content: this.buildSystemPrompt(brainInstructions),
      timestamp: new Date(),
    };

    conversation.messages.push(systemMessage);
    this.conversations.set(conversationId, conversation);

    console.log(`💬 Created conversation ${conversationId} for user ${userId} with brain ${brainId}`);

    return conversationId;
  }

  async processWithLLM(
    conversationId: string,
    input: string,
    role: 'user' | 'system' = 'user'
  ): Promise<string> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    if (conversation.status !== 'active') {
      throw new Error('Conversation is not active');
    }

    const startTime = Date.now();

    try {
      // Add user message to conversation
      const userMessage: ConversationMessage = {
        id: uuidv4(),
        role,
        content: input,
        timestamp: new Date(),
      };
      conversation.messages.push(userMessage);

      // Prepare context for LLM
      const context = this.prepareContextForLLM(conversation);

      // Get response from LLM
      const responseContent = await this.llmService.processWithLLM(conversationId, input, role);
      const processingTime = Date.now() - startTime;

      // Add assistant response to conversation
      const assistantMessage: ConversationMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
        metadata: {
          tokens: 0, // LLMService doesn't return token count
          processingTime,
        },
      };
      conversation.messages.push(assistantMessage);

      // Update conversation metadata
      conversation.metadata.turnCount++;
      conversation.metadata.totalTokens += 0; // LLMService doesn't return token count
      conversation.metadata.averageResponseTime = 
        ((conversation.metadata.averageResponseTime * (conversation.metadata.turnCount - 1)) + processingTime) 
        / conversation.metadata.turnCount;

      // Trim context if it gets too long
      this.trimConversationContext(conversation);

      console.log(`🤖 LLM response for ${conversationId}: "${responseContent}" (${processingTime}ms, 0 tokens)`);

      return responseContent;

    } catch (error) {
      console.error(`Error processing LLM request for conversation ${conversationId}:`, error);
      conversation.status = 'error';
      throw error;
    }
  }

  async endConversation(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return;
    }

    conversation.status = 'completed';
    conversation.endTime = new Date();

    console.log(`🏁 Ended conversation ${conversationId} (${conversation.metadata.turnCount} turns, ${conversation.metadata.totalTokens} tokens)`);
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  getConversationHistory(conversationId: string): ConversationMessage[] {
    const conversation = this.conversations.get(conversationId);
    return conversation ? [...conversation.messages] : [];
  }

  getUserConversations(userId: string): Conversation[] {
    return Array.from(this.conversations.values())
      .filter(conv => conv.userId === userId)
      .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }

  private buildSystemPrompt(brainInstructions: string): string {
    const timestamp = new Date().toISOString();
    
    return `You are an AI calling agent with the following instructions:

${brainInstructions}

IMPORTANT GUIDELINES:
- You are on a phone call, so keep responses conversational and natural
- Avoid using special characters, symbols, or formatting that doesn't work in speech
- Keep responses relatively brief (1-3 sentences typically)
- Speak in a friendly, professional tone
- If you need to pause, use natural speech patterns, not "..." or other symbols
- Listen carefully and respond appropriately to what the caller says
- If the caller seems confused or frustrated, be patient and helpful
- Always stay in character based on your instructions above

Current time: ${timestamp}

Remember: This is a live phone conversation. Speak naturally as if talking to a real person.`;
  }

  private prepareContextForLLM(conversation: Conversation): ConversationMessage[] {
    // Get the most recent messages within context limit
    const messages = conversation.messages.slice(-this.maxContextLength);
    
    // Always include the system message if it's not already included
    if (messages.length > 0 && messages[0].role !== 'system') {
      const systemMessage = conversation.messages.find(msg => msg.role === 'system');
      if (systemMessage) {
        messages.unshift(systemMessage);
      }
    }

    return messages;
  }

  private trimConversationContext(conversation: Conversation): void {
    // Keep system message + recent messages within limit
    const systemMessages = conversation.messages.filter(msg => msg.role === 'system');
    const otherMessages = conversation.messages.filter(msg => msg.role !== 'system');
    
    // Keep the most recent messages
    const recentMessages = otherMessages.slice(-(this.maxContextLength - systemMessages.length));
    
    conversation.messages = [...systemMessages, ...recentMessages];
  }

  // Analytics and monitoring methods
  getConversationStats(): any {
    const conversations = Array.from(this.conversations.values());
    
    const activeConversations = conversations.filter(c => c.status === 'active');
    const completedConversations = conversations.filter(c => c.status === 'completed');
    
    const avgTurns = completedConversations.length > 0
      ? completedConversations.reduce((sum, c) => sum + c.metadata.turnCount, 0) / completedConversations.length
      : 0;
    
    const avgTokens = completedConversations.length > 0
      ? completedConversations.reduce((sum, c) => sum + c.metadata.totalTokens, 0) / completedConversations.length
      : 0;
    
    const avgResponseTime = completedConversations.length > 0
      ? completedConversations.reduce((sum, c) => sum + c.metadata.averageResponseTime, 0) / completedConversations.length
      : 0;

    return {
      total: conversations.length,
      active: activeConversations.length,
      completed: completedConversations.length,
      error: conversations.filter(c => c.status === 'error').length,
      averageTurnsPerConversation: Math.round(avgTurns * 100) / 100,
      averageTokensPerConversation: Math.round(avgTokens),
      averageResponseTime: Math.round(avgResponseTime),
      totalTokensUsed: conversations.reduce((sum, c) => sum + c.metadata.totalTokens, 0),
    };
  }

  cleanupOldConversations(maxAge: number = 24 * 60 * 60 * 1000): number { // 24 hours default
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, conversation] of this.conversations.entries()) {
      const age = now - conversation.startTime.getTime();
      
      if (age > maxAge && conversation.status !== 'active') {
        this.conversations.delete(id);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} old conversations`);
    }
    
    return cleaned;
  }

  // Export conversation for analysis or storage
  exportConversation(conversationId: string): any {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      return null;
    }

    return {
      id: conversation.id,
      userId: conversation.userId,
      brainId: conversation.brainId,
      startTime: conversation.startTime,
      endTime: conversation.endTime,
      status: conversation.status,
      metadata: conversation.metadata,
      messages: conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
      })),
    };
  }
}
