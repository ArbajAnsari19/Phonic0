export class MicRecorder {
  private mediaStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private isRecording = false;
  public onAudioChunk?: (chunk: Int16Array) => void;

  async start(): Promise<void> {
    try {
      console.log('🎤 [MicRecorder] Starting microphone recording...');
      
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      
      console.log('🎤 [MicRecorder] Microphone access granted:', this.mediaStream.getAudioTracks()[0].label);

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      console.log('🎤 [MicRecorder] Audio context created, state:', this.audioContext.state);
      
      // Resume audio context if suspended (browser autoplay policy)
      if (this.audioContext.state === 'suspended') {
        console.log('🎤 [MicRecorder] Resuming suspended audio context...');
        await this.audioContext.resume();
        console.log('🎤 [MicRecorder] Audio context resumed, state:', this.audioContext.state);
      }
      
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Create processor for real-time chunks
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (event) => {
        if (!this.isRecording) return;
        
        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);
        
        // Convert float32 to int16
        const int16Array = new Int16Array(channelData.length);
        for (let i = 0; i < channelData.length; i++) {
          const sample = Math.max(-1, Math.min(1, channelData[i]));
          int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        }
        
        // Send chunk via callback
        if (this.onAudioChunk) {
          console.log('🎵 [MicRecorder] Audio chunk generated:', int16Array.length, 'samples');
          console.log('🎯 [MicRecorder] Calling onAudioChunk callback...');
          this.onAudioChunk(int16Array);
          console.log('✅ [MicRecorder] Callback completed');
        } else {
          console.warn('⚠️ [MicRecorder] onAudioChunk callback not set!');
        }
      };

      // Connect audio pipeline
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      this.isRecording = true;
      console.log('✅ [MicRecorder] Started with real-time streaming');

    } catch (error) {
      console.error('❌ [MicRecorder] Failed to start microphone recording:', error);
      throw error;
    }
  }

  stop(): void {
    console.log('🛑 [MicRecorder] Stopping recording...');
    this.isRecording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    console.log('✅ [MicRecorder] Stopped successfully');
  }
}

// Helper function to convert Int16Array to base64
export function int16ToBase64(int16: Int16Array): string {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
  }
  return btoa(binary);
}

// Add the missing playBase64Wav function
export function playBase64Wav(base64Audio: string): void {
  try {
    // Convert base64 to binary
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create audio blob and play
    const blob = new Blob([bytes], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);
    
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl); // Clean up
    };
    
    audio.play().catch(error => {
      console.error('Failed to play audio:', error);
    });
  } catch (error) {
    console.error('Error playing base64 audio:', error);
  }
}