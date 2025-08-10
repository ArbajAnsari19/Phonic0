import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface PythonWhisperConfig {
  model?: string;
  language?: string;
  pythonPath?: string;
  device?: 'cpu' | 'cuda';
  skipSSLVerification?: boolean; // Add this new option
}

export class PythonWhisperSTT {
  private config: PythonWhisperConfig;
  private isInitialized = false;

  constructor(config: PythonWhisperConfig = {}) {
    this.config = {
      model: 'base',
      language: 'en',
      pythonPath: 'python3',
      device: 'cpu',
      skipSSLVerification: process.env.WHISPER_SKIP_SSL_VERIFICATION === 'true' || true,
      ...config
    };
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('🐍 Initializing Python Whisper...');
      
      // Check if Python is available
      await this.checkPythonAvailability();
      
      // Install whisper if not available
      await this.installWhisper();
      
      this.isInitialized = true;
      console.log('✅ Python Whisper initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Python Whisper:', error);
      throw new Error(`Python Whisper initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async checkPythonAvailability(): Promise<void> {
    return new Promise((resolve, reject) => {
      const python = spawn(this.config.pythonPath!, ['--version']);
      
      python.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Python not available. Exit code: ${code}`));
        }
      });
      
      python.on('error', (error) => {
        reject(new Error(`Python not found: ${error.message}`));
      });
    });
  }

  private async installWhisper(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('📦 Installing OpenAI Whisper...');
      
      const pip = spawn(this.config.pythonPath!, ['-m', 'pip', 'install', 'openai-whisper']);
      
      pip.stdout?.on('data', (data) => {
        console.log(`�� ${data.toString().trim()}`);
      });
      
      pip.stderr?.on('data', (data) => {
        console.log(`�� ${data.toString().trim()}`);
      });
      
      pip.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Whisper installed successfully');
          resolve();
        } else {
          reject(new Error(`Failed to install Whisper. Exit code: ${code}`));
        }
      });
      
      pip.on('error', (error) => {
        reject(new Error(`Failed to install Whisper: ${error.message}`));
      });
    });
  }

  async transcribeWavBuffer(buffer: Buffer): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Check if buffer has actual audio data
      if (buffer.length < 1000) {
        console.log('⚠️ Audio buffer too small:', buffer.length, 'bytes');
        throw new Error('Audio buffer too small');
      }

      console.log('�� Transcribing audio with Python Whisper, size:', buffer.length, 'bytes');

      // Write buffer to temporary file
      const tmpDir = os.tmpdir();
      const audioPath = path.join(tmpDir, `whisper_${Date.now()}.wav`);
      fs.writeFileSync(audioPath, buffer);

      // Transcribe using Python Whisper
      const transcript = await this.runWhisperTranscription(audioPath);
      
      // Clean up temp file
      try {
        fs.unlinkSync(audioPath);
      } catch (e) {
        console.warn('Failed to cleanup temp file:', e);
      }

      if (!transcript || transcript.length < 2) {
        throw new Error('No speech detected - empty transcription');
      }

      console.log('✅ Python Whisper transcript:', transcript);
      return transcript;

    } catch (error: any) {
      console.error('❌ Python Whisper transcription error:', error);
      
      if (error.message?.includes('Audio buffer too small')) {
        throw new Error('No speech detected - audio too short');
      } else if (error.message?.includes('Empty transcription')) {
        throw new Error('No speech detected - empty transcription');
      } else {
        throw new Error(`Python speech recognition failed: ${error.message}`);
      }
    }
  }

  private async runWhisperTranscription(audioPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const model = this.config.model || 'base';
      const device = this.config.device || 'cpu';
      const skipSSL = this.config.skipSSLVerification;
      
      // Set environment variables to disable SSL verification
      const env = {
        ...process.env,
        PYTHONHTTPSVERIFY: '0',
        SSL_CERT_FILE: '',
        SSL_CERT_DIR: ''
      };

      const args = [
        '-c',
        `
import whisper
import sys
import json
import ssl
import urllib.request

# Disable SSL verification if configured
if ${skipSSL ? 'True' : 'False'}:
    ssl._create_default_https_context = ssl._create_unverified_context
    print("SSL verification disabled for development", file=sys.stderr)

try:
    model = whisper.load_model("${model}")
    result = model.transcribe("${audioPath}", language="${this.config.language}")
    print(json.dumps({"success": True, "text": result["text"]}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}))
        `
      ];

      const python = spawn(this.config.pythonPath!, args, { env });
      
      let output = '';
      let errorOutput = '';
      
      python.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      python.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      python.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(output.trim());
            if (result.success) {
              resolve(result.text.trim());
            } else {
              reject(new Error(result.error || 'Transcription failed'));
            }
          } catch (parseError) {
            reject(new Error(`Failed to parse Python output: ${output}`));
          }
        } else {
          reject(new Error(`Python process failed with code ${code}: ${errorOutput}`));
        }
      });
      
      python.on('error', (error) => {
        reject(new Error(`Failed to run Python Whisper: ${error.message}`));
      });
    });
  }

  async transcribeFile(filePath: string): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      return await this.runWhisperTranscription(filePath);
    } catch (error) {
      console.error('Python Whisper file transcription error:', error);
      throw error;
    }
  }

  // Get available models
  static getAvailableModels(): string[] {
    return ['tiny', 'base', 'small', 'medium', 'large'];
  }

  // Get model info
  static getModelInfo(modelName: string): { size: string; accuracy: string; speed: string } {
    const modelInfo = {
      'tiny': { size: '39 MB', accuracy: 'Low', speed: 'Fastest' },
      'base': { size: '74 MB', accuracy: 'Medium', speed: 'Fast' },
      'small': { size: '244 MB', accuracy: 'Good', speed: 'Medium' },
      'medium': { size: '769 MB', accuracy: 'High', speed: 'Slow' },
      'large': { size: '1550 MB', accuracy: 'Highest', speed: 'Slowest' }
    };
    
    return modelInfo[modelName as keyof typeof modelInfo] || { size: 'Unknown', accuracy: 'Unknown', speed: 'Unknown' };
  }
}
