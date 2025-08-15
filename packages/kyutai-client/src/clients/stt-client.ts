import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import path from 'path';

export interface STTConfig {
  language: string;
  sampleRate: number;
  encoding: string;
  interimResults?: boolean;
  enableVoiceActivityDetection?: boolean;
}

export interface STTResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  alternatives?: Array<{
    transcript: string;
    confidence: number;
  }>;
  words?: Array<{
    word: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
}

export class KyutaiSTTClient extends EventEmitter {
  private client: any;
  private connected: boolean = false;
  private demoMode: boolean;

  constructor() {
    super();
    this.demoMode = process.env.DEMO_MODE === 'true';
  }

  async connect(): Promise<void> {
    if (this.demoMode) {
      console.log('🎭 STT Client running in demo mode');
      this.connected = true;
      return;
    }

    try {
      const protoPath = path.join(__dirname, '../../proto/moshi_stt.proto');
      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const sttProto = grpc.loadPackageDefinition(packageDefinition) as any;
      const endpoint = process.env.KYUTAI_MOSHI_STT_ENDPOINT || '34.14.197.169:8082';

      this.client = new sttProto.moshi.stt.SpeechToText(
        endpoint,
        grpc.credentials.createInsecure()
      );

      this.connected = true;
      console.log('✅ STT Client connected to', endpoint);
    } catch (error) {
      console.error('❌ STT Client connection failed:', error);
      throw error;
    }
  }

  async recognize(audioBuffer: Buffer, config: STTConfig): Promise<STTResult> {
    if (this.demoMode) {
      return this.createMockSTTResult(audioBuffer, config);
    }

    if (!this.connected) {
      throw new Error('STT Client not connected');
    }

    return new Promise((resolve, reject) => {
      const request = {
        config: {
          encoding: this.mapAudioEncoding(config.encoding),
          sampleRateHertz: config.sampleRate,
          languageCode: config.language,
          maxAlternatives: 3,
          enableWordTimeOffsets: true,
        },
        audioContent: audioBuffer,
      };

      this.client.recognize(request, (error: any, response: any) => {
        if (error) {
          reject(error);
        } else {
          const result = this.parseSTTResponse(response);
          resolve(result);
        }
      });
    });
  }

  createStreamingRecognition(config: STTConfig): NodeJS.ReadWriteStream {
    if (this.demoMode) {
      return this.createMockStreamingSTT(config);
    }

    if (!this.connected) {
      throw new Error('STT Client not connected');
    }

    const call = this.client.streamingRecognize();

    // Attach error and data event handlers for robust streaming
    call.on('error', (error: any) => {
      this.emit('error', error);
    });
    call.on('data', (data: any) => {
      this.emit('data', data);
    });

    // Send initial configuration
    call.write({
      streamingConfig: {
        config: {
          encoding: this.mapAudioEncoding(config.encoding),
          sampleRateHertz: config.sampleRate,
          languageCode: config.language,
          maxAlternatives: 3,
          enableWordTimeOffsets: true,
        },
        interimResults: typeof config.interimResults !== 'undefined' ? config.interimResults : true,
        enableVoiceActivityEvents: typeof config.enableVoiceActivityDetection !== 'undefined' ? config.enableVoiceActivityDetection : true,
      },
    });

    return call;
  }

  // New method to stream audio with proper accumulation of chunks for reliable STT processing
  streamAudioFrom(audioStream: NodeJS.ReadableStream, config: STTConfig): void {
    if (!this.connected) {
      throw new Error('STT Client not connected');
    }
    // Create the streaming call and attach event handlers
    const call = this.createStreamingRecognition(config);
    let bufferAccumulator = Buffer.alloc(0);
    const threshold = 16384; // send chunk when 16KB accumulated

    // Listen to incoming audio stream data
    audioStream.on('data', (chunk: Buffer) => {
      bufferAccumulator = Buffer.concat([bufferAccumulator, chunk]);
      while (bufferAccumulator.length >= threshold) {
        const chunkToSend = bufferAccumulator.slice(0, threshold);
        // Wrap the audio chunk inside an object as expected
        call.write({ audioContent: chunkToSend } as any);
        bufferAccumulator = bufferAccumulator.slice(threshold);
      }
    });

    // When the audio stream ends, send any remaining data and close the call
    audioStream.on('end', () => {
      if (bufferAccumulator.length > 0) {
        call.write({ audioContent: bufferAccumulator } as any);
      }
      call.end();
      console.log('📨 [STT] Audio stream ended and final data sent');
    });

    // Forward STT responses as events
    call.on('data', (data: any) => {
      this.emit('data', data);
    });
    call.on('error', (error: any) => {
      this.emit('error', error);
    });
  }

  private createMockSTTResult(audioBuffer: Buffer, config: STTConfig): STTResult {
    // Simulate processing delay
    const audioLength = audioBuffer.length;
    const estimatedDuration = audioLength / (config.sampleRate * 2); // Rough estimate for 16-bit audio

    // Mock transcripts based on audio length
    const mockTranscripts = [
      "Hello, how can I help you today?",
      "I'm interested in learning more about your AI calling agents.",
      "That sounds great. Can you tell me more about the pricing?",
      "Thank you for the information. I'd like to schedule a demo.",
      "Yes, I understand. When would be the best time to call back?",
      "Perfect. I look forward to hearing from you soon.",
    ];

    const transcript = mockTranscripts[Math.floor(Math.random() * mockTranscripts.length)];
    const confidence = 0.85 + Math.random() * 0.1; // 0.85-0.95

    return {
      transcript,
      confidence,
      isFinal: true,
      alternatives: [
        { transcript, confidence },
        { 
          transcript: transcript.toLowerCase(), 
          confidence: confidence - 0.1 
        },
      ],
      words: this.generateMockWords(transcript, estimatedDuration),
    };
  }

  private createMockStreamingSTT(config: STTConfig): NodeJS.ReadWriteStream {
    const { PassThrough } = require('stream');
    const stream = new PassThrough({ objectMode: true });

    let wordBuffer = '';
    let sentenceBuffer = '';

    stream.on('data', (chunk: Buffer) => {
      // Simulate real-time transcription
      setTimeout(() => {
        // Mock interim results
        if (Math.random() > 0.7) {
          wordBuffer += this.getRandomWord() + ' ';
          stream.emit('data', {
            results: [{
              alternatives: [{ 
                transcript: wordBuffer.trim(),
                confidence: 0.6 + Math.random() * 0.2 
              }],
              isFinal: false,
            }],
            speechEventType: 'VOICE_ACTIVITY_BEGIN',
          });
        }

        // Mock final results
        if (wordBuffer.split(' ').length >= 5 || Math.random() > 0.9) {
          sentenceBuffer = wordBuffer.trim();
          if (sentenceBuffer) {
            stream.emit('data', {
              results: [{
                alternatives: [{ 
                  transcript: sentenceBuffer,
                  confidence: 0.85 + Math.random() * 0.1 
                }],
                isFinal: true,
              }],
              speechEventType: 'END_OF_SINGLE_UTTERANCE',
            });
            wordBuffer = '';
          }
        }
      }, 100 + Math.random() * 200);
    });

    return stream;
  }

  private generateMockWords(transcript: string, duration: number): Array<{
    word: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }> {
    const words = transcript.split(' ');
    const wordDuration = duration / words.length;
    
    return words.map((word, index) => ({
      word,
      startTime: index * wordDuration,
      endTime: (index + 1) * wordDuration,
      confidence: 0.8 + Math.random() * 0.15,
    }));
  }

  private getRandomWord(): string {
    const words = [
      'hello', 'yes', 'no', 'please', 'thank', 'you', 'can', 'help', 'me',
      'I', 'am', 'interested', 'in', 'your', 'service', 'product', 'today',
      'great', 'excellent', 'wonderful', 'amazing', 'perfect', 'sure',
    ];
    return words[Math.floor(Math.random() * words.length)];
  }

  private mapAudioEncoding(encoding: string): number {
    const encodingMap: { [key: string]: number } = {
      'LINEAR16': 1,
      'FLAC': 2,
      'MULAW': 3,
      'AMR': 4,
      'AMR_WB': 5,
      'OGG_OPUS': 6,
      'WEBM_OPUS': 8,
    };
    return encodingMap[encoding.toUpperCase()] || 1;
  }

  private parseSTTResponse(response: any): STTResult {
    const result = response.results[0];
    const alternative = result.alternatives[0];

    return {
      transcript: alternative.transcript,
      confidence: alternative.confidence,
      isFinal: result.isFinal,
      alternatives: result.alternatives.map((alt: any) => ({
        transcript: alt.transcript,
        confidence: alt.confidence,
      })),
      words: alternative.words?.map((word: any) => ({
        word: word.word,
        startTime: parseInt(word.startTimeNanos) / 1e9,
        endTime: parseInt(word.endTimeNanos) / 1e9,
        confidence: word.confidence,
      })),
    };
  }

  disconnect(): void {
    if (this.client) {
      this.client.close();
    }
    this.connected = false;
    console.log('🔌 STT Client disconnected');
  }
}
