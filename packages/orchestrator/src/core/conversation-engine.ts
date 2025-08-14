import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { ConversationManager } from '../services/conversation-manager';
import { AuthIntegration } from '../services/auth-integration';
import fs from 'fs';
import path from 'path';
import { MoshiStreamingSTT, StreamingSTTResult } from '../services/stt';
import { LLMService } from '../services/llm-service';
import { MoshiStreamingTTS } from '../services/tts';

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
  phase: 'idle' | 'ready' | 'streaming' | 'processing' | 'completed' | 'error';
  turnCount: number;
  totalDuration: number;
  streamingData: {
    sttBuffer: Buffer[];
    llmTokens: string[];
    ttsAudio: Buffer[];
    partialTranscript: string;
  };
  isEndOfSpeech: boolean;
  lastSTTResult?: string;
  lastLLMResponse?: string;
  lastTTSAudio?: Buffer;
  context: any[];
  parallelProcessing: {
    sttActive: boolean;
    llmActive: boolean;
    ttsActive: boolean;
    sttStartTime?: number;
    llmStartTime?: number;
    ttsStartTime?: number;
  };
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
  private streamingSTT: MoshiStreamingSTT | null = null;
  private llmService: LLMService | null = null;
  private ttsService: MoshiStreamingTTS | null = null;
  private servicesInitialized: boolean = false;
  private initializationRetries: number = 0;
  private readonly maxRetries: number = 3;

  constructor(
    private conversationManager: ConversationManager,
    private authIntegration: AuthIntegration
  ) {
    this.maxSessionDuration = parseInt(process.env.MAX_CONVERSATION_DURATION || '1800') * 1000;
    this.maxTurnsPerConversation = parseInt(process.env.MAX_TURNS_PER_CONVERSATION || '50');
    
    // Don't initialize services in constructor
    setInterval(() => this.cleanupInactiveSessions(), 5 * 60 * 1000);
  }

  // New method for service initialization
  async initializeServices(): Promise<void> {
    if (this.servicesInitialized) {
      console.log('ℹ️ Services already initialized');
      return;
    }

    try {
      console.log('🚀 Initializing conversation engine services...');
      
      await this.initializeStreamingSTT();
      await this.initializeLLMService();
      await this.initializeTTSService();
      
      this.servicesInitialized = true;
      this.initializationRetries = 0;
      console.log('✅ All conversation engine services initialized successfully');
      
    } catch (error) {
      console.error('❌ Failed to initialize services:', error);
      this.initializationRetries++;
      
      if (this.initializationRetries < this.maxRetries) {
        console.log(`🔄 Retrying service initialization (${this.initializationRetries}/${this.maxRetries})...`);
        setTimeout(() => this.initializeServices(), 5000); // Retry after 5 seconds
      } else {
        console.error('❌ Max retries exceeded for service initialization');
        throw new Error('Failed to initialize conversation engine services');
      }
    }
  }

  // Add health check method
  async checkServicesHealth(): Promise<{ stt: boolean; llm: boolean; tts: boolean }> {
    return {
      stt: this.streamingSTT !== null,
      llm: this.llmService !== null,
      tts: this.ttsService !== null
    };
  }

  // Update session creation to ensure services are ready
  async createSession(ws: WebSocket, user: User, token?: string): Promise<string> {
    // ✅ CRITICAL: Ensure services are initialized before creating session
    if (!this.servicesInitialized) {
      console.log('🔄 Services not initialized, initializing now...');
      await this.initializeServices();
    }
    
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
        streamingData: {
          sttBuffer: [],
          llmTokens: [],
          ttsAudio: [],
          partialTranscript: ''
        },
        isEndOfSpeech: false,
        context: [],
        parallelProcessing: {
          sttActive: false,
          llmActive: false,
          ttsActive: false
        }
      }
    };

    this.sessions.set(sessionId, session);
    console.log(`✅ Created conversation session: ${sessionId}`);
    
    return sessionId;
  }

  async handleMessage(sessionId: string, message: any): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.lastActivity = new Date();
    console.log(` [Message] Received ${message.type} for session: ${sessionId}`);

    try {
      switch (message.type) {
        case 'start_call':
          await this.startCall(sessionId, message.brainId);
          break;
          
        case 'start_conversation':
          await this.startConversation(sessionId, message.brainId);
          break;
          
        case 'text_input':
          await this.handleTextInput(sessionId, message.text);
          break;
          
        case 'interrupt':
          await this.handleInterrupt(sessionId);
          break;
          
        case 'end_conversation':
          await this.endConversation(sessionId, message.reason);
          break;
          
        default:
          console.log(`⚠️ Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
      this.sendMessage(sessionId, {
        type: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });
    }
  }

  private async startConversation(sessionId: string, brainId?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      const conversationId = await this.conversationManager.createConversation(
        session.user.id,
        brainId || 'default',
        'You are a helpful AI assistant.'
      );

      session.conversationId = conversationId;
      session.brainId = brainId;
      session.state.phase = 'idle';
      
      // ✅ CRITICAL: Send session_created message first
      this.sendMessage(sessionId, {
        type: 'session_created',
        sessionId: sessionId,  // Send the actual session ID
        conversationId: conversationId,
        brainId: brainId,
        timestamp: new Date().toISOString()
      });
      
      // Then send conversation_started
      this.sendMessage(sessionId, {
        type: 'conversation_started',
        conversationId: conversationId,
        brainId: brainId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ Started conversation: ${conversationId}`);
    } catch (error) {
      console.error('❌ Failed to start conversation:', error);
      throw error;
    }
  }

  private async handleTextInput(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.conversationId) return;

    try {
      session.state.phase = 'processing';
      
      if (this.llmService && this.llmService.isStreaming()) {
        await this.processTextInputWithStreaming(sessionId, text);
      } else {
        await this.processTextInputTraditional(sessionId, text);
      }
      
    } catch (error) {
      console.error('❌ Error processing text input:', error);
      session.state.phase = 'error';
      this.sendMessage(sessionId, {
        type: 'processing_error',
        error: error instanceof Error ? error.message : 'Failed to process input',
        timestamp: new Date().toISOString()
      });
    }
  }

  private async processTextInputWithStreaming(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.llmService) return;

    try {
      session.state.parallelProcessing.llmActive = true;
      session.state.parallelProcessing.llmStartTime = Date.now();

      await this.llmService.startStreamingResponse(
        session.conversationId!,
        text,
        (partialResponse) => this.handlePartialLLMResponse(sessionId, partialResponse),
        (completeResponse) => this.handleCompleteLLMResponse(sessionId, completeResponse),
        (token) => this.handleLLMToken(sessionId, token),
        (error) => this.handleLLMError(sessionId, error)
      );
      
    } catch (error) {
      console.error('❌ Error starting streaming LLM:', error);
      throw error;
    }
  }

  private async processTextInputTraditional(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.conversationId) return;

    try {
      const response = await this.conversationManager.processWithLLM(
        session.conversationId,
        text,
        'user'
      );
      
      session.state.lastLLMResponse = response;
      session.state.turnCount++;
      
      this.sendMessage(sessionId, {
        type: 'ai_response',
        text: response,
        isComplete: true,
        timestamp: new Date().toISOString()
      });
      
      await this.speakResponse(sessionId, response);
      
    } catch (error) {
      console.error('❌ Error in traditional LLM processing:', error);
      throw error;
    }
  }

  private async speakResponse(sessionId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.ttsService) return;

    try {
      session.state.parallelProcessing.ttsActive = true;
      session.state.parallelProcessing.ttsStartTime = Date.now();

      await this.ttsService.startStreaming(text);
      
      const ttsResult = await this.ttsService.synthesizeText(text);
      
      // Send audio metadata first
      this.sendMessage(sessionId, {
        type: 'audio_response',
        audioLength: ttsResult.audio.length,
        text: text,
        isComplete: true,
        timestamp: new Date().toISOString()
      });
      
      // Send binary audio data
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(ttsResult.audio);
      }
      
      session.state.lastTTSAudio = ttsResult.audio;
      session.state.parallelProcessing.ttsActive = false;
      session.state.phase = 'idle';
      
      // Save assistant audio
      try {
        this.saveAssistantAudio(session, ttsResult.audio);
      } catch {}
      
    } catch (error) {
      console.error('❌ Error in TTS:', error);
      session.state.parallelProcessing.ttsActive = false;
      session.state.phase = 'error';
      throw error;
    }
  }

  private async handleInterrupt(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)!;
    
    console.log(`⚡ Interrupt received for session: ${sessionId}`);
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

    if (session.conversationId) {
      await this.conversationManager.endConversation(session.conversationId);
    }

    const duration = Date.now() - session.startTime.getTime();

    console.log(`✅ Ended conversation ${session.conversationId} (${duration}ms, ${session.state.turnCount} turns)`);

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
    if (!session) return;

    if (session.isActive && session.conversationId) {
      this.endConversation(sessionId, 'Session destroyed').catch(console.error);
    }

    this.sessions.delete(sessionId);
    console.log(`️ Destroyed session: ${sessionId}`);
  }

  private sendMessage(sessionId: string, message: any): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) return;

    session.ws.send(JSON.stringify(message));
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now();
    
    for (const [sessionId, session] of this.sessions.entries()) {
      const sessionAge = now - session.startTime.getTime();
      const lastActivityAge = now - session.lastActivity.getTime();
      
      if (sessionAge > this.maxSessionDuration || lastActivityAge > 10 * 60 * 1000) {
        console.log(`🧹 Cleaning up inactive session: ${sessionId}`);
        this.destroySession(sessionId);
      }
    }
  }

  // STT Event Handlers
  private handlePartialSTTResult(result: StreamingSTTResult): void {
    console.log(`📝 [Engine] Partial STT: ${result.transcript}`);
    
    // Find session by STT result (you might need to implement session tracking)
    // For now, we'll handle this in the main audio processing flow
  }

  private handleFinalSTTResult(result: StreamingSTTResult): void {
    console.log(`✅ [Engine] Final STT: ${result.transcript}`);
    
    // Process the final transcript
    // You'll need to implement session tracking for this
  }

  // LLM Event Handlers
  private handleLLMToken(sessionId: string, token: string): void {
    console.log(` [Engine] LLM Token: ${token}`);
  }

  private handlePartialLLMResponse(sessionId: string, partialResponse: { text: string }): void {
    console.log(`📝 [Engine] Partial LLM: ${partialResponse.text}`);
    
    this.sendMessage(sessionId, {
      type: 'partial_ai_response',
      text: partialResponse.text,
      isComplete: false,
      timestamp: new Date().toISOString()
    });
  }

  private handleCompleteLLMResponse(sessionId: string, completeResponse: { text: string }): void {
    console.log(`✅ [Engine] Complete LLM: ${completeResponse.text}`);
    
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.state.lastLLMResponse = completeResponse.text;
    session.state.turnCount++;
    session.state.parallelProcessing.llmActive = false;
    
    this.sendMessage(sessionId, {
      type: 'ai_response',
      text: completeResponse.text,
      isComplete: true,
      timestamp: new Date().toISOString()
    });
  }

  private handleLLMError(sessionId: string, error: Error): void {
    console.error('❌ LLM streaming error:', error);
    
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.state.parallelProcessing.llmActive = false;
    session.state.phase = 'error';
    
    this.sendMessage(sessionId, {
      type: 'llm_error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }

  // Utility Methods
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

  async handleBinaryAudio(sessionId: string, audioData: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.error(`❌ [Audio] No session found for ID: ${sessionId}`);
      return;
    }

    try {
      console.log(`🎵 [Audio] Received ${audioData.length} bytes for session: ${sessionId}`);
      
      // Ensure STT service is ready
      if (!this.streamingSTT) {
        console.error('❌ [Audio] STT service not initialized');
        return;
      }
      
      // Start STT processing
      session.state.parallelProcessing.sttActive = true;
      console.log(`🎤 [STT] Starting transcription for session: ${sessionId}`);
      
      // Process audio through STT
      const sttResult = await this.processAudioWithSTT(sessionId, audioData);
      
      if (sttResult && sttResult.transcript) {
        console.log(`📝 [STT] Transcript: "${sttResult.transcript}" for session: ${sessionId}`);
        
        // Process with LLM
        const llmResponse = await this.processWithLLM(sessionId, sttResult.transcript);
        
        if (llmResponse) {
          console.log(`💬 [LLM] Response: "${llmResponse}" for session: ${sessionId}`);
          
          // Process with TTS
          const ttsResult = await this.processWithTTS(sessionId, llmResponse);
          
          if (ttsResult && ttsResult.audio) {
            console.log(` [TTS] Generated ${ttsResult.audio.length} bytes for session: ${sessionId}`);
            
            // Send audio back to client
            this.sendAudioToClient(sessionId, ttsResult.audio);
          }
        }
      }
      
      session.state.parallelProcessing.sttActive = false;
      
    } catch (error) {
      console.error(`❌ [Audio] Error processing audio for session ${sessionId}:`, error);
      session.state.parallelProcessing.sttActive = false;
      throw error;
    }
  }

  // Add this new method for starting a call with proper connections
  async startCall(sessionId: string, brainId?: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      console.log(`🚀 [Call] Starting call for session: ${sessionId}`);
      
      // 1. Create conversation
      const conversationId = await this.conversationManager.createConversation(
        session.user.id,
        brainId || 'default',
        'You are a helpful AI assistant.'
      );
      session.conversationId = conversationId;
      session.brainId = brainId;
      
      // 2. Send session_created message FIRST with the actual session ID
      this.sendMessage(sessionId, {
        type: 'session_created',
        sessionId: sessionId,  // Send the actual session ID
        conversationId: conversationId,
        brainId: brainId,
        timestamp: new Date().toISOString()
      });
      
      // 3. Initialize services
      if (this.streamingSTT) {
        await this.streamingSTT.initialize();
      }
      if (this.ttsService) {
        await this.ttsService.initialize();
      }
      if (this.llmService) {
        await this.llmService.initialize();
      }
      
      session.state.phase = 'ready';
      
      // 4. Send call_started message
      this.sendMessage(sessionId, {
        type: 'call_started',
        conversationId: conversationId,
        brainId: brainId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ [Call] Call started successfully: ${conversationId}`);
      
    } catch (error) {
      console.error(`❌ [Call] Failed to start call for session ${sessionId}:`, error);
      session.state.phase = 'error';
      throw error;
    }
  }

  // Replace these mock functions with real Moshi integration
  private async processAudioWithSTT(sessionId: string, audioData: Buffer): Promise<any> {
    try {
      console.log(`🎤 [STT] Processing ${audioData.length} bytes for session: ${sessionId}`);
      
      if (!this.streamingSTT) {
        throw new Error('STT service not initialized');
      }
      
      // Process audio through real Moshi STT
      const sttResult = await this.streamingSTT.processAudioChunk(audioData);
      
      console.log(`📝 [STT] Real transcript: "${sttResult.transcript}" for session: ${sessionId}`);
      
      return {
        transcript: sttResult.transcript,
        confidence: sttResult.confidence,
        isFinal: sttResult.isFinal
      };
      
    } catch (error) {
      console.error(`❌ [STT] Error processing audio for session ${sessionId}:`, error);
      throw error;
    }
  }

  private async processWithLLM(sessionId: string, transcript: string): Promise<string> {
    try {
      console.log(`🧠 [LLM] Processing transcript: "${transcript}" for session: ${sessionId}`);
      
      if (!this.llmService) {
        throw new Error('LLM service not initialized');
      }
      
      // Use the correct method: processWithLLM (which returns a string)
      const response = await this.llmService.processWithLLM(
        sessionId,        // conversationId
        transcript,       // input text
        'user'           // role
      );
      
      console.log(`💬 [LLM] Real response: "${response}" for session: ${sessionId}`);
      
      return response;
      
    } catch (error) {
      console.error(`❌ [LLM] Error processing transcript for session ${sessionId}:`, error);
      throw error;
    }
  }

  private async processWithTTS(sessionId: string, text: string): Promise<any> {
    try {
      console.log(`🔊 [TTS] Converting to speech: "${text}" for session: ${sessionId}`);
      
      if (!this.ttsService) {
        throw new Error('TTS service not initialized');
      }
      
      // Use real Moshi TTS
      const ttsResult = await this.ttsService.synthesizeText(text);
      
      console.log(` [TTS] Generated ${ttsResult.audio.length} bytes of real audio for session: ${sessionId}`);
      
      return {
        audio: ttsResult.audio,
        text: ttsResult.text,
        isComplete: ttsResult.isComplete
      };
      
    } catch (error) {
      console.error(`❌ [TTS] Error converting text to speech for session ${sessionId}:`, error);
      throw error;
    }
  }

  private sendAudioToClient(sessionId: string, audioData: Buffer): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) return;
    
    console.log(` [Audio] Sending ${audioData.length} bytes to client for session: ${sessionId}`);
    session.ws.send(audioData);
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

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private async initializeStreamingSTT(): Promise<void> {
    try {
      console.log('🎤 Initializing STT service...');
      
      // ✅ DIRECT PORT CONNECTION - No path routing
      this.streamingSTT = new MoshiStreamingSTT({
        moshiEndpoint: process.env.KYUTAI_STT_WS_URL || 'ws://35.244.13.180:8082/api/asr-streaming',  // Add the path back
        enableInterimResults: true,
        languageCode: 'en-US',
        sampleRate: 16000,
        authToken: process.env.KYUTAI_API_KEY // Add this
      });
      
      await this.streamingSTT.initialize();
      console.log('✅ STT service initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize STT service:', error);
      throw error;
    }
  }

  private async initializeLLMService(): Promise<void> {
    try {
      console.log('🧠 Initializing LLM service...');
      
      // Create and initialize LLM service
      this.llmService = new LLMService({
        provider: 'openai',
        openaiConfig: {
          apiKey: process.env.OPENAI_API_KEY || '',
          model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
        },
        streamingConfig: {
          enabled: true,
          streamDelay: 100,
          partialThreshold: 3
        }
      });
      
      await this.llmService.initialize();
      console.log('✅ LLM service initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize LLM service:', error);
      throw error;
    }
  }

  private async initializeTTSService(): Promise<void> {
    try {
      console.log('🔊 Initializing TTS service...');
      
      // ✅ DIRECT PORT CONNECTION - No path routing
      this.ttsService = new MoshiStreamingTTS({
        moshiEndpoint: process.env.KYUTAI_TTS_WS_URL || 'ws://35.244.13.180:8083/api/tts_streaming',  // Direct to port 8083
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 16000,
          speakingRate: 1.0,
          pitch: 0,
          volumeGainDb: 0
        }
      });
      
      await this.ttsService.initialize();
      console.log('✅ TTS service initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize TTS service:', error);
      throw error;
    }
  }
}