import { EventEmitter } from 'events';

export interface StreamingLLMConfig {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  streamDelay?: number; // Delay before starting to stream
  partialThreshold?: number; // Minimum tokens before streaming starts
}

export interface StreamingLLMResult {
  text: string;
  isComplete: boolean;
  tokens: string[];
  confidence: number;
  timestamp: Date;
}

export interface PartialLLMResponse {
  text: string;
  isComplete: false;
  tokens: string[];
  confidence: number;
}

export interface CompleteLLMResponse {
  text: string;
  isComplete: true;
  tokens: string[];
  confidence: number;
  finalText: string;
}

export type LLMResponse = PartialLLMResponse | CompleteLLMResponse;

export abstract class BaseStreamingLLM extends EventEmitter {
  protected config: StreamingLLMConfig;
  protected isProcessing: boolean = false;
  protected currentTokens: string[] = [];
  protected conversationContext: string[] = [];

  constructor(config: StreamingLLMConfig) {
    super();
    this.config = {
      model: 'gpt-3.5-turbo',
      maxTokens: 150,
      temperature: 0.7,
      streamDelay: 100, // 100ms delay before streaming
      partialThreshold: 3, // Start streaming after 3 tokens
      ...config
    };
  }

  // Start streaming response for a given input
  abstract startStreaming(
    conversationId: string,
    input: string,
    context?: string[]
  ): Promise<void>;

  // Stop current streaming
  abstract stopStreaming(): Promise<void>;

  // Get current partial response
  abstract getPartialResponse(): PartialLLMResponse;

  // Check if streaming is active
  isStreaming(): boolean {
    return this.isProcessing;
  }

  // Add conversation context
  addContext(context: string): void {
    this.conversationContext.push(context);
    // Keep only recent context (last 10 messages)
    if (this.conversationContext.length > 10) {
      this.conversationContext = this.conversationContext.slice(-10);
    }
  }

  // Clear conversation context
  clearContext(): void {
    this.conversationContext = [];
  }

  // Emit partial response
  protected emitPartialResponse(response: PartialLLMResponse): void {
    this.emit('partial', response);
  }

  // Emit complete response
  protected emitCompleteResponse(response: CompleteLLMResponse): void {
    this.emit('complete', response);
  }

  // Emit token
  protected emitToken(token: string): void {
    this.emit('token', token);
  }

  // Emit error
  protected emitError(error: Error): void {
    this.emit('error', error);
  }
}
