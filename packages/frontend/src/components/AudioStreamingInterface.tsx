import React, { useState, useRef, useEffect } from 'react';
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

  // Define functions BEFORE using them in hooks
  const handleAudioChunk = (audioChunk: Buffer) => {
    if (!isConnected || !sessionIdRef.current) return;
    
    // Send audio metadata first
    wsRef.current?.send(JSON.stringify({
      type: 'audio_input',
      sessionId: sessionIdRef.current,
      audioLength: audioChunk.length
    }));
    
    // Send binary audio data immediately after
    wsRef.current?.send(audioChunk);
  };

  const handleVoiceStart = () => {
    console.log('🎤 Voice detected - starting recording');
    if (!isRecording) {
      startRecording();
    }
  };

  const handleVoiceEnd = () => {
    console.log('🔇 Voice ended - stopping recording');
    if (isRecording) {
      stopRecording();
    }
  };

  // Now use the hooks with the defined functions
  const { isRecording, isSupported: captureSupported, startRecording, stopRecording } = useAudioCapture({
    onAudioChunk: handleAudioChunk,
    onStart: () => console.log('🎤 Recording started'),
    onStop: () => console.log('🛑 Recording stopped'),
    onError: (error) => onError?.(error.message)
  });

  const { isPlaying, isSupported: playbackSupported, playAudioChunk, stopPlayback } = useAudioPlayback({
    onStart: () => console.log('🔊 Playback started'),
    onStop: () => console.log('🛑 Playback stopped'),
    onError: (error) => onError?.(error.message)
  });

  const { isSpeaking, volume, startMonitoring, stopMonitoring } = useVoiceActivity({
    onVoiceStart: handleVoiceStart,
    onVoiceEnd: handleVoiceEnd
  });

  // WebSocket connection
  useEffect(() => {
    connectWebSocket();
    return () => disconnectWebSocket();
  }, []);

  // Update WebSocket connection to handle binary:
  const connectWebSocket = () => {
    try {
      const ws = new WebSocket('ws://localhost:3004');
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        setIsConnected(true);
        
        // Create session
        ws.send(JSON.stringify({
          type: 'start_conversation',
          brainId: 'default',
          userId: 'user-1'
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
    playAudioChunk(audioBuffer);
  };

  // Update message handling to match unmute.sh protocol
  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'conversation_started':
        sessionIdRef.current = message.conversationId;
        console.log('✅ Conversation started:', message.conversationId);
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
      </div>

      {/* Recording Controls */}
      <div className="mb-4 flex justify-center space-x-4">
        <button
          onClick={handleStartRecording}
          disabled={!isConnected || isRecording}
          className={`px-6 py-3 rounded-lg font-medium transition-colors ${
            isRecording 
              ? 'bg-red-500 text-white cursor-not-allowed' 
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          }`}
        >
          {isRecording ? '🔴 Recording...' : '�� Start Recording'}
        </button>
        
        <button
          onClick={handleStopRecording}
          disabled={!isRecording}
          className={`px-6 py-3 rounded-lg font-medium transition-colors ${
            !isRecording 
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
              : 'bg-red-500 hover:bg-red-600 text-white'
          }`}
        >
          🛑 Stop
        </button>
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
        <h3 className="font-medium text-blue-900 mb-2">�� What you said:</h3>
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
      </div>
    </div>
  );
};
