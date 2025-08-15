import { EventEmitter } from 'events';

export interface StreamingSTTResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
  endOfSpeech: boolean;
  partialText?: string;
  timestamp: Date;
}

export interface StreamingSTTConfig {
  model?: string;
  language?: string;
  sampleRate?: number;
  chunkSize?: number;
  vadThreshold?: number;
  maxSilenceDuration?: number;
}

export interface AudioChunk {
  data: Buffer;
  timestamp: number;
  sequence: number;
}

export abstract class BaseStreamingSTT extends EventEmitter {
  protected config: StreamingSTTConfig;
  protected audioBuffer: AudioChunk[] = [];
  protected isProcessing: boolean = false;
  protected lastSpeechTime: number = 0;
  protected silenceStartTime: number = 0;
  protected sequenceCounter: number = 0;

  constructor(config: StreamingSTTConfig) {
    super();
    this.config = {
      sampleRate: 16000,
      chunkSize: 320, // 20ms at 16kHz
      vadThreshold: 0.1,
      maxSilenceDuration: 1000, // 1 second
      ...config
    };
  }

  // Process incoming audio chunk in real-time
  abstract processAudioChunk(audioChunk: Buffer): Promise<StreamingSTTResult>;

  // Flush remaining audio and get final result
  abstract flush(): Promise<StreamingSTTResult>;

  // Reset the streaming state
  abstract reset(): Promise<void>;

  // Get current partial transcript
  abstract getPartialTranscript(): string;

  // Check if speech has ended
  protected isEndOfSpeech(): boolean {
    const now = Date.now();
    const silenceDuration = now - this.lastSpeechTime;
    return silenceDuration > this.config.maxSilenceDuration!;
  }

  // Add audio chunk to buffer
  protected addAudioChunk(audioData: Buffer): void {
    const chunk: AudioChunk = {
      data: audioData,
      timestamp: Date.now(),
      sequence: this.sequenceCounter++
    };

    this.audioBuffer.push(chunk);
    
    // Keep only recent chunks to manage memory
    const maxChunks = Math.floor(this.config.maxSilenceDuration! / (this.config.chunkSize! / this.config.sampleRate! * 1000));
    if (this.audioBuffer.length > maxChunks) {
      this.audioBuffer = this.audioBuffer.slice(-maxChunks);
    }

    // Update speech detection
    if (this.hasVoiceActivity(audioData)) {
      this.lastSpeechTime = Date.now();
      this.silenceStartTime = 0;
    } else {
      if (this.silenceStartTime === 0) {
        this.silenceStartTime = Date.now();
      }
    }
  }

  // Simple voice activity detection
  protected hasVoiceActivity(audioData: Buffer): boolean {
    // Convert buffer to 16-bit samples
    const samples = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.length / 2);
    
    // Calculate RMS (Root Mean Square) for energy detection
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    const rms = Math.sqrt(sum / samples.length);
    
    // Normalize to 0-1 range (16-bit audio has range -32768 to 32767)
    const normalizedRMS = rms / 32768;
    
    return normalizedRMS > this.config.vadThreshold!;
  }

  // Get audio buffer as single buffer
  protected getAudioBuffer(): Buffer {
    return Buffer.concat(this.audioBuffer.map(chunk => chunk.data));
  }

  // Clear audio buffer
  protected clearBuffer(): void {
    this.audioBuffer = [];
    this.sequenceCounter = 0;
  }

  // Emit partial result
  protected emitPartialResult(result: Partial<StreamingSTTResult>): void {
    (this as EventEmitter).emit('partial', {
      transcript: result.transcript || '',
      isFinal: false,
      confidence: result.confidence || 0,
      endOfSpeech: false,
      timestamp: new Date(),
      ...result
    });
  }

  // Emit final result
  protected emitFinalResult(result: Partial<StreamingSTTResult>): void {
    (this as EventEmitter).emit('final', {
      transcript: result.transcript || '',
      isFinal: true,
      confidence: result.confidence || 0,
      endOfSpeech: true,
      timestamp: new Date(),
      ...result
    });
  }

  // Add connection health check
  abstract isConnected(): boolean;
  
  // Add connection method
  abstract connect(): Promise<void>;
  
  // Add connection status
  protected connectionStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  
  getConnectionStatus(): string {
    return this.connectionStatus;
  }
}
