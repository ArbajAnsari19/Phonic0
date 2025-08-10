import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConversationManager } from '../services/conversation-manager';
import { AuthIntegration } from '../services/auth-integration';
import fs from 'fs';
import path from 'path';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface ConversationSession {
  id: string;
  user: User;
  ws: WebSocket;
  token?: string;
  conversationId?: string;
  brainId?: string;
  brainName?: string;
  isActive: boolean;
  startTime: Date;
  lastActivity: Date;
  state: ConversationState;
  currentTurn?: ConversationTurn;
}

export interface ConversationState {
  phase: 'idle' | 'listening' | 'processing' | 'speaking' | 'completed' | 'error';
  turnCount: number;
  totalDuration: number;
  lastSTTResult?: string;
  lastLLMResponse?: string;
  lastTTSAudio?: Buffer;
  context: any[];
}

export interface ConversationTurn {
  id: string;
  userInput?: string;
  aiResponse?: string;
  audioInput?: Buffer;
  audioOutput?: Buffer;
  startTime: Date;
  endTime?: Date;
  metadata: {
    sttConfidence?: number;
    llmTokens?: number;
    ttsLatency?: number;
    processingTime?: number;
  };
}

export class ConversationEngine {
  private sessions: Map<string, ConversationSession> = new Map();
  private readonly maxSessionDuration: number;
  private readonly maxTurnsPerConversation: number;

  constructor(
    private conversationManager: ConversationManager,
    private authIntegration: AuthIntegration
  ) {
    this.maxSessionDuration = parseInt(process.env.MAX_CONVERSATION_DURATION || '1800') * 1000; // 30 min default
    this.maxTurnsPerConversation = parseInt(process.env.MAX_TURNS_PER_CONVERSATION || '50');
    
    // Clean up inactive sessions every 5 minutes
    setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
  }

  async createSession(ws: WebSocket, user: User, token?: string): Promise<string> {
    const sessionId = uuidv4();
    
    const session: ConversationSession = {
      id: sessionId,
      user,
      ws,
      token,
      isActive: true,
      startTime: new Date(),
      lastActivity: new Date(),
      state: {
        phase: 'idle',
        turnCount: 0,
        totalDuration: 0,
        context: [],
      },
    };

    this.sessions.set(sessionId, session);
    
    console.log(`🎯 Created conversation session: ${sessionId} for user: ${user.email}`);

    // Send welcome message
    this.sendMessage(sessionId, {
      type: 'session_created',
      sessionId,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      timestamp: new Date().toISOString(),
    });

    return sessionId;
  }

  async handleMessage(sessionId: string, message: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    session.lastActivity = new Date();

    try {
      console.log('🧭 [Engine] handleMessage', { sessionId, phase: session.state.phase, type: message?.type });
      switch (message.type) {
        case 'start_conversation':
          console.log('🧠 [Engine] start_conversation', { sessionId, brainId: message.brainId });
          await this.startConversation(sessionId, message.brainId);
          break;

        case 'start_listening':
          await this.startListening(sessionId);
          break;

        case 'audio_chunk':
          await this.processAudioChunk(sessionId, message.data);
          break;

        case 'stop_listening':
          await this.stopListening(sessionId);
          break;

        case 'text_input':
          await this.processTextInput(sessionId, message.text);
          break;

        case 'interrupt':
          await this.handleInterrupt(sessionId);
          break;

        case 'end_conversation':
          await this.endConversation(sessionId);
          break;

        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`❌ [Engine] Error handling message for session ${sessionId}:`, error);
      
      session.state.phase = 'error';
      this.sendMessage(sessionId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async startConversation(sessionId: string, brainId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    console.log(`🧠 [Engine] Starting conversation for session ${sessionId} with brain ${brainId}`);
    console.log(`🧠 [Engine] Session state before:`, {
      conversationId: session.conversationId,
      brainId: session.brainId,
      phase: session.state.phase
    });
    
    try {
      // Get brain instructions from auth service
      const brain = await this.authIntegration.getBrainById(brainId, session.user.id, session.token);
      if (!brain) {
        console.error('❌ [Engine] Brain not found or unauthorized', { sessionId, brainId, userId: session.user.id });
        throw new Error('Brain not found or unauthorized');
      }

      console.log(`🧠 [Engine] Brain found:`, { id: brain.id, name: brain.name });

      // Create conversation in conversation manager
      const conversationId = await this.conversationManager.createConversation(
        session.user.id,
        brainId,
        brain.instructions
      );

      console.log(`🧠 [Engine] Conversation created with ID:`, conversationId);

      // Update session
      session.conversationId = conversationId;
      session.brainId = brainId;
      session.brainName = brain.name;
      session.state.phase = 'idle';

      console.log(`🧠 [Engine] Session updated:`, {
        conversationId: session.conversationId,
        brainId: session.brainId,
        phase: session.state.phase
      });

      this.sendMessage(sessionId, {
        type: 'conversation_started',
        conversationId,
        brain: {
          id: brain.id,
          name: brain.name,
          instructions: brain.instructions,
        },
        timestamp: new Date().toISOString(),
      });

      // Start with AI greeting if configured
      if (brain.instructions.includes('greeting') || brain.instructions.includes('introduce')) {
        await this.generateInitialGreeting(sessionId, brain.instructions);
      }
    } catch (error) {
      console.error(`❌ [Engine] Error in startConversation:`, error);
      throw error;
    }
  }

  private async startListening(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (session.state.phase !== 'idle') {
      throw new Error(`Cannot start listening in phase: ${session.state.phase}`);
    }

    // Mark listening state for Whisper STT
    session.state.phase = 'listening';

    console.log(`🎤 Started listening for session: ${sessionId}`);

    this.sendMessage(sessionId, {
      type: 'listening_started',
      timestamp: new Date().toISOString(),
    });
  }

  private async generateInitialGreeting(sessionId: string, instructions: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    session.state.phase = 'processing';

    try {
      // Generate greeting using LLM
      const greetingPrompt = `Based on these instructions: "${instructions}", generate a brief, natural greeting to start a phone conversation. Keep it under 20 words.`;
      
      const greeting = await this.conversationManager.processWithLLM(
        session.conversationId!,
        greetingPrompt,
        'system'
      );

      // Convert to speech
      await this.speakResponse(sessionId, greeting);

    } catch (error) {
      console.error('Error generating initial greeting:', error);
      session.state.phase = 'idle';
    }
  }

  private async processAudioChunk(sessionId: string, audioData: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (session.state.phase !== 'listening') {
      console.log(`⚠️ [Engine] Ignoring audio chunk - wrong phase: ${session.state.phase}`);
      return;
    }

    console.log(`🎵 [Engine] Processing audio chunk: ${audioData.length} chars, session: ${sessionId}`);
    
    const audioBuffer = Buffer.from(audioData, 'base64');
    console.log(`🎵 [Engine] Audio buffer size: ${audioBuffer.length} bytes`);
    
    // Buffer chunks for Whisper STT
    if (!session.currentTurn) {
      session.currentTurn = {
        id: uuidv4(),
        startTime: new Date(),
        metadata: {},
      };
      console.log(`🆕 [Engine] Created new turn: ${session.currentTurn.id}`);
    }
    
    const prev = session.currentTurn.audioInput || Buffer.alloc(0);
    session.currentTurn.audioInput = Buffer.concat([prev, audioBuffer]);
    console.log(`📊 [Engine] Total audio buffered: ${session.currentTurn.audioInput.length} bytes`);
  }

  private async stopListening(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (session.state.phase !== 'listening') return;

    session.state.phase = 'processing';
    
    // Use hybrid STT service
    try {
      const { HybridSTT } = await import('../services/stt/hybrid-stt');
      
      const sttConfig = {
        primaryProvider: (process.env.STT_PROVIDER as 'python-whisper' | 'openai') || 'python-whisper',
        fallbackProvider: (process.env.STT_FALLBACK_TO_OPENAI === 'true' ? 'openai' : undefined) as 'python-whisper' | 'openai' | undefined,
        pythonWhisperConfig: {
          model: process.env.WHISPER_MODEL || 'base',
          language: 'en',
          pythonPath: process.env.PYTHON_PATH || 'python3',
          device: (process.env.WHISPER_DEVICE as 'cpu' | 'cuda') || 'cpu'
        },
        openaiConfig: {
          model: process.env.WHISPER_MODEL || 'whisper-1',
          language: 'en',
          apiKey: process.env.OPENAI_API_KEY
        }
      };

      const hybridSTT = new HybridSTT(sttConfig);
      await hybridSTT.initialize();
      
      const audio = session.currentTurn?.audioInput;
      if (audio && audio.length > 0) {
        const wav = this.encodePCM16ToWav(audio, 16000);
        const transcript = await hybridSTT.transcribeWavBuffer(wav);
        
        session.state.lastSTTResult = transcript;
        this.sendMessage(sessionId, { 
          type: 'speech_recognized', 
          transcript, 
          timestamp: new Date().toISOString() 
        });
        
        try { 
          this.saveUserAudio(session, wav); 
        } catch {}
        
        await this.processTextInput(sessionId, transcript);
      } else {
        session.state.phase = 'idle';
        this.sendMessage(sessionId, { 
          type: 'no_speech_detected', 
          timestamp: new Date().toISOString() 
        });
      }
    } catch (e) {
      session.state.phase = 'idle';
      this.sendMessage(sessionId, { 
        type: 'speech_error', 
        error: e instanceof Error ? e.message : 'STT failed', 
        timestamp: new Date().toISOString() 
      });
    }
  }

  private async processTextInput(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    
    console.log(`📝 [Engine] Processing text input for session ${sessionId}:`, {
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      conversationId: session.conversationId,
      brainId: session.brainId,
      phase: session.state.phase
    });
    
    if (!session.conversationId) {
      console.error(`❌ [Engine] No active conversation for session ${sessionId}`);
      console.error(`❌ [Engine] Session state:`, {
        conversationId: session.conversationId,
        brainId: session.brainId,
        phase: session.state.phase,
        isActive: session.isActive
      });
      throw new Error('No active conversation');
    }

    session.state.phase = 'processing';
    session.state.turnCount++;

    // Check turn limits
    if (session.state.turnCount > this.maxTurnsPerConversation) {
      await this.endConversation(sessionId, 'Turn limit reached');
      return;
    }

    try {
      // Create conversation turn
      const turnId = uuidv4();
      const turn: ConversationTurn = {
        id: turnId,
        userInput: text,
        startTime: new Date(),
        metadata: {},
      };
      session.currentTurn = turn;

      this.sendMessage(sessionId, {
        type: 'processing_started',
        turnId,
        userInput: text,
        timestamp: new Date().toISOString(),
      });

      // Process with LLM
      const startTime = Date.now();
      const aiResponse = await this.conversationManager.processWithLLM(
        session.conversationId,
        text,
        'user'
      );
      const processingTime = Date.now() - startTime;

      turn.aiResponse = aiResponse;
      turn.metadata.processingTime = processingTime;
      session.state.lastLLMResponse = aiResponse;

      console.log(`�� AI response: "${aiResponse}"`);

      this.sendMessage(sessionId, {
        type: 'ai_response_generated',
        response: aiResponse,
        processingTime,
        timestamp: new Date().toISOString(),
      });

      // Convert to speech
      await this.speakResponse(sessionId, aiResponse);

    } catch (error) {
      console.error('Error processing text input:', error);
      session.state.phase = 'error';
      
      this.sendMessage(sessionId, {
        type: 'processing_error',
        error: error instanceof Error ? error.message : 'Processing failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async speakResponse(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    session.state.phase = 'speaking';

    try {
      const startTime = Date.now();
      
      // Use Chatterbox TTS
      const { ChatterboxTTS } = await import('../services/tts/chatterbox-tts');
      const chatterbox = new ChatterboxTTS({
        pythonPath: process.env.PYTHON_PATH || 'python3',
        device: process.env.CHATTERBOX_DEVICE || 'cpu',
        exaggeration: parseFloat(process.env.CHATTERBOX_EXAGGERATION || '0.5'),
        cfgWeight: parseFloat(process.env.CHATTERBOX_CFG_WEIGHT || '0.5'),
        voicePromptPath: process.env.CHATTERBOX_VOICE_PROMPT_PATH,
      });
      const audioBuffer = await chatterbox.synthesize(text);

      const ttsLatency = Date.now() - startTime;

      if (session.currentTurn) {
        session.currentTurn.audioOutput = audioBuffer;
        session.currentTurn.metadata.ttsLatency = ttsLatency;
        session.currentTurn.endTime = new Date();
      }

      session.state.lastTTSAudio = audioBuffer;

      console.log(` Generated speech (${audioBuffer.length} bytes, ${ttsLatency}ms)`);

      this.sendMessage(sessionId, {
        type: 'speech_generated',
        audio: audioBuffer.toString('base64'),
        text,
        ttsLatency,
        timestamp: new Date().toISOString(),
      });
      // Save assistant audio (already WAV)
      try {
        this.saveAssistantAudio(session, audioBuffer);
      } catch (e) { /* ignore */ }

      // Return to idle state
      session.state.phase = 'idle';

    } catch (error) {
      console.error('Error generating speech:', error);
      session.state.phase = 'error';
      
      this.sendMessage(sessionId, {
        type: 'speech_error',
        error: error instanceof Error ? error.message : 'Speech generation failed',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async handleInterrupt(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    console.log(`⚡ Interrupt received for session: ${sessionId}`);

    // Return to listening mode
    session.state.phase = 'idle';
    
    this.sendMessage(sessionId, {
      type: 'interrupted',
      timestamp: new Date().toISOString(),
    });
  }

  private async endConversation(sessionId: string, reason?: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    session.state.phase = 'completed';
    session.isActive = false;

    // Finalize conversation
    if (session.conversationId) {
      await this.conversationManager.endConversation(session.conversationId);
    }

    const duration = Date.now() - session.startTime.getTime();

    console.log(`�� Ended conversation ${session.conversationId} (${duration}ms, ${session.state.turnCount} turns)`);

    this.sendMessage(sessionId, {
      type: 'conversation_ended',
      reason: reason || 'User ended conversation',
      statistics: {
        duration,
        turnCount: session.state.turnCount,
        startTime: session.startTime,
        endTime: new Date(),
      },
      timestamp: new Date().toISOString(),
    });
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // End conversation if still active
    if (session.isActive && session.conversationId) {
      this.endConversation(sessionId, 'Session destroyed').catch(console.error);
    }

    this.sessions.delete(sessionId);
    console.log(`��️ Destroyed session: ${sessionId}`);
  }

  private sendMessage(sessionId: string, message: any): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    session.ws.send(JSON.stringify(message));
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now();
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionAge = now - session.startTime.getTime();
      const lastActivityAge = now - session.lastActivity.getTime();
      
      // Clean up sessions that are too old or inactive
      if (sessionAge > this.maxSessionDuration || lastActivityAge > 10 * 60 * 1000) { // 10 min inactivity
        console.log(`🧹 Cleaning up inactive session: ${sessionId}`);
        this.destroySession(sessionId);
      }
    }
  }

  // Public methods for monitoring
  getActiveSessions(): any[] {
    return Array.from(this.sessions.values()).map(session => ({
      id: session.id,
      userId: session.user.id,
      userEmail: session.user.email,
      conversationId: session.conversationId,
      brainId: session.brainId,
      phase: session.state.phase,
      turnCount: session.state.turnCount,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      isActive: session.isActive,
    }));
  }

  getSessionStats(): any {
    const sessions = Array.from(this.sessions.values());
    
    return {
      total: sessions.length,
      active: sessions.filter(s => s.isActive).length,
      byPhase: sessions.reduce((acc: any, session) => {
        acc[session.state.phase] = (acc[session.state.phase] || 0) + 1;
        return acc;
      }, {}),
      averageTurns: sessions.length > 0 
        ? sessions.reduce((sum, s) => sum + s.state.turnCount, 0) / sessions.length 
        : 0,
    };
  }

  private ensureRecordingsDir(): string {
    const dir = process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private sanitizeName(s?: string): string {
    return (s || 'brain').replace(/[^a-z0-9-_]+/gi, '_').slice(0, 60);
  }

  private saveUserAudio(session: ConversationSession, wavBuffer: Buffer): void {
    const dir = this.ensureRecordingsDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const brain = this.sanitizeName(session.brainName || session.brainId);
    const filename = `${ts}_${brain}_user.wav`;
    fs.writeFileSync(path.join(dir, filename), wavBuffer);
  }

  private saveAssistantAudio(session: ConversationSession, wavBuffer: Buffer): void {
    const dir = this.ensureRecordingsDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const brain = this.sanitizeName(session.brainName || session.brainId);
    const filename = `${ts}_${brain}_assistant.wav`;
    fs.writeFileSync(path.join(dir, filename), wavBuffer);
  }

  // Encode little-endian 16-bit PCM mono @ sampleRate to WAV
  private encodePCM16ToWav(pcm: Buffer, sampleRate: number = 16000): Buffer {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcm.length;
    const wavSize = 44 + dataSize;
    const buf = Buffer.alloc(wavSize);
    let o = 0;
    buf.write('RIFF', o); o += 4;
    buf.writeUInt32LE(36 + dataSize, o); o += 4;
    buf.write('WAVE', o); o += 4;
    buf.write('fmt ', o); o += 4;
    buf.writeUInt32LE(16, o); o += 4;               // PCM fmt chunk size
    buf.writeUInt16LE(1, o); o += 2;                // PCM format
    buf.writeUInt16LE(numChannels, o); o += 2;
    buf.writeUInt32LE(sampleRate, o); o += 4;
    buf.writeUInt32LE(byteRate, o); o += 4;
    buf.writeUInt16LE(blockAlign, o); o += 2;
    buf.writeUInt16LE(bitsPerSample, o); o += 2;
    buf.write('data', o); o += 4;
    buf.writeUInt32LE(dataSize, o); o += 4;
    pcm.copy(buf, o);
    return buf;
  }
}