import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface WhisperConfig {
  model?: string;
  language?: string;
  apiKey?: string;
}

export class WhisperSTT {
  private openai: OpenAI;
  private config: WhisperConfig;

  constructor(config: WhisperConfig = {}) {
    this.config = config;
    
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key required for Whisper STT');
    }

    this.openai = new OpenAI({ apiKey });
  }

  async transcribeWavBuffer(buffer: Buffer): Promise<string> {
    try {
      // Check if buffer has actual audio data
      if (buffer.length < 1000) { // Less than ~0.06 seconds at 16kHz
        console.log('⚠️ Audio buffer too small:', buffer.length, 'bytes');
        throw new Error('Audio buffer too small');
      }

      // Write to temp file
      const tmpDir = os.tmpdir();
      const wavPath = path.join(tmpDir, `whisper_${Date.now()}.wav`);
      fs.writeFileSync(wavPath, buffer);

      console.log('🎵 Transcribing audio file:', wavPath, 'Size:', buffer.length, 'bytes');

      // Use OpenAI Whisper API
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(wavPath),
        model: this.config.model || 'whisper-1',
        language: this.config.language || 'en',
        response_format: 'text',
        temperature: 0.2, // Lower temperature for more consistent results
      });

      // Clean up temp file
      try {
        fs.unlinkSync(wavPath);
      } catch (e) {
        console.warn('Failed to cleanup temp file:', e);
      }

      const transcript = transcription.trim();
      console.log('✅ Whisper transcript:', transcript);

      if (!transcript || transcript.length < 2) {
        throw new Error('Empty transcription result');
      }

      return transcript;

    } catch (error: any) {
      console.error('❌ Whisper transcription error:', error);
      
      // Re-throw with more specific error message
      if (error.message?.includes('Audio buffer too small')) {
        throw new Error('No speech detected - audio too short');
      } else if (error.message?.includes('Empty transcription')) {
        throw new Error('No speech detected - empty transcription');
      } else {
        throw new Error(`Speech recognition failed: ${error.message}`);
      }
    }
  }

  // Alternative method for testing with local files
  async transcribeFile(filePath: string): Promise<string> {
    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: this.config.model || 'whisper-1',
        language: this.config.language || 'en',
        response_format: 'text',
      });

      return transcription.trim();
    } catch (error) {
      console.error('Whisper file transcription error:', error);
      throw error;
    }
  }
}