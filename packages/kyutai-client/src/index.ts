import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import WebSocket from 'ws';
import { createServer } from 'http';

import { KyutaiSTTClient } from './clients/stt-client';
import { KyutaiTTSClient } from './clients/tts-client';
import { AudioStreamManager } from './utils/audio-stream';
import sttRoutes from './routes/stt';
import ttsRoutes from './routes/tts';
import testRoutes from './routes/test';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3003;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.raw({ type: 'audio/*', limit: '10mb' }));

// Initialize clients
const sttClient = new KyutaiSTTClient();
const ttsClient = new KyutaiTTSClient();
const audioStreamManager = new AudioStreamManager();

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'kyutai-client',
    timestamp: new Date().toISOString(),
    demo_mode: process.env.DEMO_MODE === 'true'
  });
});

// Routes
app.use('/api/stt', sttRoutes(sttClient));
app.use('/api/tts', ttsRoutes(ttsClient));
app.use('/api/test', testRoutes(sttClient, ttsClient));

// WebSocket server for real-time audio streaming
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('🔌 New WebSocket connection established');
  
  const sessionId = audioStreamManager.createSession(ws);
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'start_stt':
          await audioStreamManager.startSTTStream(sessionId, message.config, sttClient);
          break;
          
        case 'audio_chunk':
          const audioData = Buffer.from(message.data, 'base64');
          await audioStreamManager.processAudioChunk(sessionId, audioData);
          break;
          
        case 'end_stt':
          await audioStreamManager.endSTTStream(sessionId);
          break;
          
        case 'start_tts':
          await audioStreamManager.startTTSStream(sessionId, message.config, ttsClient);
          break;
          
        case 'synthesize_text':
          await audioStreamManager.synthesizeText(sessionId, message.text);
          break;
          
        case 'end_tts':
          await audioStreamManager.endTTSStream(sessionId);
          break;
          
        default:
          ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
    audioStreamManager.destroySession(sessionId);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    audioStreamManager.destroySession(sessionId);
  });
});

// Start server
async function startServer() {
  try {
    // Initialize clients in demo mode
    if (process.env.DEMO_MODE === 'true') {
      console.log('🎭 Starting in demo mode with mock responses');
    } else {
      console.log('🔌 Attempting to connect to Kyutai Moshi services...');
      await sttClient.connect();
      await ttsClient.connect();
      console.log('✅ Connected to Kyutai Moshi services');
    }
    
    server.listen(PORT, () => {
      console.log(`🚀 Kyutai client running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🎤 STT API: http://localhost:${PORT}/api/stt`);
      console.log(`🔊 TTS API: http://localhost:${PORT}/api/tts`);
      console.log(`🧪 Test API: http://localhost:${PORT}/api/test`);
      console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
