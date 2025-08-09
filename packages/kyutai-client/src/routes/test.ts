import { Router } from 'express';
import { KyutaiSTTClient } from '../clients/stt-client';
import { KyutaiTTSClient } from '../clients/tts-client';

export default function createTestRoutes(sttClient: KyutaiSTTClient, ttsClient: KyutaiTTSClient) {
  const router = Router();

  // Test STT with sample audio
  router.post('/stt', async (req, res) => {
    try {
      // Generate mock audio data for testing
      const sampleRate = 16000;
      const duration = 2; // 2 seconds
      const sampleCount = sampleRate * duration;
      const audioBuffer = Buffer.alloc(sampleCount * 2); // 16-bit audio

      // Fill with simple sine wave (mock audio)
      for (let i = 0; i < sampleCount; i++) {
        const t = i / sampleRate;
        const frequency = 440; // A4 note
        const amplitude = Math.sin(t * frequency * 2 * Math.PI) * 0.3;
        const sample = Math.floor(amplitude * 32767);
        audioBuffer.writeInt16LE(sample, i * 2);
      }

      const config = {
        language: req.body.language || 'en-US',
        sampleRate,
        encoding: 'LINEAR16',
        interimResults: false,
        enableVoiceActivityDetection: true,
      };

      const result = await sttClient.recognize(audioBuffer, config);

      res.json({
        success: true,
        data: {
          test: 'stt',
          input: {
            audioLength: audioBuffer.length,
            duration,
            sampleRate,
            config,
          },
          result,
        },
      });
    } catch (error) {
      console.error('STT test error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'STT test failed',
      });
    }
  });

  // Test TTS with sample text
  router.post('/tts', async (req, res) => {
    try {
      const text = req.body.text || 'Hello! This is a test of the Kyutai text-to-speech system. How do I sound?';
      
      const config = {
        voice: {
          languageCode: req.body.language || 'en-US',
          name: req.body.voiceName || 'en-US-Standard-A',
          gender: req.body.gender || 'NEUTRAL',
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 16000,
          speakingRate: req.body.speakingRate || 1.0,
          pitch: req.body.pitch || 0.0,
          volumeGainDb: req.body.volumeGainDb || 0.0,
        },
        enableLowLatency: req.body.enableLowLatency || false,
      };

      const result = await ttsClient.synthesize(text, config);

      res.json({
        success: true,
        data: {
          test: 'tts',
          input: {
            text,
            textLength: text.length,
            wordCount: text.split(/\s+/).length,
            config,
          },
          result: {
            audioContent: result.audioContent.toString('base64'),
            audioLength: result.audioContent.length,
            timepoints: result.timepoints,
            estimatedDuration: result.timepoints?.[result.timepoints.length - 1]?.timeSeconds || 0,
          },
        },
      });
    } catch (error) {
      console.error('TTS test error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'TTS test failed',
      });
    }
  });

  // Full round-trip test (TTS -> STT)
  router.post('/roundtrip', async (req, res) => {
    try {
      const originalText = req.body.text || 'This is a round-trip test of speech synthesis and recognition.';
      
      // Step 1: Text to Speech
      const ttsConfig = {
        voice: {
          languageCode: 'en-US',
          name: 'en-US-Standard-A',
          gender: 'NEUTRAL' as const,
        },
        audioConfig: {
          audioEncoding: 'LINEAR16',
          sampleRateHertz: 16000,
          speakingRate: 1.0,
          pitch: 0.0,
          volumeGainDb: 0.0,
        },
        enableLowLatency: false,
      };

      const ttsResult = await ttsClient.synthesize(originalText, ttsConfig);

      // Step 2: Speech to Text
      const sttConfig = {
        language: 'en-US',
        sampleRate: 16000,
        encoding: 'LINEAR16',
        interimResults: false,
        enableVoiceActivityDetection: true,
      };

      const sttResult = await sttClient.recognize(ttsResult.audioContent, sttConfig);

      // Calculate accuracy
      const originalWords = originalText.toLowerCase().split(/\s+/);
      const recognizedWords = sttResult.transcript.toLowerCase().split(/\s+/);
      const accuracy = calculateWordAccuracy(originalWords, recognizedWords);

      res.json({
        success: true,
        data: {
          test: 'roundtrip',
          originalText,
          recognizedText: sttResult.transcript,
          accuracy: {
            percentage: accuracy.percentage,
            correctWords: accuracy.correctWords,
            totalWords: accuracy.totalWords,
            wordErrorRate: accuracy.wordErrorRate,
          },
          ttsResult: {
            audioLength: ttsResult.audioContent.length,
            timepoints: ttsResult.timepoints,
          },
          sttResult: {
            confidence: sttResult.confidence,
            alternatives: sttResult.alternatives,
            words: sttResult.words,
          },
          metadata: {
            processingTimeMs: Date.now(),
            audioSizeBytes: ttsResult.audioContent.length,
            estimatedDuration: ttsResult.timepoints?.[ttsResult.timepoints.length - 1]?.timeSeconds || 0,
          },
        },
      });
    } catch (error) {
      console.error('Round-trip test error:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Round-trip test failed',
      });
    }
  });

  // System status and capabilities
  router.get('/status', (req, res) => {
    res.json({
      success: true,
      data: {
        system: {
          demoMode: process.env.DEMO_MODE === 'true',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        },
        capabilities: {
          stt: {
            enabled: true,
            streamingSupported: true,
            languagesSupported: ['en-US', 'en-GB', 'fr-FR', 'es-ES', 'de-DE'],
            encodingsSupported: ['LINEAR16', 'FLAC', 'OGG_OPUS', 'WEBM_OPUS'],
          },
          tts: {
            enabled: true,
            streamingSupported: true,
            languagesSupported: ['en-US', 'en-GB', 'fr-FR', 'es-ES', 'de-DE'],
            voicesAvailable: 12,
            encodingsSupported: ['LINEAR16', 'MP3', 'OGG_OPUS'],
          },
          realtime: {
            websocketSupported: true,
            audioStreamingSupported: true,
            lowLatencyMode: true,
          },
        },
      },
    });
  });

  return router;
}

// Helper function for calculating word accuracy
function calculateWordAccuracy(original: string[], recognized: string[]): {
    percentage: number;
    correctWords: number;
    totalWords: number;
    wordErrorRate: number;
  } {
    const totalWords = original.length;
    let correctWords = 0;

    // Simple word-by-word comparison
    const minLength = Math.min(original.length, recognized.length);
    for (let i = 0; i < minLength; i++) {
      if (original[i] === recognized[i]) {
        correctWords++;
      }
    }

    const percentage = totalWords > 0 ? (correctWords / totalWords) * 100 : 0;
    const wordErrorRate = totalWords > 0 ? ((totalWords - correctWords) / totalWords) * 100 : 0;

    return {
      percentage: Math.round(percentage * 100) / 100,
      correctWords,
      totalWords,
      wordErrorRate: Math.round(wordErrorRate * 100) / 100,
    };
  }
