import { PythonWhisperSTT } from './python-whisper-stt';
import { WhisperSTT } from './whisper-stt';

export interface HybridSTTConfig {
  primaryProvider: 'python-whisper' | 'openai';
  fallbackProvider?: 'openai' | 'python-whisper';
  pythonWhisperConfig?: {
    model?: string;
    language?: string;
    pythonPath?: string;
    device?: 'cpu' | 'cuda';
  };
  openaiConfig?: {
    model?: string;
    language?: string;
    apiKey?: string;
  };
}

export class HybridSTT {
  private pythonWhisper: PythonWhisperSTT | null = null;
  private openaiWhisper: WhisperSTT | null = null;
  private config: HybridSTTConfig;

  constructor(config: HybridSTTConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    try {
      if (this.config.primaryProvider === 'python-whisper') {
        this.pythonWhisper = new PythonWhisperSTT(this.config.pythonWhisperConfig);
        await this.pythonWhisper.initialize();
        console.log('✅ Primary STT: Python Whisper initialized');
      } else if (this.config.primaryProvider === 'openai') {
        this.openaiWhisper = new WhisperSTT(this.config.openaiConfig);
        console.log('✅ Primary STT: OpenAI Whisper initialized');
      }

      // Initialize fallback provider
      if (this.config.fallbackProvider && this.config.fallbackProvider !== this.config.primaryProvider) {
        if (this.config.fallbackProvider === 'python-whisper') {
          this.pythonWhisper = new PythonWhisperSTT(this.config.pythonWhisperConfig);
          await this.pythonWhisper.initialize();
          console.log('✅ Fallback STT: Python Whisper initialized');
        } else if (this.config.fallbackProvider === 'openai') {
          this.openaiWhisper = new WhisperSTT(this.config.openaiConfig);
          console.log('✅ Fallback STT: OpenAI Whisper initialized');
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize STT providers:', error);
      throw error;
    }
  }

  async transcribeWavBuffer(buffer: Buffer): Promise<string> {
    try {
      // Try primary provider first
      if (this.config.primaryProvider === 'python-whisper' && this.pythonWhisper) {
        try {
          return await this.pythonWhisper.transcribeWavBuffer(buffer);
        } catch (error) {
          console.warn('⚠️ Primary STT (python-whisper) failed, trying fallback...', error);
          if (this.config.fallbackProvider === 'openai' && this.openaiWhisper) {
            return await this.openaiWhisper.transcribeWavBuffer(buffer);
          }
          throw error;
        }
      } else if (this.config.primaryProvider === 'openai' && this.openaiWhisper) {
        try {
          return await this.openaiWhisper.transcribeWavBuffer(buffer);
        } catch (error) {
          console.warn('⚠️ Primary STT (openai) failed, trying fallback...', error);
          if (this.config.fallbackProvider === 'python-whisper' && this.pythonWhisper) {
            return await this.pythonWhisper.transcribeWavBuffer(buffer);
          }
          throw error;
        }
      }
      
      throw new Error('No STT provider available');
    } catch (error) {
      console.error('❌ All STT providers failed:', error);
      throw error;
    }
  }

  async transcribeFile(filePath: string): Promise<string> {
    try {
      if (this.config.primaryProvider === 'python-whisper' && this.pythonWhisper) {
        try {
          return await this.pythonWhisper.transcribeFile(filePath);
        } catch (error) {
          if (this.config.fallbackProvider === 'openai' && this.openaiWhisper) {
            return await this.openaiWhisper.transcribeFile(filePath);
          }
          throw error;
        }
      } else if (this.config.primaryProvider === 'openai' && this.openaiWhisper) {
        try {
          return await this.openaiWhisper.transcribeFile(filePath);
        } catch (error) {
          if (this.config.fallbackProvider === 'python-whisper' && this.pythonWhisper) {
            return await this.pythonWhisper.transcribeFile(filePath);
          }
          throw error;
        }
      }
      
      throw new Error('No STT provider available');
    } catch (error) {
      console.error('❌ All STT providers failed:', error);
      throw error;
    }
  }

  getProviderInfo(): { primary: string; fallback?: string; cost: string } {
    const primary = this.config.primaryProvider === 'python-whisper' ? 'Python Whisper (FREE)' : 'OpenAI Whisper (PAID)';
    const fallback = this.config.fallbackProvider ? 
      (this.config.fallbackProvider === 'python-whisper' ? 'Python Whisper (FREE)' : 'OpenAI Whisper (PAID)') : 
      undefined;
    
    return {
      primary,
      fallback,
      cost: this.config.primaryProvider === 'python-whisper' ? 'FREE' : 'PAID'
    };
  }
}
