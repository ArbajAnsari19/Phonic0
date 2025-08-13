import { EventEmitter } from 'events';

export interface StreamingTTSConfig {
  model?: string;
  voice?: string;
  sampleRate?: number;
  chunkSize?: number;
  speakingRate?: number;
  pitch?: number;
}

export interface StreamingTTSResult {
  audio: Buffer;
  isComplete: boolean;
  text: string;
  timestamp: Date;
  metadata?: {
    duration?: number;
    sampleRate?: number;
    channels?: number;
  };
}

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
  sequence: number;
  text: string;
}

export abstract class BaseStreamingTTS extends EventEmitter {
  protected config: StreamingTTSConfig;
  protected isProcessing: boolean = false;
  protected currentText: string = '';
  protected audioBuffer: AudioChunk[] = [];

  constructor(config: StreamingTTSConfig) {
    super();
    this.config = {
      sampleRate: 24000,
      chunkSize: 1024,
      speakingRate: 1.0,
      pitch: 1.0,
      ...config
    };
  }

  // Start streaming TTS for given text
  abstract startStreaming(text: string): Promise<void>;

  // Stop current streaming
  abstract stopStreaming(): Promise<void>;

  // Get current partial audio
  abstract getPartialAudio(): Buffer;

  // Check if streaming is active
  isStreaming(): boolean {
    return this.isProcessing;
  }

  // Add text chunk for processing
  protected addTextChunk(text: string): void {
    this.currentText += text;
  }

  // Clear current text
  protected clearText(): void {
    this.currentText = '';
  }

  // Emit partial audio
  protected emitPartialAudio(audio: Buffer, text: string): void {
    this.emit('partial', {
      audio,
      text,
      isComplete: false,
      timestamp: new Date()
    });
  }

  // Emit complete audio
  protected emitCompleteAudio(audio: Buffer, text: string): void {
    this.emit('complete', {
      audio,
      text,
      isComplete: true,
      timestamp: new Date()
    });
  }

  // Emit error
  protected emitError(error: Error): void {
    this.emit('error', error);
  }
}
