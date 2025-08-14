import { BaseStreamingTTS, StreamingTTSConfig, StreamingTTSResult } from './streaming-tts';
import { MoshiWSClient } from 'kyutai-client/clients/moshi-ws-client'; // Use WebSocket client

export interface MoshiStreamingTTSConfig extends StreamingTTSConfig {
  moshiEndpoint?: string;
  audioConfig?: {
    audioEncoding: string;
    sampleRateHertz: number;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
  };
}

export class MoshiStreamingTTS extends BaseStreamingTTS {
  private moshiClient: MoshiWSClient;
  private isConnected: boolean = false;
  private pendingAudioCallbacks: Array<(audio: Buffer) => void> = [];

  constructor(config: MoshiStreamingTTSConfig) {
    super(config);
    
    // Use WebSocket client with your VM endpoints
    const endpoint = config.moshiEndpoint || process.env.KYUTAI_TTS_WS_URL || 'ws://35.244.13.180:8083/api/tts_streaming';
    this.moshiClient = new MoshiWSClient(endpoint, {
      protocol: 'fixed',
      audioMode: 'binary'
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.moshiClient.connect('api/tts_streaming', {
        onTTSAudio: (result) => {
          console.log('🔊 [TTS] WebSocket audio received:', result);
          this.handleTTSAudio(result);
        },
        onError: (error) => {
          console.error('❌ [TTS] WebSocket error:', error);
          this.emit('error', error);
        }
      });
      
      this.isConnected = true;
      console.log('✅ Moshi WebSocket TTS initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Moshi WebSocket TTS:', error);
      throw error;
    }
  }

  async startStreaming(text: string): Promise<void> {
    this.isProcessing = true;
    this.addTextChunk(text);
    this.emit('streaming_started');
    console.log('🔊 Moshi TTS streaming started');
  }

  async stopStreaming(): Promise<void> {
    this.isProcessing = false;
    this.clearText();
    this.emit('streaming_stopped');
    console.log('🛑 Moshi TTS streaming stopped');
  }

  getPartialAudio(): Buffer {
    return Buffer.alloc(0); // WebSocket TTS doesn't provide partial audio
  }

  async synthesizeText(text: string): Promise<StreamingTTSResult> {
    if (!this.isProcessing || !this.isConnected) {
      throw new Error('TTS streaming not started or not connected');
    }

    try {
      console.log(`🔊 [TTS] Sending text to WebSocket: "${text}"`);
      
      // Send text via WebSocket
      await this.moshiClient.sendText(text);
      
      // Wait for audio response via WebSocket
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('TTS timeout - no audio received'));
        }, 10000); // 10 second timeout

        this.pendingAudioCallbacks.push((audio: Buffer) => {
          clearTimeout(timeout);
          const result: StreamingTTSResult = {
            audio: audio,
            text: text,
            isComplete: true,
            timestamp: new Date()
          };
          this.emit('complete', result);
          resolve(result);
        });
      });

    } catch (error) {
      console.error('❌ Error synthesizing text with WebSocket TTS:', error);
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private handleTTSAudio(result: any): void {
    if (result.audioBase64) {
      // Convert base64 to buffer
      const audioBuffer = Buffer.from(result.audioBase64, 'base64');
      
      // Resolve pending callbacks
      if (this.pendingAudioCallbacks.length > 0) {
        const callback = this.pendingAudioCallbacks.shift();
        if (callback) {
          callback(audioBuffer);
        }
      }
    }
  }

  async destroy(): Promise<void> {
    this.isProcessing = false;
    this.isConnected = false;
    console.log('🗑️ Moshi WebSocket TTS destroyed');
  }
}
