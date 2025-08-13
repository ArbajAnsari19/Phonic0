import { PythonWhisperSTT } from './python-whisper-stt';
import { WhisperSTT } from './whisper-stt';
import { WhisperStreamingSTT } from './whisper-streaming-stt';

export interface HybridSTTConfig {
  primaryProvider: 'python-whisper' | 'openai';
  fallbackProvider?: 'openai' | 'python-whisper';
  enableStreaming?: boolean; // New flag for streaming
  pythonWhisperConfig?: {
    model?: string;
    language?: string;
    pythonPath?: string;
    device?: 'cpu' | 'cuda';
  };
  openaiConfig?: {
    model?: string;
    language?: string;
    apiKey?: string;
  };
  streamingConfig?: {
    chunkSize?: number;
    vadThreshold?: number;
    maxSilenceDuration?: number;
    partialUpdateInterval?: number;
  };
}

export class HybridSTT {
  private pythonWhisper: PythonWhisperSTT | null = null;
  private openaiWhisper: WhisperSTT | null = null;
  private streamingSTT: WhisperStreamingSTT | null = null;
  private config: HybridSTTConfig;

  constructor(config: HybridSTTConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      if (this.config.enableStreaming) {
        // Initialize streaming STT
        this.streamingSTT = new WhisperStreamingSTT({
          primaryProvider: this.config.primaryProvider,
          fallbackProvider: this.config.fallbackProvider,
          pythonWhisperConfig: this.config.pythonWhisperConfig,
          openaiConfig: this.config.openaiConfig,
          streamingConfig: this.config.streamingConfig
        });
        await this.streamingSTT.initialize();
        console.log('✅ Hybrid STT: Streaming mode initialized');
      } else {
        // Initialize traditional STT providers
        if (this.config.primaryProvider === 'python-whisper') {
          this.pythonWhisper = new PythonWhisperSTT(this.config.pythonWhisperConfig);
          await this.pythonWhisper.initialize();
          console.log('✅ Hybrid STT: Python Whisper initialized (traditional mode)');
        } else if (this.config.primaryProvider === 'openai') {
          this.openaiWhisper = new WhisperSTT(this.config.openaiConfig);
          console.log('✅ Hybrid STT: OpenAI Whisper initialized (traditional mode)');
        }

        // Initialize fallback provider
        if (this.config.fallbackProvider && this.config.fallbackProvider !== this.config.primaryProvider) {
          if (this.config.fallbackProvider === 'python-whisper') {
            this.pythonWhisper = new PythonWhisperSTT(this.config.pythonWhisperConfig);
            await this.pythonWhisper.initialize();
            console.log('✅ Hybrid STT: Fallback Python Whisper initialized');
          } else if (this.config.fallbackProvider === 'openai') {
            this.openaiWhisper = new WhisperSTT(this.config.openaiConfig);
            console.log('✅ Hybrid STT: Fallback OpenAI Whisper initialized');
          }
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize Hybrid STT:', error);
      throw error;
    }
  }

  // Traditional transcription methods (for backward compatibility)
  async transcribeWavBuffer(buffer: Buffer): Promise<string> {
    if (this.config.enableStreaming) {
      throw new Error('Streaming mode enabled - use streaming methods instead');
    }

    try {
      // Try primary provider first
      if (this.config.primaryProvider === 'python-whisper' && this.pythonWhisper) {
        try {
          return await this.pythonWhisper.transcribeWavBuffer(buffer);
        } catch (error) {
          console.warn('⚠️ Primary STT (python-whisper) failed, trying fallback...', error);
          if (this.config.fallbackProvider === 'openai' && this.openaiWhisper) {
            return await this.openaiWhisper.transcribeWavBuffer(buffer);
          }
          throw error;
        }
      } else if (this.config.primaryProvider === 'openai' && this.openaiWhisper) {
        try {
          return await this.openaiWhisper.transcribeWavBuffer(buffer);
        } catch (error) {
          console.warn('⚠️ Primary STT (openai) failed, trying fallback...', error);
          if (this.config.fallbackProvider === 'python-whisper' && this.pythonWhisper) {
            return await this.pythonWhisper.transcribeWavBuffer(buffer);
          }
          throw error;
        }
      }
      
      throw new Error('No STT provider available');
    } catch (error) {
      console.error('❌ All STT providers failed:', error);
      throw error;
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    if (this.config.enableStreaming) {
      throw new Error('Streaming mode enabled - use streaming methods instead');
    }

    try {
      if (this.config.primaryProvider === 'python-whisper' && this.pythonWhisper) {
        try {
          return await this.pythonWhisper.transcribeFile(filePath);
        } catch (error) {
          if (this.config.fallbackProvider === 'openai' && this.openaiWhisper) {
            return await this.openaiWhisper.transcribeFile(filePath);
          }
          throw error;
        }
      } else if (this.config.primaryProvider === 'openai' && this.openaiWhisper) {
        try {
          return await this.openaiWhisper.transcribeFile(filePath);
        } catch (error) {
          if (this.config.fallbackProvider === 'python-whisper' && this.pythonWhisper) {
            return await this.pythonWhisper.transcribeFile(filePath);
          }
          throw error;
        }
      }
      
      throw new Error('No STT provider available');
    } catch (error) {
      console.error('❌ All STT providers failed:', error);
      throw error;
    }
  }

  // New streaming methods
  async processAudioChunk(audioChunk: Buffer): Promise<any> {
    if (!this.config.enableStreaming || !this.streamingSTT) {
      throw new Error('Streaming mode not enabled');
    }
    return await this.streamingSTT.processAudioChunk(audioChunk);
  }

  async flush(): Promise<any> {
    if (!this.config.enableStreaming || !this.streamingSTT) {
      throw new Error('Streaming mode not enabled');
    }
    return await this.streamingSTT.flush();
  }

  async reset(): Promise<void> {
    if (!this.config.enableStreaming || !this.streamingSTT) {
      throw new Error('Streaming mode not enabled');
    }
    return await this.streamingSTT.reset();
  }

  getPartialTranscript(): string {
    if (!this.config.enableStreaming || !this.streamingSTT) {
      throw new Error('Streaming mode not enabled');
    }
    return this.streamingSTT.getPartialTranscript();
  }

  // Get streaming STT instance for direct access
  getStreamingSTT(): WhisperStreamingSTT | null {
    return this.streamingSTT;
  }

  // Check if streaming is enabled
  isStreamingEnabled(): boolean {
    return this.config.enableStreaming === true;
  }
}
