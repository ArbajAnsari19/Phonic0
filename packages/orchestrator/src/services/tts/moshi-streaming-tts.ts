import { BaseStreamingTTS, StreamingTTSConfig, StreamingTTSResult } from './streaming-tts';
import { KyutaiTTSClient } from 'kyutai-client/clients/tts-client';

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
  private moshiClient: KyutaiTTSClient;

  constructor(config: MoshiStreamingTTSConfig) {
    super(config);
    this.moshiClient = new KyutaiTTSClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.moshiClient.connect();
      console.log('✅ Moshi Streaming TTS initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Moshi TTS:', error);
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
    return Buffer.alloc(0); // Moshi TTS doesn't provide partial audio
  }

  async synthesizeText(text: string): Promise<StreamingTTSResult> {
    if (!this.isProcessing) {
      throw new Error('TTS streaming not started');
    }

    try {
      const result = await this.moshiClient.synthesize(text, {
        voice: { languageCode: this.config.voice || 'en-US' },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: this.config.sampleRate || 16000,
          speakingRate: this.config.speakingRate || 1.0,
          pitch: this.config.pitch || 0.0,
          volumeGainDb: 0.0
        },
        enableLowLatency: true
      });

      const ttsResult: StreamingTTSResult = {
        audio: result.audioContent,
        text: text,
        isComplete: true,
        timestamp: new Date()
      };

      this.emit('complete', ttsResult);
      return ttsResult;

    } catch (error) {
      console.error('❌ Error synthesizing text with Moshi:', error);
      this.emitError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async destroy(): Promise<void> {
    this.isProcessing = false;
    console.log('🗑️ Moshi Streaming TTS destroyed');
  }
}
