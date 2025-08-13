import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioCaptureConfig {
  sampleRate?: number;
  chunkSize?: number;
  onAudioChunk?: (audioChunk: Buffer) => void;
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: Error) => void;
}

export const useAudioCapture = (config: AudioCaptureConfig) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  const {
    sampleRate = 16000,
    chunkSize = 1024,
    onAudioChunk,
    onStart,
    onStop,
    onError
  } = config;

  // Check browser support
  useEffect(() => {
    const checkSupport = () => {
      const hasMediaRecorder = typeof MediaRecorder !== 'undefined';
      const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
      const hasAudioContext = typeof AudioContext !== 'undefined';
      
      setIsSupported(hasMediaRecorder && hasGetUserMedia && hasAudioContext);
    };
    
    checkSupport();
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (!isSupported) {
      onError?.(new Error('Audio recording not supported in this browser'));
      return;
    }

    try {
      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      streamRef.current = stream;
      
      // Create audio context for real-time processing
      const audioContext = new AudioContext({ sampleRate });
      audioContextRef.current = audioContext;
      
      // Create audio source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create script processor for real-time audio chunks
      const processor = audioContext.createScriptProcessor(chunkSize, 1, 1);
      processorRef.current = processor;
      
      // Process audio chunks in real-time
      processor.onaudioprocess = (event) => {
        if (!isRecording) return;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Convert float32 to int16 (16-bit PCM)
        const pcmBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmBuffer[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        
        // Convert to Buffer and send
        const audioChunk = Buffer.from(pcmBuffer.buffer);
        onAudioChunk?.(audioChunk);
      };
      
      // Connect audio nodes
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      setIsRecording(true);
      onStart?.();
      
      console.log('🎤 Audio recording started');
      
    } catch (error) {
      console.error('❌ Failed to start audio recording:', error);
      onError?.(error instanceof Error ? error : new Error('Failed to start recording'));
    }
  }, [isSupported, sampleRate, chunkSize, onAudioChunk, onStart, onError]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    
    try {
      // Stop all audio processing
      if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
      }
      
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
      
      setIsRecording(false);
      onStop?.();
      
      console.log('🛑 Audio recording stopped');
      
    } catch (error) {
      console.error('❌ Error stopping audio recording:', error);
      onError?.(error instanceof Error ? error : new Error('Failed to stop recording'));
    }
  }, [isRecording, onStop, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        stopRecording();
      }
    };
  }, [isRecording, stopRecording]);

  return {
    isRecording,
    isSupported,
    startRecording,
    stopRecording
  };
};
