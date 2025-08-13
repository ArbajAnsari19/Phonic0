import { BaseStreamingLLM, StreamingLLMConfig, PartialLLMResponse, CompleteLLMResponse } from './streaming-llm';
import OpenAI from 'openai';

export interface OpenAIStreamingConfig extends StreamingLLMConfig {
  apiKey: string;
  model?: string;
  organization?: string;
  baseURL?: string;
}

export class OpenAIStreamingLLM extends BaseStreamingLLM {
  private openai: OpenAI | null = null;
  private openaiConfig: OpenAIStreamingConfig;
  private currentStream: any = null;

  constructor(config: OpenAIStreamingConfig) {
    super(config);
    this.openaiConfig = config;
  }

  async initialize(): Promise<void> {
    try {
      this.openai = new OpenAI({
        apiKey: this.openaiConfig.apiKey,
        organization: this.openaiConfig.organization,
        baseURL: this.openaiConfig.baseURL,
      });
      console.log('✅ OpenAI Streaming LLM initialized');
    } catch (error) {
      console.error('❌ Failed to initialize OpenAI Streaming LLM:', error);
      throw error;
    }
  }

  async startStreaming(
    conversationId: string,
    input: string,
    context: string[] = []
  ): Promise<void> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    if (this.isProcessing) {
      await this.stopStreaming();
    }

    this.isProcessing = true;
    this.currentTokens = [];
    this.addContext(input);

    try {
      console.log(`🚀 [StreamingLLM] Starting stream for conversation: ${conversationId}`);
      
      // Build conversation messages
      const messages = this.buildConversationMessages(input, context);
      
      // Start streaming
      this.currentStream = await this.openai.chat.completions.create({
        model: this.config.model!,
        messages,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: true,
      });

      // Process streaming response
      await this.processStreamingResponse(conversationId);

    } catch (error) {
      console.error('❌ Error starting streaming:', error);
      this.emitError(error as Error);
      this.isProcessing = false;
    }
  }

  async stopStreaming(): Promise<void> {
    if (this.currentStream) {
      try {
        this.currentStream.controller?.abort();
        this.currentStream = null;
      } catch (error) {
        console.warn('⚠️ Error stopping stream:', error);
      }
    }
    
    this.isProcessing = false;
    this.currentTokens = [];
  }

  getPartialResponse(): PartialLLMResponse {
    return {
      text: this.currentTokens.join(''),
      isComplete: false,
      tokens: [...this.currentTokens],
      confidence: 0.8, // Placeholder confidence
    };
  }

  private async processStreamingResponse(conversationId: string): Promise<void> {
    if (!this.currentStream) return;

    try {
      let partialText = '';
      let tokenCount = 0;

      for await (const chunk of this.currentStream) {
        if (!this.isProcessing) break;

        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          this.currentTokens.push(content);
          partialText += content;
          tokenCount++;

          // Emit individual token
          this.emitToken(content);

          // Emit partial response after threshold
          if (tokenCount >= this.config.partialThreshold!) {
            const partialResponse: PartialLLMResponse = {
              text: partialText,
              isComplete: false,
              tokens: [...this.currentTokens],
              confidence: 0.8,
            };
            this.emitPartialResponse(partialResponse);
          }

          // Add small delay for realistic streaming effect
          await new Promise(resolve => setTimeout(resolve, this.config.streamDelay!));
        }

        // Check if stream is complete
        if (chunk.choices[0]?.finish_reason) {
          break;
        }
      }

      // Emit complete response
      const completeResponse: CompleteLLMResponse = {
        text: this.currentTokens.join(''),
        isComplete: true,
        tokens: [...this.currentTokens],
        confidence: 0.9,
        finalText: this.currentTokens.join(''),
      };
      this.emitCompleteResponse(completeResponse);

      console.log(`✅ [StreamingLLM] Stream completed for conversation: ${conversationId}`);

    } catch (error) {
      console.error('❌ Error processing streaming response:', error);
      this.emitError(error as Error);
    } finally {
      this.isProcessing = false;
      this.currentStream = null;
    }
  }

  private buildConversationMessages(input: string, context: string[]): any[] {
    const messages = [];

    // Add system message if context exists
    if (context.length > 0) {
      messages.push({
        role: 'system',
        content: `Context: ${context.join('\n')}`
      });
    }

    // Add user input
    messages.push({
      role: 'user',
      content: input
    });

    return messages;
  }
}
