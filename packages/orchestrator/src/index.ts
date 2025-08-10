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
import healthRoutes from './routes/health';
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
const llmService = new LLMService();
const authIntegration = new AuthIntegration();
const conversationManager = new ConversationManager(llmService);
const conversationEngine = new ConversationEngine(conversationManager, authIntegration);
console.log('🔐 Reached here 3');

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/conversation', authenticateToken, conversationRoutes(conversationManager));
app.use('/api/call', authenticateToken, callRoutes(conversationEngine));
console.log('🔐 Reached here 4');

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
          // Extract token from query, subprotocol, or Authorization header
          const url = new URL(req.url || '', `http://${req.headers.host}`);
          let token =
            url.searchParams.get('token') ||
            (req.headers['sec-websocket-protocol']
              ? String(req.headers['sec-websocket-protocol'])
                  .split(',')
                  .map(s => s.trim())
                  .find(s => /^Bearer\s+/i.test(s))?.replace(/^Bearer\s+/i, '') ||
                String(req.headers['sec-websocket-protocol'])
                  .split(',')
                  .map(s => s.trim())
                  .find(s => s.length > 20) // fallback: assume long item is token
              : undefined) ||
            req.headers.authorization?.replace(/^[Bb]earer\s+/, '');

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
          const sessionId = await conversationEngine.createSession(ws, user, token);
          console.log('🆔 [WS] Session created', { sessionId });

          // Track conversation state
          let isProcessing = false;

          ws.on('message', async (data) => {
            try {
              // Prevent multiple simultaneous processing
              if (isProcessing) {
                console.log('⏳ [WS] Already processing, skipping message');
                return;
              }

              const message = JSON.parse(data.toString());
              console.log('📥 [WS] Message received', { sessionId, type: message?.type });

              // Use the existing conversation engine methods
              await conversationEngine.handleMessage(sessionId, message);

            } catch (error) {
              console.error('❌ [WS] Message processing error:', error);
              ws.send(JSON.stringify({
                type: 'error',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date().toISOString()
              }));
              isProcessing = false;
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