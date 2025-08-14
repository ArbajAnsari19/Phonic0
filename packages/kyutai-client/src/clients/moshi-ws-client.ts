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
      // Add custom authentication header
      const wsOptions: any = {};
      if (this.authToken) {
        wsOptions.headers = {
          'kyutai-api-key': this.authToken  // Use custom header instead of Authorization
        };
      }
      
      const ws = new WebSocket(this.baseUrl, wsOptions);
      this.ws = ws;

      ws.on('open', () => {
        this.connected = true;
        // Send init depending on protocol
        try {
          if (this.protocol === 'fixed') {
            if (mode === 'api/asr-streaming') {
              ws.send(JSON.stringify({ type: 'start_conversation', brain_id: startPayload?.config?.brainId || 'default' }));
            }
            // tts mode has no explicit start in fixed protocol
          } else {
            if (startPayload) {
              ws.send(JSON.stringify({ type: `${mode}_start`, ...startPayload }));
            }
          }
        } catch {}
        resolve();
      });

      ws.on('message', (data: WebSocket.RawData) => {
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
        } catch {
          // not JSON; ignore
        }
      });

      ws.on('error', (err) => {
        this.events.onError?.(err as any);
        if (!this.connected) reject(err);
      });

      ws.on('close', () => {
        this.connected = false;
      });
    });
  }

  sendAudioChunk(buffer: Buffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.protocol === 'fixed') {
      // Send JSON with base64 audio
      this.ws.send(JSON.stringify({ type: 'audio_chunk', audio: buffer.toString('base64'), is_final: false }));
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
      if (this.protocol === 'fixed') {
        if (this.mode === 'api/asr-streaming') {
          // Send a final marker and then end conversation
          try { this.ws.send(JSON.stringify({ type: 'audio_chunk', audio: '', is_final: true })); } catch {}
          this.ws.send(JSON.stringify({ type: 'end_conversation' }));
        } else {
          // no-op for tts
        }
      } else {
        this.ws.send(JSON.stringify({ type: `${this.mode}_end` }));
      }
    } catch {}
    this.ws.close();
    this.connected = false;
  }
}


