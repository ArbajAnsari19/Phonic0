import { Router } from 'express';
import { KyutaiSTTClient } from '../clients/stt-client';

export default function createSTTRoutes(sttClient: KyutaiSTTClient) {
  const router = Router();

  // Single recognition endpoint
  router.post('/recognize', async (req, res): Promise<void> => {
    try {
      const { config } = req.body;
      const audioBuffer = req.body.audio ? Buffer.from(req.body.audio, 'base64') : req.body;

      if (!audioBuffer || audioBuffer.length === 0) {
        res.status(400).json({
          success: false,
          error: 'No audio data provided',
        });
        return;
      }

      const sttConfig = {
        language: config?.language || 'en-US',
        sampleRate: config?.sampleRate || 16000,
        encoding: config?.encoding || 'LINEAR16',
        interimResults: config?.interimResults || false,
        enableVoiceActivityDetection: config?.enableVoiceActivityDetection || false,
      };

      const result = await sttClient.recognize(audioBuffer, sttConfig);

      res.json({
        success: true,
        data: {
          transcript: result.transcript,
          confidence: result.confidence,
          alternatives: result.alternatives,
          words: result.words,
          isFinal: result.isFinal,
        },
      });
    } catch (error) {
      console.error('STT recognition error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'STT recognition failed',
      });
    }
  });

  // Get supported languages
  router.get('/languages', (req, res) => {
    res.json({
      success: true,
      data: {
        languages: [
          { code: 'en-US', name: 'English (US)' },
          { code: 'en-GB', name: 'English (UK)' },
          { code: 'fr-FR', name: 'French (France)' },
          { code: 'es-ES', name: 'Spanish (Spain)' },
          { code: 'de-DE', name: 'German (Germany)' },
          { code: 'it-IT', name: 'Italian (Italy)' },
          { code: 'pt-BR', name: 'Portuguese (Brazil)' },
          { code: 'ja-JP', name: 'Japanese (Japan)' },
          { code: 'ko-KR', name: 'Korean (South Korea)' },
          { code: 'zh-CN', name: 'Chinese (Simplified)' },
        ],
      },
    });
  });

  // Get supported audio encodings
  router.get('/encodings', (req, res) => {
    res.json({
      success: true,
      data: {
        encodings: [
          { 
            name: 'LINEAR16', 
            description: '16-bit linear PCM',
            sampleRates: [8000, 16000, 24000, 48000],
            recommended: true,
          },
          { 
            name: 'FLAC', 
            description: 'Free Lossless Audio Codec',
            sampleRates: [8000, 16000, 24000, 48000],
            recommended: false,
          },
          { 
            name: 'MULAW', 
            description: 'μ-law encoding',
            sampleRates: [8000],
            recommended: false,
          },
          { 
            name: 'OGG_OPUS', 
            description: 'Opus in Ogg container',
            sampleRates: [16000, 24000, 48000],
            recommended: false,
          },
          { 
            name: 'WEBM_OPUS', 
            description: 'Opus in WebM container',
            sampleRates: [16000, 24000, 48000],
            recommended: false,
          },
        ],
      },
    });
  });

  // Health check for STT service
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      data: {
        service: 'stt',
        status: 'healthy',
        demoMode: process.env.DEMO_MODE === 'true',
        timestamp: new Date().toISOString(),
      },
    });
  });

  return router;
}
