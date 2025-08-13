import { useState, useRef, useCallback, useEffect } from 'react';

interface AudioPlaybackConfig {
  sampleRate?: number;
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: Error) => void;
}

export const useAudioPlayback = (config: AudioPlaybackConfig) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<Buffer[]>([]);
  const isProcessingRef = useRef(false);

  const {
    sampleRate = 16000,
    onStart,
    onStop,
    onError
  } = config;

  // Check browser support
  useEffect(() => {
    const checkSupport = () => {
      const hasAudioContext = typeof AudioContext !== 'undefined';
      setIsSupported(hasAudioContext);
    };
    
    checkSupport();
  }, []);

  // Process audio queue
  const processAudioQueue = useCallback(async () => {
    if (isProcessingRef.current || audioQueueRef.current.length === 0) return;
    
    isProcessingRef.current = true;
    
    try {
      const audioChunk = audioQueueRef.current.shift()!;
      
      // Convert Buffer to AudioBuffer
      const audioBuffer = await audioChunkToAudioBuffer(audioChunk, sampleRate);
      
      // Play audio
      await playAudioBuffer(audioBuffer);
      
      // Process next chunk
      isProcessingRef.current = false;
      if (audioQueueRef.current.length > 0) {
        processAudioQueue();
      }
      
    } catch (error) {
      console.error('❌ Error processing audio chunk:', error);
      isProcessingRef.current = false;
      onError?.(error instanceof Error ? error : new Error('Failed to process audio'));
    }
  }, [sampleRate, onError]);

  // Play audio chunk
  const playAudioChunk = useCallback((audioChunk: Buffer) => {
    if (!isSupported) {
      onError?.(new Error('Audio playback not supported in this browser'));
      return;
    }

    // Add to queue
    audioQueueRef.current.push(audioChunk);
    
    // Start processing if not already processing
    if (!isProcessingRef.current) {
      processAudioQueue();
    }
  }, [isSupported, processAudioQueue, onError]);

  // Convert Buffer to AudioBuffer
  const audioChunkToAudioBuffer = async (audioChunk: Buffer, sampleRate: number): Promise<AudioBuffer> => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext({ sampleRate });
    }
    
    const audioContext = audioContextRef.current;
    const audioBuffer = audioContext.createBuffer(1, audioChunk.length / 2, sampleRate);
    const channelData = audioBuffer.getChannelData(0);
    
    // Convert int16 to float32
    const int16Array = new Int16Array(audioChunk.buffer);
    for (let i = 0; i < int16Array.length; i++) {
      channelData[i] = int16Array[i] / 32768;
    }
    
    return audioBuffer;
  };

  // Play AudioBuffer
  const playAudioBuffer = async (audioBuffer: AudioBuffer): Promise<void> => {
    if (!audioContextRef.current) return;
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContextRef.current.destination);
    
    return new Promise((resolve) => {
      source.onended = () => resolve();
      
      source.start();
      setIsPlaying(true);
      onStart?.();
    });
  };

  // Stop playback
  const stopPlayback = useCallback(() => {
    try {
      // Clear audio queue
      audioQueueRef.current = [];
      isProcessingRef.current = false;
      
      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      
      setIsPlaying(false);
      onStop?.();
      
      console.log('🛑 Audio playback stopped');
      
    } catch (error) {
      console.error('❌ Error stopping audio playback:', error);
      onError?.(error instanceof Error ? error : new Error('Failed to stop playback'));
    }
  }, [onStop, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isPlaying) {
        stopPlayback();
      }
    };
  }, [isPlaying, stopPlayback]);

  return {
    isPlaying,
    isSupported,
    playAudioChunk,
    stopPlayback
  };
};
