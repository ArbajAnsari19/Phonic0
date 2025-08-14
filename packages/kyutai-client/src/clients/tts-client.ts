import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import path from 'path';

export interface TTSConfig {
  voice: {
    languageCode: string;
    name?: string;
    gender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  };
  audioConfig: {
    audioEncoding: string;
    sampleRateHertz: number;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
  };
  enableLowLatency?: boolean;
}

export interface TTSResult {
  audioContent: Buffer;
  timepoints?: Array<{
    markName: string;
    timeSeconds: number;
  }>;
}

export class KyutaiTTSClient extends EventEmitter {
  private client: any;
  private connected: boolean = false;
  private demoMode: boolean;

  constructor() {
    super();
    this.demoMode = process.env.DEMO_MODE === 'true';
  }

  async connect(): Promise<void> {
    if (this.demoMode) {
      console.log('🎭 TTS Client running in demo mode');
      this.connected = true;
      return;
    }

    try {
      const protoPath = path.join(__dirname, '../../proto/moshi_tts.proto');
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const ttsProto = grpc.loadPackageDefinition(packageDefinition) as any;
      const endpoint = process.env.KYUTAI_MOSHI_TTS_ENDPOINT || '35.244.13.180:8083';

      this.client = new ttsProto.moshi.tts.TextToSpeech(
        endpoint,
        grpc.credentials.createInsecure()
      );

      this.connected = true;
      console.log('✅ TTS Client connected to', endpoint);
    } catch (error) {
      console.error('❌ TTS Client connection failed:', error);
      throw error;
    }
  }

  async synthesize(text: string, config: TTSConfig): Promise<TTSResult> {
    if (this.demoMode) {
      return this.createMockTTSResult(text, config);
    }

    if (!this.connected) {
      throw new Error('TTS Client not connected');
    }

    return new Promise((resolve, reject) => {
      const request = {
        input: { text },
        voice: {
          languageCode: config.voice.languageCode,
          name: config.voice.name,
          ssmlGender: this.mapGender(config.voice.gender),
        },
        audioConfig: {
          audioEncoding: this.mapAudioEncoding(config.audioConfig.audioEncoding),
          sampleRateHertz: config.audioConfig.sampleRateHertz,
          speakingRate: config.audioConfig.speakingRate || 1.0,
          pitch: config.audioConfig.pitch || 0.0,
          volumeGainDb: config.audioConfig.volumeGainDb || 0.0,
        },
      };

      this.client.synthesize(request, (error: any, response: any) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            audioContent: Buffer.from(response.audioContent),
            timepoints: response.timepoints?.map((tp: any) => ({
              markName: tp.markName,
              timeSeconds: tp.timeSeconds,
            })),
          });
        }
      });
    });
  }

  createStreamingSynthesis(config: TTSConfig): NodeJS.ReadWriteStream {
    if (this.demoMode) {
      return this.createMockStreamingTTS(config);
    }

    if (!this.connected) {
      throw new Error('TTS Client not connected');
    }

    const call = this.client.streamingSynthesize();

    // Send initial configuration
    call.write({
      streamingConfig: {
        voice: {
          languageCode: config.voice.languageCode,
          name: config.voice.name,
          ssmlGender: this.mapGender(config.voice.gender),
        },
        audioConfig: {
          audioEncoding: this.mapAudioEncoding(config.audioConfig.audioEncoding),
          sampleRateHertz: config.audioConfig.sampleRateHertz,
          speakingRate: config.audioConfig.speakingRate || 1.0,
          pitch: config.audioConfig.pitch || 0.0,
          volumeGainDb: config.audioConfig.volumeGainDb || 0.0,
        },
        enableLowLatency: config.enableLowLatency || true,
        chunkSizeMs: 200,
      },
    });

    return call;
  }

  private createMockTTSResult(text: string, config: TTSConfig): TTSResult {
    // Generate mock audio data
    const sampleRate = config.audioConfig.sampleRateHertz;
    const estimatedDuration = this.estimateTextDuration(text, config.audioConfig.speakingRate || 1.0);
    const sampleCount = Math.floor(sampleRate * estimatedDuration);
    
    // Generate synthetic audio (simple sine wave for demo)
    const audioData = this.generateMockAudio(sampleCount, sampleRate);
    
    // Generate timepoints for words
    const timepoints = this.generateTimepoints(text, estimatedDuration);

    return {
      audioContent: audioData,
      timepoints,
    };
  }

  private createMockStreamingTTS(config: TTSConfig): NodeJS.ReadWriteStream {
    const { PassThrough } = require('stream');
    const stream = new PassThrough({ objectMode: true });

    stream.on('data', (textChunk: string) => {
      const chunkDuration = this.estimateTextDuration(textChunk, config.audioConfig.speakingRate || 1.0);
      const sampleCount = Math.floor(config.audioConfig.sampleRateHertz * chunkDuration);
      const audioChunk = this.generateMockAudio(sampleCount, config.audioConfig.sampleRateHertz);

      // Simulate streaming delay
      setTimeout(() => {
        stream.emit('data', {
          audioContent: audioChunk,
          timepoints: this.generateTimepoints(textChunk, chunkDuration),
          isFinal: false,
        });
      }, 50 + Math.random() * 100);
    });

    return stream;
  }

  private generateMockAudio(sampleCount: number, sampleRate: number): Buffer {
    const audioBuffer = Buffer.alloc(sampleCount * 2); // 16-bit audio
    
    for (let i = 0; i < sampleCount; i++) {
      // Generate a simple sine wave with some variation to simulate speech
      const t = i / sampleRate;
      const frequency = 200 + Math.sin(t * 2) * 50; // Varying frequency
      const amplitude = Math.sin(t * frequency * 2 * Math.PI) * 0.3;
      
      // Add some noise and variation to make it more speech-like
      const noise = (Math.random() - 0.5) * 0.1;
      const envelope = Math.exp(-t * 2) * Math.sin(t * 20) + 0.5; // Envelope
      
      const sample = Math.floor((amplitude + noise) * envelope * 32767);
      const clampedSample = Math.max(-32768, Math.min(32767, sample));
      
      audioBuffer.writeInt16LE(clampedSample, i * 2);
    }
    
    return audioBuffer;
  }

  private estimateTextDuration(text: string, speakingRate: number): number {
    // Rough estimation: average 150 words per minute, adjusted by speaking rate
    const wordsPerMinute = 150 * speakingRate;
    const wordCount = text.split(/\s+/).length;
    return (wordCount / wordsPerMinute) * 60;
  }

  private generateTimepoints(text: string, duration: number): Array<{
    markName: string;
    timeSeconds: number;
  }> {
    const words = text.split(/\s+/);
    const timePerWord = duration / words.length;
    
    return words.map((word, index) => ({
      markName: word,
      timeSeconds: index * timePerWord,
    }));
  }

  private mapAudioEncoding(encoding: string): number {
    const encodingMap: { [key: string]: number } = {
      'LINEAR16': 1,
      'MP3': 2,
      'OGG_OPUS': 3,
      'MULAW': 4,
      'ALAW': 5,
      'FLAC': 6,
      'WEBM_OPUS': 7,
    };
    return encodingMap[encoding.toUpperCase()] || 1;
  }

  private mapGender(gender?: string): number {
    const genderMap: { [key: string]: number } = {
      'MALE': 1,
      'FEMALE': 2,
      'NEUTRAL': 3,
    };
    return genderMap[gender?.toUpperCase() || 'NEUTRAL'] || 3;
  }

  disconnect(): void {
    if (this.client) {
      this.client.close();
    }
    this.connected = false;
    console.log('🔌 TTS Client disconnected');
  }
}
