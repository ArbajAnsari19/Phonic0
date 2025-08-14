import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createServer } from 'http';
import net from 'net';

import { ConversationManager } from './services/conversation-manager';
import { LLMService } from './services/llm-service';
import { AuthIntegration } from './services/auth-integration';
import { ConversationEngine } from './core/conversation-engine';
import conversationRoutes from './routes/conversation';
import callRoutes from './routes/call';
import createHealthRouter from './routes/health';
import { authenticateToken } from './middleware/auth';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3004;
console.log('🔐 Reached here 0');
// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3000'
  ],
  credentials: true
}));

console.log('🔐 Reached here 1');

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

console.log('🔐 Reached here 2');

// Initialize services
const llmService = new LLMService({
  provider: 'openai',
  openaiConfig: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
  },
  streamingConfig: {
    enabled: true,
    streamDelay: 50,
    partialThreshold: 2,
  },
});
const authIntegration = new AuthIntegration();
const conversationManager = new ConversationManager(llmService);
const conversationEngine = new ConversationEngine(conversationManager, authIntegration);

// ✅ CRITICAL: Initialize conversation engine services with await
 conversationEngine.initializeServices();

console.log('🔐 Reached here 3');

// Routes
app.use('/api/health', createHealthRouter(conversationEngine));  // Use the factory function
app.use('/api/conversation', authenticateToken, conversationRoutes(conversationManager));
app.use('/api/call', authenticateToken, callRoutes(conversationEngine));
console.log('🔐 Reached here 4');

// Add these at the top level, before the WebSocket server creation:
// let pendingAudioLength: number | null = null; // Remove this

// Add the missing function:
const handleBinaryAudioMessage = async (sessionId: string, audioData: Buffer) => {
  try {
    await conversationEngine.handleBinaryAudio(sessionId, audioData);
  } catch (error) {
    console.error('Error handling binary audio:', error);
  }
};

// Check if port is available before creating WebSocket server
console.log('🔐 Checking port availability...');
const testServer = net.createServer();
testServer.listen(PORT, () => {
  console.log(`🔐 Port ${PORT} is available`);
  testServer.close(() => {
    console.log('🔐 Port check completed, creating WebSocket server...');
    
    try {
      const wss = new WebSocket.Server({ server });
      console.log('🔐 WebSocket server created successfully');
      
      wss.on('connection', async (ws, req) => {
        console.log('🔌 [WS] New connection', {
          url: req.url,
          ip: (req.socket as any)?.remoteAddress,
          headers: {
            origin: req.headers.origin,
            'sec-websocket-protocol': req.headers['sec-websocket-protocol'],
            authorization: req.headers.authorization ? 'present' : 'missing',
          },
        });

        try {
          // Extract token from query parameters first (simplified)
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          let token = url.searchParams.get('token');

          if (!token) {
            ws.close(1008, 'Authentication token required');
            console.error('❌ [WS] Close: missing token');
            return;
          }

          // Authenticate user
          const user = await authIntegration.verifyToken(token);
          if (!user) {
            ws.close(1008, 'Invalid authentication token');
            console.error('❌ [WS] Close: invalid token');
            return;
          }

          console.log(`👤 [WS] Authenticated user: ${user.email} (${user.id})`);

          // Create conversation session
          let sessionId = await conversationEngine.createSession(ws, user, token);
          console.log('🆔 [WS] Session created', { sessionId });

          // Track conversation state per session
          let isProcessing = false;
          // let pendingAudioLength: number | null = null; // Move here

          // Improve WebSocket state management
          ws.on('message', async (data, isBinary) => {
            try {
              if (isProcessing) {
                console.log('⏳ [WS] Already processing, skipping message');
                return;
              }

              if (isBinary) {
                // ✅ CRITICAL: Add proper error handling and session validation
                if (sessionId) {
                  try {
                    await handleBinaryAudioMessage(sessionId, Buffer.from(data as ArrayBuffer));
                  } catch (audioError) {
                    console.error('❌ [WS] Audio processing error:', audioError);
                    ws.send(JSON.stringify({
                      type: 'error',
                      message: 'Audio processing failed',
                      timestamp: new Date().toISOString()
                    }));
                  }
                } else {
                  console.warn('⚠️ [WS] Received binary data without session ID');
                  ws.send(JSON.stringify({
                    type: 'error',
                    message: 'No active session',
                    timestamp: new Date().toISOString()
                  }));
                }
                
              } else {
                const message = JSON.parse(data.toString());
                
                // ✅ Add session validation for all messages
                if (!sessionId) {
                  console.warn('⚠️ [WS] Message received without session ID');
                  ws.send(JSON.stringify({
                    type: 'error',
                    message: 'No active session',
                    timestamp: new Date().toISOString()
                  }));
                  return;
                }
                
                if (message.type === 'audio_input' && message.audioLength && message.sessionId) {
                  // Validate session exists
                  if (!conversationEngine.hasSession(message.sessionId)) {
                    console.warn('⚠️ [WS] Invalid session ID:', message.sessionId);
                    ws.send(JSON.stringify({
                      type: 'error',
                      message: 'Invalid session ID',
                      timestamp: new Date().toISOString()
                    }));
                    return;
                  }
                  
                  console.log(`✅ [WS] Audio input prepared for session: ${message.sessionId}, length: ${message.audioLength}`);
                  
                } else {
                  // Handle other JSON messages
                  try {
                    await conversationEngine.handleMessage(sessionId, message);
                  } catch (messageError) {
                    console.error('❌ [WS] Message handling error:', messageError);
                    ws.send(JSON.stringify({
                      type: 'error',
                      message: 'Message processing failed',
                      timestamp: new Date().toISOString()
                    }));
                  }
                }
              }

            } catch (error) {
              console.error('❌ [WS] Message processing error:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
              }));
            }
          });

          ws.on('close', () => {
            console.log('🔌 [WS] Connection closed', { sessionId });
            conversationEngine.destroySession(sessionId);
          });

          ws.on('error', (error) => {
            console.error('❌ [WS] Error', { sessionId, error });
            conversationEngine.destroySession(sessionId);
          });

        } catch (error) {
          console.error('❌ [WS] Connection error:', error);
          ws.close(1011, 'Internal server error');
        }
      });
      
      wss.on('error', (error) => {
        console.error('❌ WebSocket server error:', error);
      });
      
      console.log('🔐 Reached here 8');
      
    } catch (error) {
      console.error('❌ Failed to create WebSocket server:', error);
      process.exit(1);
    }
  });
});

testServer.on('error', (error) => {
  console.error(`❌ Port ${PORT} is already in use:`, error.message);
  process.exit(1);
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  
  if (res.headersSent) {
    return next(err);
  }
  
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});
console.log('🔐 Reached here 9');

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});
console.log('🔐 Reached here 10');
// Start server
async function startServer() {
  try {
    // Initialize services
    await llmService.initialize();
    await authIntegration.initialize();   
    await conversationEngine.initializeServices();
 
    console.log('✅ All services initialized');
    console.log('🔐 Reached here 11');
    server.listen(PORT, () => {
      console.log(`🚀 Orchestrator running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🤖 Conversation API: http://localhost:${PORT}/api/conversation`);
      console.log(`📞 Call API: http://localhost:${PORT}/api/call`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
      console.log(`🎭 Demo mode: ${process.env.DEMO_MODE === 'true'}`);
    });
    console.log('🔐 Reached here 12');
  } catch (error) {
    console.error('❌ Failed to start orchestrator:', error);
    process.exit(1);
  }
}

startServer();