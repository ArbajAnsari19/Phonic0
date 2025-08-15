import axios from 'axios';
import WebSocket from 'ws';

export interface STTConfig {
  language: string;
  sampleRate: number;
  encoding: string;
  interimResults?: boolean;
  enableVoiceActivityDetection?: boolean;
}

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

export interface STTResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
  alternatives?: Array<{
    transcript: string;
    confidence: number;
  }>;
}

export interface TTSResult {
  audioContent: Buffer;
  timepoints?: Array<{
    markName: string;
    timeSeconds: number;
  }>;
}

export class KyutaiIntegration {
  private readonly baseUrl: string;
  private audioSessions: Map<string, WebSocket> = new Map();
  private sttCallbacks: Map<string, (result: STTResult) => void> = new Map();

  constructor() {
    this.baseUrl = process.env.KYUTAI_SERVICE_URL || 'http://localhost:3003';
  }

  async initialize(): Promise<void> {
    try {
      // Check if Kyutai service is available
      const response = await axios.get(`${this.baseUrl}/health`);
      
      if (response.data.success) {
        console.log('✅ Kyutai integration initialized');
      } else {
        throw new Error('Kyutai service health check failed');
      }
    } catch (error) {
      console.error('❌ Kyutai integration failed:', error);
      
      if (process.env.DEMO_MODE === 'true') {
        console.log('🎭 Continuing in demo mode without Kyutai service');
      } else {
        throw error;
      }
    }
  }

  async createAudioSession(): Promise<string> {
    try {
      const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      
      // Add API key as query parameter for WebSocket connection
      const wsOptions: any = {};
      const apiKey = process.env.KYUTAI_API_KEY || 'public_token';
      wsOptions.headers = {
        'kyutai-api-key': apiKey
      };

      const ws = new WebSocket(wsUrl, wsOptions);

      return new Promise((resolve, reject) => {
        ws.on('open', () => {
          const sessionId = this.generateSessionId();
          this.audioSessions.set(sessionId, ws);

          console.log(`🎧 Created Kyutai audio session: ${sessionId}`);
          resolve(sessionId);
        });

        ws.on('error', (error) => {
          reject(error);
        });

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            // Pass along the local session id so we can hit the right callback
            this.handleKyutaiMessage(message, /* local */ this.findLocalSessionIdByWS(ws));
          } catch (error) {
            console.error('Error parsing Kyutai message:', error);
          }
        });
      });

    } catch (error) {
      console.error('Error creating Kyutai audio session:', error);
      if (process.env.DEMO_MODE === 'true') {
        const mockSessionId = this.generateSessionId();
        console.log(`🎭 Created mock audio session: ${mockSessionId}`);
        return mockSessionId;
      }
      throw error;
    }
  }

  async startSTTStream(sessionId: string, config: STTConfig): Promise<void> {
    const ws = this.audioSessions.get(sessionId);
    
    if (!ws && process.env.DEMO_MODE !== 'true') {
      throw new Error('Audio session not found');
    }

    if (ws) {
      const message = {
        type: 'start_stt',
        config,
      };
      
      ws.send(JSON.stringify(message));
    }

    console.log(`🎤 Started STT stream for session: ${sessionId}`);
  }

  async sendAudioChunk(sessionId: string, audioData: Buffer): Promise<void> {
    const ws = this.audioSessions.get(sessionId);
    
    if (!ws && process.env.DEMO_MODE !== 'true') {
      throw new Error('Audio session not found');
    }

    if (ws) {
      const message = {
        type: 'audio_chunk',
        data: audioData.toString('base64'),
      };
      
      ws.send(JSON.stringify(message));
    }
  }

  async stopSTTStream(sessionId: string): Promise<STTResult | null> {
    const ws = this.audioSessions.get(sessionId);
    
    if (!ws && process.env.DEMO_MODE !== 'true') {
      throw new Error('Audio session not found');
    }

    if (ws) {
      const message = {
        type: 'end_stt',
      };
      
      ws.send(JSON.stringify(message));
    }

    // Return mock result in demo mode
    if (process.env.DEMO_MODE === 'true' || !ws) {
      return this.generateMockSTTResult();
    }

    // In real mode, this would wait for the final STT result
    // For now, returning null and handling via callback
    return null;
  }

  async synthesizeSpeech(text: string, config: TTSConfig): Promise<TTSResult> {
    try {
      const response = await axios.post(`${this.baseUrl}/api/tts/synthesize`, {
        text,
        config,
      });

      if (response.data.success) {
        return {
          audioContent: Buffer.from(response.data.data.audioContent, 'base64'),
          timepoints: response.data.data.timepoints,
        };
      } else {
        throw new Error('TTS synthesis failed');
      }

    } catch (error) {
      console.error('Error synthesizing speech:', error);
      
      // Return mock audio in demo mode
      if (process.env.DEMO_MODE === 'true') {
        return this.generateMockTTSResult(text);
      }
      
      throw error;
    }
  }

  async startTTSStream(sessionId: string, config: TTSConfig): Promise<void> {
    const ws = this.audioSessions.get(sessionId);
    
    if (!ws && process.env.DEMO_MODE !== 'true') {
      throw new Error('Audio session not found');
    }

    if (ws) {
      const message = {
        type: 'start_tts',
        config,
      };
      
      ws.send(JSON.stringify(message));
    }

    console.log(`🔊 Started TTS stream for session: ${sessionId}`);
  }

  async stopTTSStream(sessionId: string): Promise<void> {
    const ws = this.audioSessions.get(sessionId);
    
    if (!ws && process.env.DEMO_MODE !== 'true') {
      throw new Error('Audio session not found');
    }

    if (ws) {
      const message = {
        type: 'end_tts',
      };
      
      ws.send(JSON.stringify(message));
    }

    console.log(`🔊 Stopped TTS stream for session: ${sessionId}`);
  }

  async destroyAudioSession(sessionId: string): Promise<void> {
    const ws = this.audioSessions.get(sessionId);
    
    if (ws) {
      ws.close();
      this.audioSessions.delete(sessionId);
    }
    
    this.sttCallbacks.delete(sessionId);
    console.log(`🗑️ Destroyed Kyutai audio session: ${sessionId}`);
  }

  // Set callback for STT results
  setSTTCallback(sessionId: string, callback: (result: STTResult) => void): void {
    this.sttCallbacks.set(sessionId, callback);
  }

  private handleKyutaiMessage(message: any, localSessionId?: string): void {
    switch (message.type) {
      case 'stt_result': {
        const sid = localSessionId || message.sessionId; // prefer local session mapping
        const callback = sid ? this.sttCallbacks.get(sid) : undefined;
        if (callback && message.data?.results?.length > 0) {
          const result = message.data.results[0];
          // forward both partial and final
          const r = {
            transcript: result.alternatives?.[0]?.transcript || '',
            confidence: result.alternatives?.[0]?.confidence ?? 0.9,
            isFinal: !!result.isFinal,
            alternatives: result.alternatives,
          };
          callback(r);
        }
        break;
      }

      case 'stt_error':
        console.error('STT error from Kyutai:', message.error);
        break;

      case 'tts_result':
        break;

      case 'tts_error':
        console.error('TTS error from Kyutai:', message.error);
        break;

      default:
        console.log('Unknown Kyutai message type:', message.type);
    }
  }

  private findLocalSessionIdByWS(ws: WebSocket): string | undefined {
    for (const [sid, w] of this.audioSessions.entries()) {
      if (w === ws) return sid;
    }
    return undefined;
  }

  private generateSessionId(): string {
    return 'audio_' + Math.random().toString(36).substring(2, 15);
  }

  private generateMockSTTResult(): STTResult {
    const mockTranscripts = [
      "Hello, I'm interested in your services.",
      "Can you tell me more about pricing?",
      "That sounds great, how do we get started?",
      "I'd like to schedule a demo please.",
      "What are your business hours?",
      "Thank you for the information.",
      "I need to think about it and get back to you.",
      "Can you send me more details via email?",
    ];

    const transcript = mockTranscripts[Math.floor(Math.random() * mockTranscripts.length)];
    const confidence = 0.85 + Math.random() * 0.1; // 0.85-0.95

    return {
      transcript,
      confidence,
      isFinal: true,
      alternatives: [
        { transcript, confidence },
        { transcript: transcript.toLowerCase(), confidence: confidence - 0.1 },
      ],
    };
  }

  private generateMockTTSResult(text: string): TTSResult {
    // Generate mock audio data
    const estimatedDuration = this.estimateTextDuration(text);
    const sampleRate = 16000;
    const sampleCount = Math.floor(sampleRate * estimatedDuration);
    
    // Generate simple sine wave audio
    const audioBuffer = Buffer.alloc(sampleCount * 2); // 16-bit audio
    
    for (let i = 0; i < sampleCount; i++) {
      const t = i / sampleRate;
      const frequency = 200 + Math.sin(t * 2) * 50; // Varying frequency
      const amplitude = Math.sin(t * frequency * 2 * Math.PI) * 0.3;
      const sample = Math.floor(amplitude * 32767);
      audioBuffer.writeInt16LE(sample, i * 2);
    }
    
    // Generate timepoints for words
    const words = text.split(/\s+/);
    const timePerWord = estimatedDuration / words.length;
    const timepoints = words.map((word, index) => ({
      markName: word,
      timeSeconds: index * timePerWord,
    }));

    return {
      audioContent: audioBuffer,
      timepoints,
    };
  }

  private estimateTextDuration(text: string): number {
    // Rough estimation: average 150 words per minute
    const wordCount = text.split(/\s+/).length;
    return (wordCount / 150) * 60; // Convert to seconds
  }

  // Health check
  async checkHealth(): Promise<{ status: string; connected: boolean; sessions: number }> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, { timeout: 5000 });
      
      return {
        status: response.data.success ? 'healthy' : 'error',
        connected: true,
        sessions: this.audioSessions.size,
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        sessions: this.audioSessions.size,
      };
    }
  }

  // Get session information
  getSessionInfo(): any {
    return {
      activeSessions: this.audioSessions.size,
      sessions: Array.from(this.audioSessions.keys()),
      callbacks: this.sttCallbacks.size,
    };
  }
}
