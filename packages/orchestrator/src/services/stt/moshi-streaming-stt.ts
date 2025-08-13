import { BaseStreamingSTT, StreamingSTTResult, AudioChunk, StreamingSTTConfig } from './streaming-stt';
import { KyutaiSTTClient } from 'kyutai-client/clients/stt-client';

export interface MoshiStreamingSTTConfig extends StreamingSTTConfig {
  moshiEndpoint?: string;
  enableInterimResults?: boolean;
  languageCode?: string;
  sampleRate?: number;
}

export class MoshiStreamingSTT extends BaseStreamingSTT {
  private moshiClient: KyutaiSTTClient;
  private partialTranscript: string = '';

  constructor(config: MoshiStreamingSTTConfig) {
    super({
      ...config,
      language: config.languageCode || config.language || 'en-US', // Map languageCode to language
      sampleRate: config.sampleRate || 16000
    });
    
    this.moshiClient = new KyutaiSTTClient();
  }

  async initialize(): Promise<void> {
    try {
      await this.moshiClient.connect();
      console.log('✅ Moshi Streaming STT initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Moshi STT:', error);
      throw error;
    }
  }

  async processAudioChunk(audioChunk: Buffer): Promise<StreamingSTTResult> {
    if (!this.isProcessing) {
      return this.createEmptyResult();
    }

    // Add chunk to buffer using parent method
    this.addAudioChunk(audioChunk);
    
    // Process accumulated audio (every 500ms worth of audio)
    if (this.shouldProcessBuffer()) {
      return await this.processAccumulatedAudio();
    }

    return this.createEmptyResult();
  }

  async flush(): Promise<StreamingSTTResult> {
    if (this.audioBuffer.length > 0) {
      return await this.processAccumulatedAudio();
    }
    return this.createEmptyResult();
  }

  async reset(): Promise<void> {
    this.isProcessing = false;
    this.audioBuffer = [];
    this.partialTranscript = '';
    this.sequenceCounter = 0;
  }

  getPartialTranscript(): string {
    return this.partialTranscript;
  }

  async startStreaming(): Promise<void> {
    this.isProcessing = true;
    this.audioBuffer = [];
    this.partialTranscript = '';
    this.emit('streaming_started');
    console.log('🎤 Moshi STT streaming started');
  }

  async stopStreaming(): Promise<StreamingSTTResult> {
    this.isProcessing = false;
    
    // Process any remaining audio
    if (this.audioBuffer.length > 0) {
      return await this.processAccumulatedAudio();
    }

    const finalResult = this.createFinalResult();
    this.emit('streaming_stopped', finalResult);
    console.log('🛑 Moshi STT streaming stopped');
    
    return finalResult;
  }

  private async processAccumulatedAudio(): Promise<StreamingSTTResult> {
    if (this.audioBuffer.length === 0) {
      return this.createEmptyResult();
    }

    try {
      // Concatenate audio chunks
      const audioData = Buffer.concat(this.audioBuffer.map(chunk => chunk.data));
      this.audioBuffer = []; // Clear buffer

      // Send to Moshi for recognition
      const result = await this.moshiClient.recognize(audioData, {
        language: this.config.language!, // Use 'language' not 'languageCode'
        sampleRate: this.config.sampleRate!,
        encoding: 'LINEAR16',
        interimResults: true // Use hardcoded value since base class doesn't have this
      });

      // Update partial transcript
      if (result.transcript && result.transcript !== this.partialTranscript) {
        this.partialTranscript = result.transcript;
        
        // Emit partial result
        const partialResult = this.createPartialResult(result.transcript, result.confidence, result.isFinal);
        this.emit('partial_result', partialResult);
        
        // If final, emit final result
        if (result.isFinal) {
          this.emit('final_result', partialResult);
        }
      }

      return this.createPartialResult(this.partialTranscript, result.confidence, result.isFinal);

    } catch (error) {
      console.error('❌ Error processing audio with Moshi:', error);
      this.emit('error', error);
      return this.createEmptyResult();
    }
  }

  private shouldProcessBuffer(): boolean {
    // Process buffer every ~500ms worth of audio
    const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.data.length, 0);
    const bytesPerSample = 2; // 16-bit audio
    const samples = totalSamples / bytesPerSample;
    const durationMs = (samples / this.config.sampleRate!) * 1000;
    
    return durationMs >= 500;
  }

  private createEmptyResult(): StreamingSTTResult {
    return {
      transcript: '',
      confidence: 0,
      isFinal: false,
      endOfSpeech: false,
      timestamp: new Date()
    };
  }

  private createPartialResult(transcript: string, confidence: number, isFinal: boolean): StreamingSTTResult {
    return {
      transcript,
      confidence,
      isFinal,
      endOfSpeech: isFinal,
      timestamp: new Date()
    };
  }

  private createFinalResult(): StreamingSTTResult {
    return {
      transcript: this.partialTranscript,
      confidence: 0.9,
      isFinal: true,
      endOfSpeech: true,
      timestamp: new Date()
    };
  }

  async destroy(): Promise<void> {
    this.isProcessing = false;
    this.audioBuffer = [];
    console.log('🗑️ Moshi Streaming STT destroyed');
  }
}
