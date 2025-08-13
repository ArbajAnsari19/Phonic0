import { BaseStreamingTTS, StreamingTTSConfig } from './streaming-tts';
import { MockStreamingTTS } from './mock-streaming-tts';

export interface TTSServiceConfig {
  provider: 'murf' | 'chatterbox' | 'mock' | 'custom';
  streamingConfig?: {
    enabled: boolean;
    chunkSize?: number;
    sampleRate?: number;
    speakingRate?: number;
  };
  murfConfig?: {
    apiKey: string;
    voiceId: string;
  };
  chatterboxConfig?: {
    modelPath: string;
    device: 'cpu' | 'cuda';
  };
}

export class TTSService {
  private streamingTTS: BaseStreamingTTS | null = null;
  private config: TTSServiceConfig;
  private isStreamingEnabled: boolean;

  constructor(config: TTSServiceConfig) {
    this.config = config;
    this.isStreamingEnabled = config.streamingConfig?.enabled || false;
  }

  async initialize(): Promise<void> {
    try {
      if (this.isStreamingEnabled) {
        // For now, use mock TTS
        this.streamingTTS = new MockStreamingTTS({
          sampleRate: this.config.streamingConfig?.sampleRate || 24000,
          chunkSize: this.config.streamingConfig?.chunkSize || 1024,
          speakingRate: this.config.streamingConfig?.speakingRate || 1.0,
        });
        
        console.log('✅ Streaming TTS service initialized (mock)');
      } else {
        console.log('ℹ️ Streaming TTS disabled');
      }
    } catch (error) {
      console.error('❌ Failed to initialize TTS service:', error);
      throw error;
    }
  }

  // Start streaming TTS
  async startStreamingTTS(
    text: string,
    onPartial?: (audio: Buffer, text: string) => void,
    onComplete?: (audio: Buffer, text: string) => void,
    onError?: (error: Error) => void
  ): Promise<void> {
    if (!this.isStreamingEnabled || !this.streamingTTS) {
      throw new Error('Streaming TTS not available');
    }

    // Set up event listeners
    if (onPartial) {
      this.streamingTTS.on('partial', (result) => {
        onPartial(result.audio, result.text);
      });
    }
    
    if (onComplete) {
      this.streamingTTS.on('complete', (result) => {
        onComplete(result.audio, result.text);
      });
    }
    
    if (onError) {
      this.streamingTTS.on('error', onError);
    }

    // Start streaming
    await this.streamingTTS.startStreaming(text);
  }

  // Stop current streaming
  async stopStreamingTTS(): Promise<void> {
    if (this.streamingTTS && this.streamingTTS.isStreaming()) {
      await this.streamingTTS.stopStreaming();
    }
  }

  // Check if streaming is enabled
  isStreaming(): boolean {
    return this.isStreamingEnabled;
  }

  // Get streaming TTS instance
  getStreamingTTS(): BaseStreamingTTS | null {
    return this.streamingTTS;
  }
}
