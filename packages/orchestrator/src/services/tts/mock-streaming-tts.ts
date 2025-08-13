import { BaseStreamingTTS, StreamingTTSConfig } from './streaming-tts';

export class MockStreamingTTS extends BaseStreamingTTS {
  private textChunks: string[] = [];
  private audioChunks: Buffer[] = [];
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(config?: StreamingTTSConfig) {
    super(config || {});
  }

  async startStreaming(text: string): Promise<void> {
    if (this.isProcessing) {
      await this.stopStreaming();
    }

    this.isProcessing = true;
    this.textChunks = this.splitTextIntoChunks(text);
    this.audioChunks = [];
    this.currentText = text;

    console.log(`�� [MockTTS] Starting streaming for: "${text}"`);

    // Simulate streaming audio generation
    this.processingInterval = setInterval(() => {
      this.processNextChunk();
    }, 100); // Process chunk every 100ms
  }

  async stopStreaming(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    this.isProcessing = false;
    this.textChunks = [];
    this.audioChunks = [];
  }

  getPartialAudio(): Buffer {
    if (this.audioChunks.length === 0) {
      return Buffer.alloc(0);
    }
    return Buffer.concat(this.audioChunks);
  }

  private splitTextIntoChunks(text: string): string[] {
    // Split text into words for realistic streaming
    const words = text.split(' ');
    const chunks: string[] = [];
    
    for (let i = 0; i < words.length; i++) {
      const chunk = words.slice(0, i + 1).join(' ');
      chunks.push(chunk);
    }
    
    return chunks;
  }

  private processNextChunk(): void {
    if (this.textChunks.length === 0) {
      this.finishStreaming();
      return;
    }

    const textChunk = this.textChunks.shift()!;
    const audioChunk = this.generateMockAudio(textChunk);
    
    this.audioChunks.push(audioChunk);
    
    // Emit partial audio
    this.emitPartialAudio(audioChunk, textChunk);
    
    console.log(`🎵 [MockTTS] Generated audio for: "${textChunk}"`);
  }

  private finishStreaming(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    
    this.isProcessing = false;
    
    // Emit complete audio
    const completeAudio = Buffer.concat(this.audioChunks);
    this.emitCompleteAudio(completeAudio, this.currentText);
    
    console.log(`✅ [MockTTS] Streaming completed for: "${this.currentText}"`);
  }

  private generateMockAudio(text: string): Buffer {
    // Generate mock audio data based on text length
    const duration = text.length * 50; // 50ms per character
    const sampleRate = this.config.sampleRate!;
    const samples = Math.floor((duration / 1000) * sampleRate);
    
    // Create a simple sine wave as mock audio
    const audioBuffer = Buffer.alloc(samples * 2); // 16-bit samples
    
    for (let i = 0; i < samples; i++) {
      const sample = Math.sin((i / samples) * 2 * Math.PI) * 16384; // 16-bit range
      audioBuffer.writeInt16LE(sample, i * 2);
    }
    
    return audioBuffer;
  }
}
