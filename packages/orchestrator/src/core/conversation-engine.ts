import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConversationManager } from '../services/conversation-manager';
import { KyutaiIntegration } from '../services/kyutai-integration';
import { AuthIntegration } from '../services/auth-integration';

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface ConversationSession {
  id: string;
  user: User;
  ws: WebSocket;
  conversationId?: string;
  brainId?: string;
  isActive: boolean;
  startTime: Date;
  lastActivity: Date;
  state: ConversationState;
  audioSessionId?: string;
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
    private kyutaiIntegration: KyutaiIntegration,
    private authIntegration: AuthIntegration
  ) {
    this.maxSessionDuration = parseInt(process.env.MAX_CONVERSATION_DURATION || '1800') * 1000; // 30 min default
    this.maxTurnsPerConversation = parseInt(process.env.MAX_TURNS_PER_CONVERSATION || '50');
    
    // Clean up inactive sessions every 5 minutes
    setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
  }

  async createSession(ws: WebSocket, user: User): Promise<string> {
    const sessionId = uuidv4();
    
    const session: ConversationSession = {
      id: sessionId,
      user,
      ws,
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
      switch (message.type) {
        case 'start_conversation':
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
      console.error(`Error handling message for session ${sessionId}:`, error);
      
      session.state.phase = 'error';
      this.sendMessage(sessionId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async startConversation(sessionId: string, brainId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    // Get brain instructions from auth service
    const brain = await this.authIntegration.getBrainById(brainId, session.user.id);
    if (!brain) {
      throw new Error('Brain not found or unauthorized');
    }

    // Create conversation in conversation manager
    const conversationId = await this.conversationManager.createConversation(
      session.user.id,
      brainId,
      brain.instructions
    );

    session.conversationId = conversationId;
    session.brainId = brainId;
    session.state.phase = 'idle';

    console.log(`🧠 Started conversation ${conversationId} with brain: ${brain.name}`);

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

  private async startListening(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (session.state.phase !== 'idle') {
      throw new Error(`Cannot start listening in phase: ${session.state.phase}`);
    }

    // Create audio session with Kyutai
    const audioSessionId = await this.kyutaiIntegration.createAudioSession();
    session.audioSessionId = audioSessionId;
    session.state.phase = 'listening';

    // Start STT stream
    await this.kyutaiIntegration.startSTTStream(audioSessionId, {
      language: 'en-US',
      sampleRate: 16000,
      encoding: 'LINEAR16',
      interimResults: true,
      enableVoiceActivityDetection: true,
    });

    console.log(`🎤 Started listening for session: ${sessionId}`);

    this.sendMessage(sessionId, {
      type: 'listening_started',
      audioSessionId,
      timestamp: new Date().toISOString(),
    });
  }

  private async processAudioChunk(sessionId: string, audioData: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (session.state.phase !== 'listening' || !session.audioSessionId) {
      return;
    }

    const audioBuffer = Buffer.from(audioData, 'base64');
    await this.kyutaiIntegration.sendAudioChunk(session.audioSessionId, audioBuffer);
  }

  private async stopListening(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (session.state.phase !== 'listening' || !session.audioSessionId) {
      return;
    }

    session.state.phase = 'processing';

    // Get final STT result
    const sttResult = await this.kyutaiIntegration.stopSTTStream(session.audioSessionId);
    
    if (sttResult && sttResult.transcript.trim()) {
      session.state.lastSTTResult = sttResult.transcript;
      
      console.log(`💬 User said: "${sttResult.transcript}"`);

      this.sendMessage(sessionId, {
        type: 'speech_recognized',
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        timestamp: new Date().toISOString(),
      });

      // Process with LLM
      await this.processTextInput(sessionId, sttResult.transcript);
    } else {
      // No speech detected, return to listening
      session.state.phase = 'idle';
      
      this.sendMessage(sessionId, {
        type: 'no_speech_detected',
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async processTextInput(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    if (!session.conversationId) {
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

      console.log(`🤖 AI response: "${aiResponse}"`);

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
      
      // Generate speech using TTS
      const audioResult = await this.kyutaiIntegration.synthesizeSpeech(text, {
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Standard-A',
          gender: 'NEUTRAL',
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 16000,
          speakingRate: 1.0,
          pitch: 0.0,
          volumeGainDb: 0.0,
        },
        enableLowLatency: true,
      });

      const ttsLatency = Date.now() - startTime;

      if (session.currentTurn) {
        session.currentTurn.audioOutput = audioResult.audioContent;
        session.currentTurn.metadata.ttsLatency = ttsLatency;
        session.currentTurn.endTime = new Date();
      }

      session.state.lastTTSAudio = audioResult.audioContent;

      console.log(`🔊 Generated speech (${audioResult.audioContent.length} bytes, ${ttsLatency}ms)`);

      this.sendMessage(sessionId, {
        type: 'speech_generated',
        audio: audioResult.audioContent.toString('base64'),
        text,
        ttsLatency,
        timestamp: new Date().toISOString(),
      });

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

    // Stop current TTS if speaking
    if (session.state.phase === 'speaking' && session.audioSessionId) {
      await this.kyutaiIntegration.stopTTSStream(session.audioSessionId);
    }

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

    // Clean up audio session
    if (session.audioSessionId) {
      await this.kyutaiIntegration.destroyAudioSession(session.audioSessionId);
    }

    // Finalize conversation
    if (session.conversationId) {
      await this.conversationManager.endConversation(session.conversationId);
    }

    const duration = Date.now() - session.startTime.getTime();

    console.log(`🏁 Ended conversation ${session.conversationId} (${duration}ms, ${session.state.turnCount} turns)`);

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
    console.log(`🗑️ Destroyed session: ${sessionId}`);
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
}
