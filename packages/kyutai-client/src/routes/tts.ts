import { Router } from 'express';
import { KyutaiTTSClient } from '../clients/tts-client';

export default function createTTSRoutes(ttsClient: KyutaiTTSClient) {
  const router = Router();

  // Single synthesis endpoint
  router.post('/synthesize', async (req, res): Promise<void> => {
    try {
      const { text, config } = req.body;

      if (!text || typeof text !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Text is required and must be a string',
        });
        return;
      }

      const ttsConfig = {
        voice: {
          languageCode: config?.voice?.languageCode || 'en-US',
          name: config?.voice?.name || 'en-US-Standard-A',
          gender: config?.voice?.gender || 'NEUTRAL',
        },
        audioConfig: {
          audioEncoding: config?.audioConfig?.audioEncoding || 'LINEAR16',
          sampleRateHertz: config?.audioConfig?.sampleRateHertz || 16000,
          speakingRate: config?.audioConfig?.speakingRate || 1.0,
          pitch: config?.audioConfig?.pitch || 0.0,
          volumeGainDb: config?.audioConfig?.volumeGainDb || 0.0,
        },
        enableLowLatency: config?.enableLowLatency || false,
      };

      const result = await ttsClient.synthesize(text, ttsConfig);

      res.json({
        success: true,
        data: {
          audioContent: result.audioContent.toString('base64'),
          timepoints: result.timepoints,
          audioConfig: ttsConfig.audioConfig,
          metadata: {
            textLength: text.length,
            estimatedDuration: result.timepoints?.[result.timepoints.length - 1]?.timeSeconds || 0,
            wordCount: text.split(/\s+/).length,
          },
        },
      });
    } catch (error) {
      console.error('TTS synthesis error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'TTS synthesis failed',
      });
    }
  });

  // Get available voices
  router.get('/voices', (req, res) => {
    const { languageCode } = req.query;

    const allVoices = [
      // English voices
      { name: 'en-US-Standard-A', languageCode: 'en-US', gender: 'FEMALE', description: 'US English, Female' },
      { name: 'en-US-Standard-B', languageCode: 'en-US', gender: 'MALE', description: 'US English, Male' },
      { name: 'en-US-Standard-C', languageCode: 'en-US', gender: 'FEMALE', description: 'US English, Female' },
      { name: 'en-US-Standard-D', languageCode: 'en-US', gender: 'MALE', description: 'US English, Male' },
      { name: 'en-GB-Standard-A', languageCode: 'en-GB', gender: 'FEMALE', description: 'UK English, Female' },
      { name: 'en-GB-Standard-B', languageCode: 'en-GB', gender: 'MALE', description: 'UK English, Male' },
      
      // French voices
      { name: 'fr-FR-Standard-A', languageCode: 'fr-FR', gender: 'FEMALE', description: 'French, Female' },
      { name: 'fr-FR-Standard-B', languageCode: 'fr-FR', gender: 'MALE', description: 'French, Male' },
      
      // Spanish voices
      { name: 'es-ES-Standard-A', languageCode: 'es-ES', gender: 'FEMALE', description: 'Spanish, Female' },
      { name: 'es-ES-Standard-B', languageCode: 'es-ES', gender: 'MALE', description: 'Spanish, Male' },
      
      // German voices
      { name: 'de-DE-Standard-A', languageCode: 'de-DE', gender: 'FEMALE', description: 'German, Female' },
      { name: 'de-DE-Standard-B', languageCode: 'de-DE', gender: 'MALE', description: 'German, Male' },
    ];

    const filteredVoices = languageCode 
      ? allVoices.filter(voice => voice.languageCode === languageCode)
      : allVoices;

    res.json({
      success: true,
      data: {
        voices: filteredVoices,
        totalCount: filteredVoices.length,
      },
    });
  });

  // Get supported languages
  router.get('/languages', (req, res) => {
    res.json({
      success: true,
      data: {
        languages: [
          { code: 'en-US', name: 'English (US)', voiceCount: 4 },
          { code: 'en-GB', name: 'English (UK)', voiceCount: 2 },
          { code: 'fr-FR', name: 'French (France)', voiceCount: 2 },
          { code: 'es-ES', name: 'Spanish (Spain)', voiceCount: 2 },
          { code: 'de-DE', name: 'German (Germany)', voiceCount: 2 },
          { code: 'it-IT', name: 'Italian (Italy)', voiceCount: 2 },
          { code: 'pt-BR', name: 'Portuguese (Brazil)', voiceCount: 2 },
          { code: 'ja-JP', name: 'Japanese (Japan)', voiceCount: 2 },
          { code: 'ko-KR', name: 'Korean (South Korea)', voiceCount: 2 },
          { code: 'zh-CN', name: 'Chinese (Simplified)', voiceCount: 2 },
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
            fileExtension: 'wav',
            recommended: true,
          },
          { 
            name: 'MP3', 
            description: 'MP3 audio encoding',
            fileExtension: 'mp3',
            recommended: false,
          },
          { 
            name: 'OGG_OPUS', 
            description: 'Opus in Ogg container',
            fileExtension: 'ogg',
            recommended: false,
          },
          { 
            name: 'MULAW', 
            description: 'μ-law encoding',
            fileExtension: 'wav',
            recommended: false,
          },
          { 
            name: 'ALAW', 
            description: 'A-law encoding',
            fileExtension: 'wav',
            recommended: false,
          },
        ],
      },
    });
  });

  // Health check for TTS service
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      data: {
        service: 'tts',
        status: 'healthy',
        demoMode: process.env.DEMO_MODE === 'true',
        timestamp: new Date().toISOString(),
      },
    });
  });

  return router;
}
