import { useState, useRef, useCallback, useEffect } from 'react';

interface VoiceActivityConfig {
  threshold?: number;
  silenceDuration?: number;
  onVoiceStart?: () => void;
  onVoiceEnd?: () => void;
}

export const useVoiceActivity = (config: VoiceActivityConfig) => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const {
    threshold = 0.1,
    silenceDuration = 1000,
    onVoiceStart,
    onVoiceEnd
  } = config;

  // Initialize audio analysis
  const initializeAnalyser = useCallback((stream: MediaStream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    
    source.connect(analyser);
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    
    return analyser;
  }, []);

  // Analyze audio for voice activity
  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current || !dataArrayRef.current) return;
    
    const analyser = analyserRef.current;
    const dataArray = dataArrayRef.current;
    
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate RMS (Root Mean Square) for volume
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length) / 255;
    
    setVolume(rms);
    
    // Detect voice activity
    if (rms > threshold && !isSpeaking) {
      setIsSpeaking(true);
      onVoiceStart?.();
      
      // Clear silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    } else if (rms <= threshold && isSpeaking) {
      // Start silence timer
      silenceTimerRef.current = setTimeout(() => {
        setIsSpeaking(false);
        onVoiceEnd?.();
      }, silenceDuration);
    }
  }, [threshold, silenceDuration, isSpeaking, onVoiceStart, onVoiceEnd]);

  // Start monitoring
  const startMonitoring = useCallback((stream: MediaStream) => {
    const analyser = initializeAnalyser(stream);
    
    const checkVolume = () => {
      analyzeAudio();
      requestAnimationFrame(checkVolume);
    };
    
    checkVolume();
  }, [initializeAnalyser, analyzeAudio]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    
    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }
    
    setIsSpeaking(false);
    setVolume(0);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    isSpeaking,
    volume,
    startMonitoring,
    stopMonitoring
  };
};
