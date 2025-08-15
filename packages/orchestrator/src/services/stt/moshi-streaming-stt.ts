import { BaseStreamingSTT, StreamingSTTResult, AudioChunk, StreamingSTTConfig } from './streaming-stt';
import { MoshiWSClient } from 'kyutai-client/clients/moshi-ws-client'; // Use WebSocket client

export interface MoshiStreamingSTTConfig extends StreamingSTTConfig {
  moshiEndpoint?: string;
  enableInterimResults?: boolean;
  languageCode?: string;
  sampleRate?: number;
  authToken?: string; // Add this
}

export class MoshiStreamingSTT extends BaseStreamingSTT {
  private moshiClient: MoshiWSClient;
  private partialTranscript: string = '';
  private _isConnected: boolean = false; // Rename to avoid conflict

  constructor(config: MoshiStreamingSTTConfig) {
    super({
      ...config,
      language: config.languageCode || config.language || 'en-US',
      sampleRate: config.sampleRate || 16000
    });
    
    // Use WebSocket client with your VM endpoints
    const endpoint = config.moshiEndpoint || process.env.KYUTAI_STT_WS_URL || 'ws://34.14.197.169:8082/api/asr-streaming';
    this.moshiClient = new MoshiWSClient(endpoint, {
      protocol: 'fixed',
      audioMode: 'binary',
      authToken: config.authToken // Pass the auth token
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.moshiClient.connect('api/asr-streaming', {
        onSTTResult: (result) => {
          console.log('🎤 [STT] WebSocket result received:', result);
          this.handleSTTResult(result);
        },
        onError: (error) => {
          console.error('❌ [STT] WebSocket error:', error);
          this.emit('error', error);
        }
      });
  this._isConnected = true; // Update reference
  this.connectionStatus = 'connected';
  console.log('✅ Moshi WebSocket STT initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Moshi WebSocket STT:', error);
  this._isConnected = false;
  this.connectionStatus = 'disconnected';
  throw error;
    }
  }

  async processAudioChunk(audioChunk: Buffer): Promise<StreamingSTTResult> {
    if (!this.isProcessing || !this._isConnected) {
      return this.createEmptyResult();
    }

    try {
      // Add chunk to buffer using parent method
      this.addAudioChunk(audioChunk);
      
      // Send audio via WebSocket if we have enough data
      if (this.shouldProcessBuffer()) {
        await this.sendAudioToMoshi();
      }

      return this.createPartialResult(this.partialTranscript, 0.8, false);

    } catch (error) {
      console.error('❌ Error processing audio chunk:', error);
      return this.createEmptyResult();
    }
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
    
  // mark disconnected when stopped
  this._isConnected = false;
  this.connectionStatus = 'disconnected';

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

      // Send audio via WebSocket (correct method)
      this.moshiClient.sendAudioChunk(audioData);

      // Return partial result - real transcript comes via WebSocket events
      return this.createPartialResult(this.partialTranscript, 0.8, false);

    } catch (error) {
      console.error('❌ Error processing audio with Moshi:', error);
      this.emit('error', error);
      return this.createEmptyResult();
    }
  }

  private async sendAudioToMoshi(): Promise<void> {
    if (this.audioBuffer.length === 0) return;

    try {
      // Concatenate audio chunks
      const audioData = Buffer.concat(this.audioBuffer.map(chunk => chunk.data));
      this.audioBuffer = []; // Clear buffer

      // Send audio via WebSocket (correct method)
      this.moshiClient.sendAudioChunk(audioData);
      console.log(` [STT] Sent ${audioData.length} bytes to Moshi WebSocket`);

    } catch (error) {
      console.error('❌ Error sending audio to Moshi:', error);
    }
  }

  private handleSTTResult(result: any): void {
    if (result.transcript) {
      this.partialTranscript = result.transcript;
      
      // Emit partial result
      const partialResult = this.createPartialResult(
        result.transcript, 
        result.confidence || 0.8, 
        result.isFinal || false
      );
      
      this.emit('partial_result', partialResult);
      
      // If final, emit final result
      if (result.isFinal) {
        this.emit('final_result', partialResult);
      }
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
  this._isConnected = false;
  this.connectionStatus = 'disconnected';
  }

  // Add the missing connect method
  async connect(): Promise<void> {
    try {
      await this.initialize();
      this._isConnected = true;
    } catch (error) {
      this._isConnected = false;
      throw error;
    }
  }

  // Add getter for isConnected to match base class signature
  isConnected(): boolean {
    return this._isConnected;
  }
}
