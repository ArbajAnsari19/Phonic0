import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createServer } from 'http';

import { ConversationManager } from './services/conversation-manager';
import { LLMService } from './services/llm-service';
import { KyutaiIntegration } from './services/kyutai-integration';
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

// Security middleware
app.use(helmet());
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:3000',
    'http://localhost:3000'
  ],
  credentials: true
}));

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

// Initialize services
const llmService = new LLMService();
const kyutaiIntegration = new KyutaiIntegration();
const authIntegration = new AuthIntegration();
const conversationManager = new ConversationManager(llmService, kyutaiIntegration);
const conversationEngine = new ConversationEngine(conversationManager, kyutaiIntegration, authIntegration);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/conversation', authenticateToken, conversationRoutes(conversationManager));
app.use('/api/call', authenticateToken, callRoutes(conversationEngine));

// WebSocket server for real-time call orchestration
const wss = new WebSocket.Server({ server });

wss.on('connection', async (ws, req) => {
  console.log('🔌 New orchestrator WebSocket connection');
  
  try {
    // Extract token from query params or headers
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      ws.close(1008, 'Authentication token required');
      return;
    }

    // Authenticate user
    const user = await authIntegration.verifyToken(token);
    if (!user) {
      ws.close(1008, 'Invalid authentication token');
      return;
    }

    console.log(`👤 Authenticated user: ${user.email}`);

    // Create conversation session
    const sessionId = await conversationEngine.createSession(ws, user);
    
    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await conversationEngine.handleMessage(sessionId, message);
      } catch (error) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString()
        }));
      }
    });

    ws.on('close', () => {
      console.log('🔌 Orchestrator WebSocket connection closed');
      conversationEngine.destroySession(sessionId);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      conversationEngine.destroySession(sessionId);
    });

  } catch (error) {
    console.error('WebSocket connection error:', error);
    ws.close(1011, 'Internal server error');
  }
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Start server
async function startServer() {
  try {
    // Initialize services
    await llmService.initialize();
    await kyutaiIntegration.initialize();
    await authIntegration.initialize();
    
    console.log('✅ All services initialized');

    server.listen(PORT, () => {
      console.log(`🚀 Orchestrator running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`🤖 Conversation API: http://localhost:${PORT}/api/conversation`);
      console.log(`📞 Call API: http://localhost:${PORT}/api/call`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
      console.log(`🎭 Demo mode: ${process.env.DEMO_MODE === 'true'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start orchestrator:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

startServer();
