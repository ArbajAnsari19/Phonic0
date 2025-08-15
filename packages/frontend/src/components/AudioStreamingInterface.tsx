import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAudioCapture } from '../hooks/useAudioCapture';
import { useAudioPlayback } from '../hooks/useAudioPlayback';
import { useVoiceActivity } from '../hooks/useVoiceActivity';

interface AudioStreamingInterfaceProps {
  onTranscript?: (transcript: string) => void;
  onAIResponse?: (response: string) => void;
  onError?: (error: string) => void;
}

export const AudioStreamingInterface: React.FC<AudioStreamingInterfaceProps> = ({
  onTranscript,
  onAIResponse,
  onError
}) => {
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Define functions BEFORE using them in hooks
  const handleAudioChunk = (audioChunk: Buffer) => {
    console.log('🎵 [Frontend] Audio chunk received:', {
      chunkSize: audioChunk.length,
      isConnected,
      sessionId: sessionIdRef.current,
      wsReady: wsRef.current?.readyState === WebSocket.OPEN
    });
    
    if (!isConnected || !sessionIdRef.current) {
      console.log('⚠️ [Frontend] Not connected or no session, skipping audio chunk');
      return;
    }
    
    // ✅ CRITICAL: Send audio as base64-encoded data in JSON message (like unmute)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = {
        type: 'audio_chunk',
        sessionId: sessionIdRef.current,
        audio: audioChunk.toString('base64'),
        timestamp: Date.now()
      };
      
      wsRef.current.send(JSON.stringify(message));
      console.log('✅ [Frontend] Audio chunk sent as JSON message');
    } else {
      console.error('❌ [Frontend] WebSocket not ready');
    }
  };

  const handleVoiceStart = () => {
    console.log('🎤 [Frontend] Voice detected - starting recording');
    console.log(' [Frontend] Current state:', { 
      isRecording, 
      isConnected, 
      sessionId: sessionIdRef.current 
    });
    
    if (!isRecording && isConnected && sessionIdRef.current) {
      // ✅ CRITICAL: Start recording automatically when voice detected
      startRecording();
      
      // ✅ CRITICAL: Send start_listening message to server
      wsRef.current?.send(JSON.stringify({
        type: 'start_listening',
        sessionId: sessionIdRef.current
      }));
    } else {
      console.log('⚠️ [Frontend] Cannot start recording:', { 
        isRecording, 
        isConnected, 
        sessionId: sessionIdRef.current 
      });
    }
  };

  const handleVoiceEnd = () => {
    console.log('🔇 Voice ended - stopping recording');
    if (isRecording) {
      // ✅ CRITICAL: Stop recording automatically when voice ends
      stopRecording();
      
      // ✅ CRITICAL: Send stop_listening message to server
      wsRef.current?.send(JSON.stringify({
        type: 'stop_listening',
        sessionId: sessionIdRef.current
      }));
    }
  };

    // ✅ CRITICAL: Initialize voice activity detection FIRST
    const { isSpeaking, volume, startMonitoring, stopMonitoring } = useVoiceActivity({
      onVoiceStart: handleVoiceStart,
      onVoiceEnd: handleVoiceEnd
    });

  // ✅ CRITICAL: Get audio stream AFTER voice activity is initialized
  const getAudioStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      audioStreamRef.current = stream;
      console.log('🎤 [Frontend] Audio stream obtained');
      
      // ✅ CRITICAL: Start voice monitoring immediately with the stream
      startMonitoring(stream);
      
      return stream;
    } catch (error) {
      console.error('❌ [Frontend] Failed to get audio stream:', error);
      onError?.('Failed to access microphone');
      return null;
    }
  }, [onError, startMonitoring]);



  // ✅ CRITICAL: Modified audio capture to use shared stream
  const { isRecording, isSupported: captureSupported, startRecording, stopRecording } = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    onStart: () => {
      console.log('🎤 [Frontend] Recording started');
      // ✅ CRITICAL: Voice monitoring already started, no need to start again
    },
    onStop: () => {
      console.log('🛑 [Frontend] Recording stopped');
      // ✅ CRITICAL: Don't stop voice monitoring, keep it running
    },
    onError: (error) => onError?.(error.message)
  });

  // ✅ CRITICAL: Get audio stream when component mounts
  useEffect(() => {
    getAudioStream();
  }, [getAudioStream]);

  // ✅ CRITICAL: Modified audio playback hook usage
  const { isPlaying, isSupported: playbackSupported, playAudioChunk } = useAudioPlayback({
    onStart: () => console.log('🔊 Playback started'),
    onStop: () => console.log('🛑 Playback stopped'),
    onError: (error) => onError?.(error.message)
  });

  // WebSocket connection
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  // Update WebSocket connection to handle binary:
  const connectWebSocket = () => {
    try {
      // Get auth token from localStorage
      const token = localStorage.getItem('phonic0_token');
      if (!token) {
        onError?.('Authentication token not found. Please login first.');
        return;
      }

      // Connect with token in query params
      const ws = new WebSocket(`ws://localhost:3004?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        setIsConnected(true);
        
        // ✅ CRITICAL: Send start_conversation NOT start_call
        ws.send(JSON.stringify({
          type: 'start_conversation',  // ✅ FIXED: Match backend expectation
          brainId: 'default'
        }));
      };

      ws.onmessage = (event) => {
        // Handle both JSON and binary messages
        if (event.data instanceof ArrayBuffer) {
          handleBinaryAudio(event.data);
        } else {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        onError?.('WebSocket connection failed');
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
      };

    } catch (error) {
      console.error('❌ Failed to connect WebSocket:', error);
      onError?.('Failed to connect to server');
    }
  };

  const disconnectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Handle binary audio from TTS
  const handleBinaryAudio = (audioData: ArrayBuffer) => {
    const audioBuffer = Buffer.from(audioData);
    playAudioChunk(audioBuffer); // ✅ FIXED: Now playAudioChunk is defined
  };

  // Update message handling to match unmute.sh protocol
  const handleWebSocketMessage = (message: any) => {
    console.log('📨 [Frontend] Received message:', message); // ✅ ADD LOGGING
    
    switch (message.type) {
      case 'session_created':
        sessionIdRef.current = message.sessionId;
        console.log('✅ [Frontend] Session created:', message.sessionId);
        break;
        
      case 'conversation_started':  // ✅ ADD THIS CASE
        console.log('🚀 [Frontend] Conversation started:', message.conversationId);
        break;
        
      case 'call_started':
        console.log('🚀 Call started:', message.conversationId);
        break;
        
      case 'stt_result':
        if (message.data?.results?.[0]?.alternatives?.[0]?.transcript) {
          const newTranscript = message.data.results[0].alternatives[0].transcript;
          setTranscript(newTranscript);
          onTranscript?.(newTranscript);
          
          // If final result, send to LLM
          if (message.data.results[0].isFinal) {
            sendToLLM(newTranscript);
          }
        }
        break;
        
      case 'ai_response':
        setAiResponse(message.text);
        onAIResponse?.(message.text);
        break;
        
      case 'audio_response':
        // Handle binary audio response
        if (message.audioLength) {
          // Audio data will come as separate binary message
          console.log('🎵 Audio response received, length:', message.audioLength);
        }
        break;
        
      case 'error':
        onError?.(message.error);
        break;
        
      default:
        console.log('📨 Unknown message type:', message.type);
    }
  };

  // Send transcript to LLM
  const sendToLLM = (text: string) => {
    if (!isConnected || !sessionIdRef.current) return;
    
    setIsProcessing(true);
    
    wsRef.current?.send(JSON.stringify({
      type: 'text_input',
      sessionId: sessionIdRef.current,
      text: text
    }));
  };

  // Update manual controls to match unmute.sh protocol
  const handleStartRecording = () => {
    if (!isConnected) {
      onError?.('Not connected to server');
      return;
    }
    
    if (!captureSupported) {
      onError?.('Audio capture not supported');
      return;
    }
    
    // Send start listening message (unmute.sh style)
    wsRef.current?.send(JSON.stringify({
      type: 'start_listening',
      sessionId: sessionIdRef.current
    }));
    
    startRecording();
  };

  const handleStopRecording = () => {
    // Send stop listening message (unmute.sh style)
    wsRef.current?.send(JSON.stringify({
      type: 'stop_listening',
      sessionId: sessionIdRef.current
    }));
    
    stopRecording();
  };

  const handleInterrupt = () => {
    if (!isConnected || !sessionIdRef.current) return;
    
    // Send interrupt message (unmute.sh style)
    wsRef.current?.send(JSON.stringify({
      type: 'interrupt',
      sessionId: sessionIdRef.current
    }));
    
    setIsProcessing(false);
  };

  // ✅ CRITICAL: Remove manual recording controls - let voice activity handle it
  return (
    <div className="max-w-md mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-center">�� Voice AI Interface</h2>
      
      {/* Connection Status */}
      <div className="mb-4 p-3 rounded-lg text-center">
        <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
          isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          <div className={`w-2 h-2 rounded-full mr-2 ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`}></div>
          {isConnected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {/* Voice Activity Indicator */}
      <div className="mb-4 p-4 bg-gray-50 rounded-lg text-center">
        <div className="text-lg font-medium mb-2">
          {isSpeaking ? '�� Speaking...' : '🔇 Silent'}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-100"
            style={{ width: `${Math.min(volume * 100, 100)}%` }}
          ></div>
        </div>
        <div className="text-sm text-gray-600 mt-2">
          {isRecording ? ' Recording...' : '⚪ Waiting for voice...'}
        </div>
      </div>

      {/* Interrupt Button */}
      {isProcessing && (
        <div className="mb-4 text-center">
          <button
            onClick={handleInterrupt}
            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium"
          >
            ⚡ Interrupt
          </button>
        </div>
      )}

      {/* Transcript Display */}
      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
        <h3 className="font-medium text-blue-900 mb-2"> What you said:</h3>
        <p className="text-blue-800 min-h-[2rem]">
          {transcript || 'Start speaking...'}
        </p>
      </div>

      {/* AI Response Display */}
      <div className="mb-4 p-4 bg-green-50 rounded-lg">
        <h3 className="font-medium text-green-900 mb-2">�� AI Response:</h3>
        <p className="text-green-800 min-h-[2rem]">
          {aiResponse || 'Waiting for response...'}
        </p>
      </div>

      {/* Audio Playback Status */}
      <div className="text-center text-sm text-gray-600">
        {isPlaying && '🔊 Playing AI response...'}
      </div>

      {/* Support Status */}
      <div className="mt-6 text-xs text-gray-500 text-center">
        <div>Audio Capture: {captureSupported ? '✅' : '❌'}</div>
        <div>Audio Playback: {playbackSupported ? '✅' : '❌'}</div>
        <div>Voice Activity: {isSpeaking ? '🎤' : '🔇'}</div>
      </div>
    </div>
  );
};
