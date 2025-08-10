import OpenAI from 'openai';
import type { ConversationMessage } from './conversation-manager';

export interface LLMResponse {
  content: string;
  tokens?: number;
  model?: string;
  finishReason?: string;
}

export class LLMService {
  private openai?: OpenAI;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly demoMode: boolean;
  private readonly mockResponses: boolean;

  constructor() {
    this.model = process.env.OPENAI_MODEL || 'gpt-4-turbo-preview';
    this.maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '150');
    this.temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.7');
    this.demoMode = process.env.DEMO_MODE === 'true';
    this.mockResponses = process.env.MOCK_LLM_RESPONSES === 'true';
  }

  async initialize(): Promise<void> {
    if (this.demoMode && this.mockResponses) {
      console.log('🎭 LLM Service running in mock mode')
      return
    }

    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required when not in mock mode')
    }

    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': process.env.SITE_URL || '',
        'X-Title': process.env.SITE_NAME || '',
      },
    })

    try {
      // Test the connection
      await this.openai.models.list()
      console.log('✅ OpenAI connection established')
    } catch (error) {
      console.error('❌ Failed to connect to OpenAI:', error)
      throw error
    }
  }

  async generateResponse(messages: ConversationMessage[]): Promise<LLMResponse> {
    if (this.mockResponses) {
      return this.generateMockResponse(messages);
    }

    if (!this.openai) {
      throw new Error('LLM Service not initialized');
    }

    try {
      // Convert our message format to OpenAI format
      const openaiMessages = messages.map(msg => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      }));

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: openaiMessages,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        frequency_penalty: 0.3, // Reduce repetition
        presence_penalty: 0.1,  // Encourage new topics
        stop: ['\n\n', '---'], // Stop on double newlines or separators
      });

      const choice = completion.choices[0];
      if (!choice || !choice.message) {
        throw new Error('No response from OpenAI');
      }

      return {
        content: choice.message.content?.trim() || '',
        tokens: completion.usage?.total_tokens,
        model: completion.model,
        finishReason: choice.finish_reason || undefined,
      };

    } catch (error) {
      console.error('OpenAI API error:', error);
      
      // Fallback to mock response on error
      if (this.demoMode) {
        console.log('🎭 Falling back to mock response due to API error');
        return this.generateMockResponse(messages);
      }
      
      throw error;
    }
  }

  private generateMockResponse(messages: ConversationMessage[]): Promise<LLMResponse> {
    // Simulate processing delay
    const delay = 200 + Math.random() * 800; // 200-1000ms
    
    return new Promise(resolve => {
      setTimeout(() => {
        const response = this.selectMockResponse(messages);
        resolve({
          content: response,
          tokens: response.split(' ').length + 20, // Rough token estimation
          model: 'mock-gpt-4',
          finishReason: 'stop',
        });
      }, delay);
    });
  }

  private selectMockResponse(messages: ConversationMessage[]): string {
    const lastMessage = messages[messages.length - 1];
    const userInput = lastMessage?.content.toLowerCase() || '';

    // Context-aware mock responses
    if (userInput.includes('hello') || userInput.includes('hi')) {
      const greetings = [
        "Hello! Thanks for calling. How can I help you today?",
        "Hi there! I'm glad you called. What can I do for you?",
        "Hello! Great to hear from you. How may I assist you?",
        "Hi! Thanks for reaching out. What brings you here today?",
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    if (userInput.includes('price') || userInput.includes('cost') || userInput.includes('how much')) {
      const pricingResponses = [
        "Great question about pricing! We have several options available. Let me walk you through what would work best for your needs.",
        "I'd be happy to discuss our pricing options with you. Can you tell me a bit more about what you're looking for?",
        "Our pricing is very competitive and we offer flexible plans. What specific features are you most interested in?",
      ];
      return pricingResponses[Math.floor(Math.random() * pricingResponses.length)];
    }

    if (userInput.includes('demo') || userInput.includes('trial') || userInput.includes('test')) {
      const demoResponses = [
        "Absolutely! I'd love to set up a demo for you. When would be a good time to show you how this works?",
        "Perfect! A demo is the best way to see our platform in action. Are you available this week for a quick walkthrough?",
        "Great idea! Let me schedule a personalized demo that focuses on your specific use case. What's your availability like?",
      ];
      return demoResponses[Math.floor(Math.random() * demoResponses.length)];
    }

    if (userInput.includes('thank') || userInput.includes('thanks')) {
      const thankYouResponses = [
        "You're very welcome! Is there anything else I can help you with today?",
        "My pleasure! Feel free to reach out if you have any other questions.",
        "Happy to help! Don't hesitate to call again if you need anything.",
      ];
      return thankYouResponses[Math.floor(Math.random() * thankYouResponses.length)];
    }

    if (userInput.includes('bye') || userInput.includes('goodbye') || userInput.includes('talk later')) {
      const goodbyeResponses = [
        "Thank you for your time today! Have a wonderful day and we'll talk soon.",
        "It was great talking with you! Feel free to call back anytime. Take care!",
        "Thanks for calling! Looking forward to working with you. Have a great day!",
      ];
      return goodbyeResponses[Math.floor(Math.random() * goodbyeResponses.length)];
    }

    if (userInput.includes('help') || userInput.includes('support') || userInput.includes('problem')) {
      const helpResponses = [
        "I'm here to help! Can you tell me more about what you're trying to accomplish?",
        "Of course, I'd be happy to assist you. What specific challenge are you facing?",
        "Let me help you figure this out. Can you describe what's happening in more detail?",
      ];
      return helpResponses[Math.floor(Math.random() * helpResponses.length)];
    }

    if (userInput.includes('meeting') || userInput.includes('schedule') || userInput.includes('appointment')) {
      const schedulingResponses = [
        "I'd be happy to help you schedule a meeting. What days work best for you this week?",
        "Let's get something on the calendar! Are mornings or afternoons better for you?",
        "Perfect! I can schedule a meeting for you. Do you prefer this week or next week?",
      ];
      return schedulingResponses[Math.floor(Math.random() * schedulingResponses.length)];
    }

    // Default responses for various contexts
    const generalResponses = [
      "That's a great point. Can you tell me more about what you're thinking?",
      "I understand. Let me see how I can best help you with that.",
      "Thanks for sharing that. What would be the ideal outcome for you?",
      "That makes sense. What's the most important thing you'd like to focus on?",
      "I hear you. Let's explore some options that might work for your situation.",
      "Interesting! What other considerations do you have in mind?",
      "That's helpful to know. What questions do you have about moving forward?",
      "I appreciate you mentioning that. What would make this a great fit for you?",
    ];

    return generalResponses[Math.floor(Math.random() * generalResponses.length)];
  }

  // Health check method
  async checkHealth(): Promise<{ status: string; model: string; mockMode: boolean }> {
    try {
      if (this.mockResponses) {
        return {
          status: 'healthy',
          model: 'mock-gpt-4',
          mockMode: true,
        };
      }

      if (!this.openai) {
        return {
          status: 'not_initialized',
          model: this.model,
          mockMode: false,
        };
      }

      // Quick test with minimal tokens
      await this.openai.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      });

      return {
        status: 'healthy',
        model: this.model,
        mockMode: false,
      };

    } catch (error) {
      console.error('LLM health check failed:', error);
      return {
        status: 'error',
        model: this.model,
        mockMode: this.mockResponses,
      };
    }
  }

  // Get current configuration
  getConfig(): any {
    return {
      model: this.model,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      demoMode: this.demoMode,
      mockResponses: this.mockResponses,
      initialized: !!this.openai || this.mockResponses,
    };
  }

  // Update temperature for different conversation styles
  setTemperature(temperature: number): void {
    if (temperature >= 0 && temperature <= 2) {
      (this as any).temperature = temperature;
    }
  }

  // Token usage estimation for planning
  estimateTokens(text: string): number {
    // Rough estimation: ~1 token per 4 characters for English
    return Math.ceil(text.length / 4);
  }
}
