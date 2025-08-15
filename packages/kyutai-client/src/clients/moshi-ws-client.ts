import WebSocket from 'ws';

export type MoshiMode = 'api/asr-streaming' | 'api/tts_streaming' ;

export interface MoshiSTTConfig {
  language: string;
  sampleRate: number;
  encoding: string;
  interimResults?: boolean;
  enableVoiceActivityDetection?: boolean;
}

export interface MoshiTTSConfig {
  voice?: {
    languageCode?: string;
    name?: string;
    gender?: 'MALE' | 'FEMALE' | 'NEUTRAL';
  };
  audioConfig?: {
    audioEncoding?: string;
    sampleRateHertz?: number;
    speakingRate?: number;
    pitch?: number;
    volumeGainDb?: number;
  };
  enableLowLatency?: boolean;
}

export interface MoshiEvents {
  onSTTResult?: (payload: any) => void;
  onTTSAudio?: (payload: { audioBase64: string; isFinal?: boolean; timepoints?: any[] }) => void;
  onError?: (err: Error | string) => void;
  onRaw?: (raw: string | Buffer) => void;
}

/**
 * Minimal Moshi WebSocket client.
 *
 * Since Moshi server message schema can vary, we implement a tolerant bridge:
 * - Sends a generic start message with provided config
 * - Sends audio/text payloads
 * - Tries to map common transcription and audio fields back to our callers
 * - Always forwards raw upstream messages via onRaw for debugging
 */
type MoshiProtocol = 'generic' | 'fixed';

interface MoshiClientOptions {
  protocol?: MoshiProtocol; // 'fixed' for the Colab server provided by user
  audioMode?: 'binary' | 'base64';
  authToken?: string; // Add this back
}

export class MoshiWSClient {
  private readonly baseUrl: string;
  private readonly protocol: MoshiProtocol;
  private readonly audioMode: 'binary' | 'base64';
  private readonly authToken?: string; // Add this back
  private ws?: WebSocket;
  private connected = false;
  private mode: MoshiMode | null = null;
  private events: MoshiEvents = {};

  constructor(baseUrl: string, options: MoshiClientOptions = {}) {
    this.baseUrl = baseUrl;
    this.protocol = options.protocol || (process.env.MOSHI_PROTOCOL as MoshiProtocol) || 'generic';
    this.audioMode = options.audioMode || 'binary';
    this.authToken = options.authToken || process.env.KYUTAI_API_KEY; // Use the env var
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(mode: MoshiMode, events: MoshiEvents, startPayload?: any): Promise<void> {
    this.mode = mode;
    this.events = events;

    return new Promise((resolve, reject) => {
      // Add connection timeout to prevent hanging
      const connectionTimeout = setTimeout(() => {
        reject(new Error(`WebSocket connection timeout to ${this.baseUrl}`));
      }, 10000); // 10 seconds

      console.log(`🔌 [WS] Attempting connection to: ${this.baseUrl}`);
      console.log(`🔑 [WS] Using auth token: ${this.authToken}`);

      const wsOptions: any = {};
      if (this.authToken) {
        wsOptions.headers = {
          'kyutai-api-key': this.authToken
        };
      }
      
      const ws = new WebSocket(this.baseUrl, wsOptions);
      this.ws = ws;

      ws.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log(`✅ [WS] Connected to: ${this.baseUrl}`);
        this.connected = true;
        
        // ✅ CRITICAL: Send proper start message for ASR streaming
        if (mode === 'api/asr-streaming') {
          try {
            // ✅ TRY: Simple start message first
            ws.send(JSON.stringify({ 
              type: 'start'
            }));
            console.log('🚀 [WS] Sent simple start message for ASR streaming');
          } catch (error) {
            console.error('❌ [WS] Failed to send start message:', error);
          }
        }
        
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
        // ✅ CRITICAL: Log ALL incoming messages for debugging
        console.log('🔍 [Moshi] Raw message received:', {
          type: typeof data,
          size: data instanceof ArrayBuffer ? data.byteLength : data.length,
          data: typeof data === 'string' ? data : 'binary'
        });
        
        // Always forward raw for debugging
        // Normalize raw for callback
        if (typeof data === 'string') {
          this.events.onRaw?.(data);
        } else if (Buffer.isBuffer(data)) {
          this.events.onRaw?.(data);
        } else if (data instanceof ArrayBuffer) {
          this.events.onRaw?.(Buffer.from(data));
        }

        // Try JSON parse
        let text: string | null = null;
        if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
          // For TTS, servers may stream raw audio; map to base64
          if (this.mode === 'api/tts_streaming') {
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
            this.events.onTTSAudio?.({ audioBase64: buf.toString('base64'), isFinal: false });
          }
          return;
        } else if (typeof data === 'string') {
          text = data;
        }

        if (!text) return;

        try {
          const msg = JSON.parse(text);
          console.log('🔍 [Moshi] Parsed message:', msg);
          
          // ✅ CRITICAL: Handle ASR streaming results properly
          if (this.mode === 'api/asr-streaming') {
            if (msg.type === 'partial_transcript' || msg.type === 'transcript') {
              const transcript = msg.transcript || msg.partial_text || msg.text || '';
              const isFinal = msg.is_final || msg.final || msg.isFinal || false;
              const confidence = msg.confidence || msg.score || 0.8;
              
              if (transcript) {
                console.log(`🚀 [Moshi] STT Result: "${transcript}" (${isFinal ? 'FINAL' : 'PARTIAL'})`);
                this.events.onSTTResult?.({ transcript, isFinal, confidence, raw: msg });
              }
            } else if (msg.type === 'error') {
              console.error('❌ [Moshi] Server error:', msg);
              this.events.onError?.(msg.error || 'Unknown server error');
            } else if (msg.type === 'ready') {
              console.log('✅ [Moshi] Server ready for audio processing');
            }
          }
          
          // Try JSON parse
          if (this.protocol === 'fixed') {
            // Specific handling for the provided Colab server
            switch (msg.type) {
              case 'partial_transcript': {
                const transcript = msg.partial_text || msg.transcript || '';
                this.events.onSTTResult?.({ transcript, isFinal: false, confidence: undefined, raw: msg });
                break;
              }
              case 'audio_response': {
                // Final transcript + synthesized audio
                const transcript = msg.transcript || '';
                this.events.onSTTResult?.({ transcript, isFinal: true, confidence: undefined, raw: msg });
                if (msg.audio) {
                  this.events.onTTSAudio?.({ audioBase64: msg.audio, isFinal: true });
                }
                break;
              }
              case 'text_response': {
                if (msg.audio) {
                  this.events.onTTSAudio?.({ audioBase64: msg.audio, isFinal: true });
                }
                break;
              }
              default:
                // ignore others or forward via onRaw
                break;
            }
          } else {
            // Generic heuristic
            if (this.mode === 'api/asr-streaming') {
              const transcript = msg.transcript || msg.text || msg.partial || msg.result;
              const isFinal = Boolean(msg.is_final ?? msg.final ?? msg.isFinal ?? msg.done);
              const confidence = msg.confidence ?? msg.score ?? undefined;
              if (transcript) {
                this.events.onSTTResult?.({ transcript, isFinal, confidence, raw: msg });
              }
            }
            if (this.mode === 'api/tts_streaming') {
              const audioB64 = msg.audioBase64 || msg.audio || msg.audio_content || msg.chunk;
              if (audioB64 && typeof audioB64 === 'string') {
                const isFinal = Boolean(msg.is_final ?? msg.final ?? msg.isFinal ?? msg.done);
                const timepoints = msg.timepoints;
                this.events.onTTSAudio?.({ audioBase64: audioB64, isFinal, timepoints });
              }
            }
          }
        } catch (error) {
          console.error('❌ [Moshi] Failed to parse message:', error);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        console.error(`❌ [WS] Connection error to ${this.baseUrl}:`, err);
        this.events.onError?.(err as any);
        if (!this.connected) reject(err);
      });

      ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        console.log(`🔌 [WS] Connection closed to ${this.baseUrl}:`, { 
          code, 
          reason: reason.toString(),
          codeMeaning: this.getCloseCodeMeaning(code)
        });
        this.connected = false;
      });
    });
  }

  sendAudioChunk(buffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    console.log(` [Moshi] Sending audio chunk: ${buffer.length} bytes`);
    
    // ✅ CRITICAL: Send audio as base64 for ASR streaming
    if (this.mode === 'api/asr-streaming') {
      this.ws.send(JSON.stringify({ 
        type: 'audio_chunk', 
        audio: buffer.toString('base64'), 
        is_final: false 
      }));
    } else {
      if (this.audioMode === 'binary') {
        this.ws.send(buffer);
      } else {
        this.ws.send(JSON.stringify({ type: 'audio_chunk', data: buffer.toString('base64') }));
      }
    }
  }

  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.protocol === 'fixed') {
      this.ws.send(JSON.stringify({ type: 'text_input', text }));
    } else {
      this.ws.send(JSON.stringify({ type: 'synthesize_text', text }));
    }
  }

  stop(): void {
    if (!this.ws) return;
    
    try {
      // ✅ CRITICAL: Send proper end message for ASR streaming
      if (this.mode === 'api/asr-streaming') {
        this.ws.send(JSON.stringify({ type: 'end' }));
        console.log('🛑 [Moshi] Sent end message for ASR streaming');
      }
    } catch (error) {
      console.error('❌ [Moshi] Failed to send end message:', error);
    }
    
    this.ws.close();
    this.connected = false;
  }

  // ✅ CRITICAL: Add close code meanings
  private getCloseCodeMeaning(code: number): string {
    switch (code) {
      case 1000: return 'Normal Closure';
      case 1001: return 'Going Away';
      case 1002: return 'Protocol Error';
      case 1003: return 'Unsupported Data';
      case 1005: return 'No Status Received';
      case 1006: return 'Abnormal Closure';
      case 1007: return 'Invalid frame payload data';
      case 1008: return 'Policy Violation';
      case 1009: return 'Message too big';
      case 1010: return 'Client terminating';
      case 1011: return 'Server error';
      case 1015: return 'TLS Handshake';
      default: return 'Unknown';
    }
  }
}


