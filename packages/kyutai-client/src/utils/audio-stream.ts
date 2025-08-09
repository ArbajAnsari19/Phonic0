import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { KyutaiSTTClient, STTConfig } from '../clients/stt-client';
import { KyutaiTTSClient, TTSConfig } from '../clients/tts-client';

interface AudioSession {
  id: string;
  ws: WebSocket;
  sttStream?: NodeJS.ReadWriteStream;
  ttsStream?: NodeJS.ReadWriteStream;
  isSTTActive: boolean;
  isTTSActive: boolean;
  createdAt: Date;
}

export class AudioStreamManager {
  private sessions: Map<string, AudioSession> = new Map();

  createSession(ws: WebSocket): string {
    const sessionId = uuidv4();
    const session: AudioSession = {
      id: sessionId,
      ws,
      isSTTActive: false,
      isTTSActive: false,
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    console.log(`🎧 Created audio session: ${sessionId}`);

    return sessionId;
  }

  async startSTTStream(sessionId: string, config: STTConfig, sttClient: KyutaiSTTClient): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.isSTTActive) {
      throw new Error('STT stream already active');
    }

    try {
      const sttStream = sttClient.createStreamingRecognition(config);
      session.sttStream = sttStream;
      session.isSTTActive = true;

      // Handle STT results
      sttStream.on('data', (result) => {
        const message = {
          type: 'stt_result',
          sessionId,
          data: result,
          timestamp: new Date().toISOString(),
        };

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(message));
        }
      });

      sttStream.on('error', (error) => {
        console.error('STT stream error:', error);
        const message = {
          type: 'stt_error',
          sessionId,
          error: error.message,
          timestamp: new Date().toISOString(),
        };

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(message));
        }

        session.isSTTActive = false;
      });

      sttStream.on('end', () => {
        console.log('STT stream ended for session:', sessionId);
        session.isSTTActive = false;
        
        const message = {
          type: 'stt_ended',
          sessionId,
          timestamp: new Date().toISOString(),
        };

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(message));
        }
      });

      console.log(`🎤 Started STT stream for session: ${sessionId}`);

      // Send confirmation
      const message = {
        type: 'stt_started',
        sessionId,
        config,
        timestamp: new Date().toISOString(),
      };

      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }

    } catch (error) {
      console.error('Failed to start STT stream:', error);
      throw error;
    }
  }

  async processAudioChunk(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isSTTActive || !session.sttStream) {
      return;
    }

    try {
      // Send audio data to STT stream
      session.sttStream.write(audioData);
    } catch (error) {
      console.error('Error processing audio chunk:', error);
      
      const message = {
        type: 'audio_error',
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };

      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }
    }
  }

  async endSTTStream(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isSTTActive) {
      return;
    }

    try {
      if (session.sttStream) {
        session.sttStream.end();
        session.sttStream = undefined;
      }
      session.isSTTActive = false;

      console.log(`🎤 Ended STT stream for session: ${sessionId}`);
    } catch (error) {
      console.error('Error ending STT stream:', error);
    }
  }

  async startTTSStream(sessionId: string, config: TTSConfig, ttsClient: KyutaiTTSClient): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    if (session.isTTSActive) {
      throw new Error('TTS stream already active');
    }

    try {
      const ttsStream = ttsClient.createStreamingSynthesis(config);
      session.ttsStream = ttsStream;
      session.isTTSActive = true;

      // Handle TTS results
      ttsStream.on('data', (result) => {
        const message = {
          type: 'tts_result',
          sessionId,
          data: {
            audioContent: result.audioContent.toString('base64'),
            timepoints: result.timepoints,
            isFinal: result.isFinal,
          },
          timestamp: new Date().toISOString(),
        };

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(message));
        }
      });

      ttsStream.on('error', (error) => {
        console.error('TTS stream error:', error);
        const message = {
          type: 'tts_error',
          sessionId,
          error: error.message,
          timestamp: new Date().toISOString(),
        };

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(message));
        }

        session.isTTSActive = false;
      });

      ttsStream.on('end', () => {
        console.log('TTS stream ended for session:', sessionId);
        session.isTTSActive = false;
        
        const message = {
          type: 'tts_ended',
          sessionId,
          timestamp: new Date().toISOString(),
        };

        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify(message));
        }
      });

      console.log(`🔊 Started TTS stream for session: ${sessionId}`);

      // Send confirmation
      const message = {
        type: 'tts_started',
        sessionId,
        config,
        timestamp: new Date().toISOString(),
      };

      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }

    } catch (error) {
      console.error('Failed to start TTS stream:', error);
      throw error;
    }
  }

  async synthesizeText(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isTTSActive || !session.ttsStream) {
      return;
    }

    try {
      // Send text to TTS stream
      session.ttsStream.write(text);
    } catch (error) {
      console.error('Error synthesizing text:', error);
      
      const message = {
        type: 'tts_error',
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      };

      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify(message));
      }
    }
  }

  async endTTSStream(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isTTSActive) {
      return;
    }

    try {
      if (session.ttsStream) {
        session.ttsStream.end();
        session.ttsStream = undefined;
      }
      session.isTTSActive = false;

      console.log(`🔊 Ended TTS stream for session: ${sessionId}`);
    } catch (error) {
      console.error('Error ending TTS stream:', error);
    }
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // Clean up streams
    if (session.isSTTActive && session.sttStream) {
      session.sttStream.end();
    }

    if (session.isTTSActive && session.ttsStream) {
      session.ttsStream.end();
    }

    this.sessions.delete(sessionId);
    console.log(`🗑️ Destroyed audio session: ${sessionId}`);
  }

  getSessionInfo(sessionId: string): any {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      isSTTActive: session.isSTTActive,
      isTTSActive: session.isTTSActive,
      createdAt: session.createdAt,
      uptime: Date.now() - session.createdAt.getTime(),
    };
  }

  getAllSessions(): any[] {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      isSTTActive: session.isSTTActive,
      isTTSActive: session.isTTSActive,
      createdAt: session.createdAt,
      uptime: Date.now() - session.createdAt.getTime(),
    }));
  }
}
