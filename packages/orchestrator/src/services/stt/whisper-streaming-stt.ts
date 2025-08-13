import { BaseStreamingSTT, StreamingSTTResult, AudioChunk } from './streaming-stt';
import { PythonWhisperSTT } from './python-whisper-stt';
import { WhisperSTT } from './whisper-stt';

export interface WhisperStreamingConfig {
  primaryProvider: 'python-whisper' | 'openai';
  fallbackProvider?: 'openai' | 'python-whisper';
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

export class WhisperStreamingSTT extends BaseStreamingSTT {
  private pythonWhisper: PythonWhisperSTT | null = null;
  private openaiWhisper: WhisperSTT | null = null;
  private whisperConfig: WhisperStreamingConfig;
  private partialUpdateTimer: NodeJS.Timeout | null = null;
  private currentPartialTranscript: string = '';
  private lastProcessedChunk: number = -1;

  constructor(config: WhisperStreamingConfig) {
    super({
      chunkSize: config.streamingConfig?.chunkSize || 320,
      vadThreshold: config.streamingConfig?.vadThreshold || 0.1,
      maxSilenceDuration: config.streamingConfig?.maxSilenceDuration || 1000,
      ...config.streamingConfig
    });
    
    this.whisperConfig = config;
  }

  async initialize(): Promise<void> {
    try {
      if (this.whisperConfig.primaryProvider === 'python-whisper') {
        this.pythonWhisper = new PythonWhisperSTT(this.whisperConfig.pythonWhisperConfig);
        await this.pythonWhisper.initialize();
        console.log('✅ Streaming STT: Python Whisper initialized');
      } else if (this.whisperConfig.primaryProvider === 'openai') {
        this.openaiWhisper = new WhisperSTT(this.whisperConfig.openaiConfig);
        console.log('✅ Streaming STT: OpenAI Whisper initialized');
      }

      // Initialize fallback provider
      if (this.whisperConfig.fallbackProvider && this.whisperConfig.fallbackProvider !== this.whisperConfig.primaryProvider) {
        if (this.whisperConfig.fallbackProvider === 'python-whisper') {
          this.pythonWhisper = new PythonWhisperSTT(this.whisperConfig.pythonWhisperConfig);
          await this.pythonWhisper.initialize();
          console.log('✅ Streaming STT: Fallback Python Whisper initialized');
        } else if (this.whisperConfig.fallbackProvider === 'openai') {
          this.openaiWhisper = new WhisperSTT(this.whisperConfig.openaiConfig);
          console.log('✅ Streaming STT: Fallback OpenAI Whisper initialized');
        }
      }

      // Start partial update timer
      this.startPartialUpdateTimer();
    } catch (error) {
      console.error('❌ Failed to initialize Streaming STT:', error);
      throw error;
    }
  }

  async processAudioChunk(audioChunk: Buffer): Promise<StreamingSTTResult> {
    try {
      // Add chunk to buffer
      this.addAudioChunk(audioChunk);

      // Check if we should process for partial results
      if (this.shouldProcessPartial()) {
        const partialResult = await this.processPartialAudio();
        if (partialResult.transcript && partialResult.transcript !== this.currentPartialTranscript) {
          this.currentPartialTranscript = partialResult.transcript;
          this.emitPartialResult(partialResult);
        }
      }

      // Check for end of speech
      const endOfSpeech = this.isEndOfSpeech();
      
      return {
        transcript: this.currentPartialTranscript,
        isFinal: false,
        confidence: 0.8, // Placeholder - could be improved
        endOfSpeech,
        partialText: this.currentPartialTranscript,
        timestamp: new Date()
      };

    } catch (error) {
      console.error('❌ Error processing audio chunk:', error);
      throw error;
    }
  }

  async flush(): Promise<StreamingSTTResult> {
    try {
      console.log('🔄 [StreamingSTT] Flushing audio buffer...');
      
      const audio = this.getAudioBuffer();
      if (audio.length === 0) {
        return {
          transcript: '',
          isFinal: true,
          confidence: 0,
          endOfSpeech: true,
          timestamp: new Date()
        };
      }

      // Process complete audio for final result
      const finalTranscript = await this.transcribeCompleteAudio(audio);
      
      const result: StreamingSTTResult = {
        transcript: finalTranscript,
        isFinal: true,
        confidence: 0.9, // Higher confidence for final result
        endOfSpeech: true,
        timestamp: new Date()
      };

      this.emitFinalResult(result);
      this.reset();
      
      return result;

    } catch (error) {
      console.error('❌ Error flushing audio:', error);
      throw error;
    }
  }

  async reset(): Promise<void> {
    this.clearBuffer();
    this.currentPartialTranscript = '';
    this.lastProcessedChunk = -1;
    this.stopPartialUpdateTimer();
    this.startPartialUpdateTimer();
  }

  getPartialTranscript(): string {
    return this.currentPartialTranscript;
  }

  private shouldProcessPartial(): boolean {
    // Process partial results every few chunks or when buffer is large enough
    const bufferSize = this.audioBuffer.length;
    const timeSinceLastProcess = Date.now() - (this.audioBuffer[this.audioBuffer.length - 1]?.timestamp || 0);
    
    return bufferSize >= 5 || timeSinceLastProcess > 200; // Process every 5 chunks or 200ms
  }

  private async processPartialAudio(): Promise<Partial<StreamingSTTResult>> {
    try {
      const audio = this.getAudioBuffer();
      if (audio.length === 0) return { transcript: '' };

      // Use a smaller model or faster processing for partial results
      const partialTranscript = await this.transcribePartialAudio(audio);
      
      return {
        transcript: partialTranscript,
        confidence: 0.7
      };

    } catch (error) {
      console.warn('⚠️ Partial audio processing failed:', error);
      return { transcript: this.currentPartialTranscript };
    }
  }

  private async transcribePartialAudio(audio: Buffer): Promise<string> {
    // For partial results, we can use faster processing
    // This could be a smaller model or different approach
    try {
      if (this.whisperConfig.primaryProvider === 'python-whisper' && this.pythonWhisper) {
        // Use faster model for partial results
        const wav = this.encodePCM16ToWav(audio, 16000);
        return await this.pythonWhisper.transcribeWavBuffer(wav);
      } else if (this.whisperConfig.primaryProvider === 'openai' && this.openaiWhisper) {
        const wav = this.encodePCM16ToWav(audio, 16000);
        return await this.openaiWhisper.transcribeWavBuffer(wav);
      }
      return '';
    } catch (error) {
      console.warn('⚠️ Partial transcription failed:', error);
      return '';
    }
  }

  private async transcribeCompleteAudio(audio: Buffer): Promise<string> {
    try {
      if (this.whisperConfig.primaryProvider === 'python-whisper' && this.pythonWhisper) {
        const wav = this.encodePCM16ToWav(audio, 16000);
        return await this.pythonWhisper.transcribeWavBuffer(wav);
      } else if (this.whisperConfig.primaryProvider === 'openai' && this.openaiWhisper) {
        const wav = this.encodePCM16ToWav(audio, 16000);
        return await this.openaiWhisper.transcribeWavBuffer(wav);
      }
      
      // Try fallback
      if (this.whisperConfig.fallbackProvider === 'python-whisper' && this.pythonWhisper) {
        const wav = this.encodePCM16ToWav(audio, 16000);
        return await this.pythonWhisper.transcribeWavBuffer(wav);
      } else if (this.whisperConfig.fallbackProvider === 'openai' && this.openaiWhisper) {
        const wav = this.encodePCM16ToWav(audio, 16000);
        return await this.openaiWhisper.transcribeWavBuffer(wav);
      }
      
      throw new Error('No STT provider available');
    } catch (error) {
      console.error('❌ Complete audio transcription failed:', error);
      throw error;
    }
  }

  private startPartialUpdateTimer(): void {
    this.partialUpdateTimer = setInterval(() => {
      if (this.audioBuffer.length > 0 && !this.isEndOfSpeech()) {
        this.processPartialAudio().then(result => {
          if (result.transcript && result.transcript !== this.currentPartialTranscript) {
            this.currentPartialTranscript = result.transcript;
            this.emitPartialResult(result);
          }
        }).catch(console.warn);
      }
    }, 100); // Update every 100ms
  }

  private stopPartialUpdateTimer(): void {
    if (this.partialUpdateTimer) {
      clearInterval(this.partialUpdateTimer);
      this.partialUpdateTimer = null;
    }
  }

  // Helper method to encode PCM to WAV (you might already have this)
  private encodePCM16ToWav(pcmData: Buffer, sampleRate: number): Buffer {
    // This is a simplified WAV encoder - you might want to use a proper library
    const dataLength = pcmData.length;
    const fileLength = 36 + dataLength;
    
    const buffer = Buffer.alloc(fileLength);
    
    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(fileLength - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (PCM)
    buffer.writeUInt16LE(1, 22); // channels
    buffer.writeUInt32LE(sampleRate, 24); // sample rate
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32); // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataLength, 40);
    
    // Copy PCM data
    pcmData.copy(buffer, 44);
    
    return buffer;
  }
}
