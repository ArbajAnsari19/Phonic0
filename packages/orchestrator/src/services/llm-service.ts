import {  BaseStreamingLLM, LLMResponse} from './llm/streaming-llm';
import { OpenAIStreamingLLM } from './llm/openai-streaming-llm';

export interface LLMConfig {
  provider: 'openai' | 'local' | 'custom';
  openaiConfig?: {
    apiKey: string;
    model: string;
    organization?: string;
    baseURL?: string;
  };
  streamingConfig?: {
    enabled: boolean;
    streamDelay?: number;
    partialThreshold?: number;
  };
}

export class LLMService {
  private streamingLLM: BaseStreamingLLM | null = null;
  private config: LLMConfig;
  private isStreamingEnabled: boolean;

  constructor(config: LLMConfig) {
    this.config = config;
    this.isStreamingEnabled = config.streamingConfig?.enabled || false;
  }

  async initialize(): Promise<void> {
    try {
      if (this.isStreamingEnabled && this.config.provider === 'openai') {
        this.streamingLLM = new OpenAIStreamingLLM({
          apiKey: this.config.openaiConfig!.apiKey,
          model: this.config.openaiConfig!.model,
          organization: this.config.openaiConfig!.organization,
          baseURL: this.config.openaiConfig!.baseURL,
          streamDelay: this.config.streamingConfig?.streamDelay || 100,
          partialThreshold: this.config.streamingConfig?.partialThreshold || 3,
        });
        await (this.streamingLLM as OpenAIStreamingLLM).initialize();
        console.log('✅ Streaming LLM service initialized');
      } else {
        console.log('ℹ️ Streaming LLM disabled or provider not supported');
      }
    } catch (error) {
      console.error('❌ Failed to initialize LLM service:', error);
      throw error;
    }
  }

  // Traditional non-streaming method (for backward compatibility)
  async processWithLLM(
    conversationId: string,
    input: string,
    role: 'user' | 'system' = 'user'
  ): Promise<string> {
    if (this.isStreamingEnabled && this.streamingLLM) {
      // For now, use streaming but wait for completion
      return new Promise((resolve, reject) => {
        if (!this.streamingLLM) {
          reject(new Error('Streaming LLM not available'));
          return;
        }

        this.streamingLLM.once('complete', (response) => {
          resolve(response.finalText);
        });

        this.streamingLLM.once('error', (error) => {
          reject(error);
        });

        this.streamingLLM.startStreaming(conversationId, input).catch(reject);
      });
    } else {
      // Fallback to traditional processing
      throw new Error('Traditional LLM processing not implemented');
    }
  }

  // New streaming method
  async startStreamingResponse(
    conversationId: string,
    input: string,
    onPartial?: (response: LLMResponse) => void,
    onComplete?: (response: LLMResponse) => void,
    onToken?: (token: string) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    if (!this.isStreamingEnabled || !this.streamingLLM) {
      throw new Error('Streaming LLM not available');
    }

    // Set up event listeners
    if (onPartial) {
      this.streamingLLM.on('partial', onPartial);
    }
    if (onComplete) {
      this.streamingLLM.on('complete', onComplete);
    }
    if (onToken) {
      this.streamingLLM.on('token', onToken);
    }
    if (onError) {
      this.streamingLLM.on('error', onError);
    }

    // Start streaming
    await this.streamingLLM.startStreaming(conversationId, input);
  }

  // Stop current streaming
  async stopStreaming(): Promise<void> {
    if (this.streamingLLM && this.streamingLLM.isStreaming()) {
      await this.streamingLLM.stopStreaming();
    }
  }

  // Check if streaming is enabled
  isStreaming(): boolean {
    return this.isStreamingEnabled;
  }

  // Get streaming LLM instance
  getStreamingLLM(): BaseStreamingLLM | null {
    return this.streamingLLM;
  }
}
