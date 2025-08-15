import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useBrains } from '../hooks/useBrains';
import { Layout } from '../components/Layout';
import { Loading } from '../components/Loading';

interface CallSession {
  id: string;
  brainId: string;
  brainName: string;
  isActive: boolean;
  startTime: Date;
  transcript: string;
  aiResponse: string;
}

export const Calls: React.FC = () => {
  const { user } = useAuth();
  const token = localStorage.getItem('phonic0_token');
  const { data: brainsData, isLoading: brainsLoading } = useBrains();
  const brains = brainsData?.data.brains || [];
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);

  // Add session tracking
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // WebSocket connection
  useEffect(() => {
    if (token) {
      connectWebSocket();
    }
    return () => disconnectWebSocket();
  }, [token]);

  // ✅ CRITICAL: Add debugging to see when recording state changes
  useEffect(() => {
    console.log('🔄 [State] Recording state changed:', isRecording);
  }, [isRecording]);

  useEffect(() => {
    console.log('🔄 [State] Current session ID:', currentSessionId);
  }, [currentSessionId]);

  const connectWebSocket = () => {
    try {
      console.log(' [WS] Attempting to connect to:', `ws://localhost:3004?token=${token ? 'present' : 'missing'}`);
      
      const ws = new WebSocket(`ws://localhost:3004?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🔌 [WS] WebSocket connected successfully');
        setIsConnected(true);
        setError(null);
      };

      // Update WebSocket message handling
      ws.onmessage = (event) => {
        try {
          if (event.data instanceof ArrayBuffer) {
            // Handle binary audio from TTS
            handleBinaryAudio(event.data);
          } else {
            // Handle JSON messages
            const message = JSON.parse(event.data);
            handleWebSocketMessage(message);
          }
        } catch (error) {
          console.error('❌ [WS] Error handling message:', error);
        }
      };

      ws.onerror = (error) => {
        // ✅ CRITICAL: Better error logging
        console.error('❌ [WS] WebSocket error:', error);
        console.error('❌ [WS] Error details:', {
          error: error,
          type: error.type,
          target: error.target,
          readyState: ws.readyState
        });
        setError('WebSocket connection failed');
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        console.log('🔌 [WS] WebSocket disconnected:', {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean
        });
        setIsConnected(false);
      };

    } catch (error) {
      console.error('❌ [WS] Failed to create WebSocket:', error);
      setError('Failed to create WebSocket connection');
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
    try {
      // Convert ArrayBuffer to AudioBuffer and play
      const audioContext = new AudioContext();
      audioContext.decodeAudioData(audioData).then((audioBuffer) => {
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioContext.destination);
        source.start();
      });
    } catch (error) {
      console.error('❌ Error playing audio:', error);
    }
  };

  // Handle WebSocket messages
  const handleWebSocketMessage = (message: any) => {
    // 🆕 ADD THIS: Log ALL messages for debugging
    console.log('📨 [WS] Received message:', message);
    
    switch (message.type) {
      case 'session_created':
        // ✅ CRITICAL: Set the session ID when received
        setCurrentSessionId(message.sessionId);
        console.log('✅ Session created:', message.sessionId);
        break;
        
      case 'conversation_started':
        console.log('✅ Conversation started:', message.conversationId);
        break;
        
      case 'stt_result':
        // 🆕 ENHANCED STT logging
        console.log('🎤 [STT] Result received:', message);
        if (message.data?.results?.[0]?.alternatives?.[0]?.transcript) {
          const transcript = message.data.results[0].alternatives[0].transcript;
          const isFinal = message.data.results[0].isFinal;
          console.log(`📝 [STT] Transcript: "${transcript}" (${isFinal ? 'FINAL' : 'PARTIAL'})`);
          
          setActiveCall(prev => prev ? { ...prev, transcript } : null);
          
          if (isFinal) {
            console.log('🚀 [STT] Sending final transcript to LLM');
            sendToLLM(transcript);
          }
        }
        break;
        
      case 'ai_response':
        console.log('🤖 [AI] Response received:', message.text);
        setActiveCall(prev => prev ? { ...prev, aiResponse: message.text } : null);
        break;
        
      case 'error':
        console.error('❌ [Error] Server error:', message.error);
        setError(message.error);
        break;
        
      default:
        console.log('❓ [WS] Unknown message type:', message.type, message);
    }
  };

  // Start a call
  const startCall = async (brainId: string, brainName: string) => {
    console.log('🚀 [Call] Starting call with brain:', { brainId, brainName });
    
    if (!isConnected || !wsRef.current) {
      console.error('❌ [Call] Not connected to server');
      setError('Not connected to server');
      return;
    }

    try {
      console.log('📡 [Call] Sending start_conversation message');
      
      // Start conversation
      wsRef.current.send(JSON.stringify({
        type: 'start_conversation',
        brainId: brainId
      }));

      console.log('🎤 [Call] Starting audio recording...');
      
      // ✅ CRITICAL: Wait for session ID before starting recording
      let sessionId = currentSessionId;
      if (!sessionId) {
        console.log('⏳ [Call] Waiting for session ID...');
        let attempts = 0;
        while (!sessionId && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          sessionId = currentSessionId;
          attempts++;
        }
        
        if (!sessionId) {
          throw new Error('Session ID not available');
        }
      }
      
      // Start audio recording with session ID
      await startRecording(sessionId);
      
      console.log('📱 [Call] Setting active call state');
      
      setActiveCall({
        id: Date.now().toString(),
        brainId,
        brainName,
        isActive: true,
        startTime: new Date(),
        transcript: '',
        aiResponse: ''
      });

      console.log('✅ [Call] Call started successfully');

    } catch (error) {
      console.error('❌ [Call] Error starting call:', error);
      setError('Failed to start call');
    }
  };

  // End a call
  const endCall = () => {
    if (activeCall && wsRef.current) {
      // End conversation (unmute.sh style)
      wsRef.current.send(JSON.stringify({
        type: 'end_conversation',
        reason: 'User ended call'
      }));
      
      stopRecording();
      setActiveCall(null);
    }
  };

  // ✅ CRITICAL: Create audio callback with proper dependencies
  const createAudioCallback = useCallback((sessionId: string) => {
    return (event: AudioProcessingEvent) => {
      const currentWs = wsRef.current;
      
      if (!currentWs || !sessionId) {
        console.log('⚠️ [Audio] Skipping audio processing:', {
          wsReady: currentWs?.readyState === WebSocket.OPEN,
          sessionId: sessionId
        });
        return;
      }
      
      const inputBuffer = event.inputBuffer;
      const inputData = inputBuffer.getChannelData(0);
      
      console.log(` [Audio] Processing ${inputData.length} audio samples`);
      
      // Convert float32 to int16 (16-bit PCM)
      const pcmBuffer = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        pcmBuffer[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
      }
      
      // Convert to Buffer and send binary
      const audioChunk = Buffer.from(pcmBuffer.buffer);
      
      console.log(` [Audio] Sending ${audioChunk.length} bytes to server, session: ${sessionId}`);
      
      // ✅ CRITICAL: Send ONLY binary audio data, NO metadata
      currentWs.send(audioChunk);
      
      console.log('✅ [Audio] Audio chunk sent successfully');
    };
  }, []);

  // Start recording with session ID
  const startRecording = async (sessionId: string) => {
    try {
      console.log('🎤 [Recording] Starting audio recording with session:', sessionId);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      console.log('✅ [Recording] Microphone access granted');
      streamRef.current = stream;
      
      // Create audio context for real-time processing
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      console.log('🔧 [Recording] Audio context created');
      
      // Create audio source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create script processor for real-time audio chunks
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;
      
      console.log('⚙️ [Recording] Audio processor created');
      
      // ✅ CRITICAL: Set recording state FIRST before setting up the callback
      setIsRecording(true);
      
      console.log('🎯 [Recording] Setting up audio callback with session:', sessionId);
      
      // Process audio chunks in real-time
      processor.onaudioprocess = (event) => {
        const currentWs = wsRef.current;
        
        if (!currentWs || !sessionId) {
          console.log('⚠️ [Audio] Skipping audio processing:', {
            wsReady: currentWs?.readyState === WebSocket.OPEN,
            sessionId: sessionId
          });
          return;
        }
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        console.log(` [Audio] Processing ${inputData.length} audio samples`);
        
        // Convert float32 to int16 (16-bit PCM)
        const pcmBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmBuffer[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        
        // Convert to Buffer and send binary
        const audioChunk = Buffer.from(pcmBuffer.buffer);
        
        console.log(` [Audio] Sending ${audioChunk.length} bytes to server, session: ${sessionId}`);
        
        // ✅ CRITICAL: Send ONLY binary audio data, NO metadata
        currentWs.send(audioChunk);
        
        console.log('✅ [Audio] Audio chunk sent successfully');
      };
      
      // Connect audio nodes
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      console.log('🎉 [Recording] Recording started successfully');
      
    } catch (error) {
      console.error('❌ [Recording] Failed to start recording:', error);
      setError('Failed to start recording');
    }
  };

  // ✅ CRITICAL: Add debugging to see when stopRecording is called
  const stopRecording = () => {
    console.log('🛑 [Recording] stopRecording called - checking why...');
    console.trace('🛑 [Recording] Stack trace for stopRecording');
    
    try {
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
      console.log('🛑 [Recording] Recording stopped');
      
    } catch (error) {
      console.error('❌ [Recording] Error stopping recording:', error);
    }
  };

  // Send transcript to LLM
  const sendToLLM = (text: string) => {
    if (!isConnected || !wsRef.current) return;
    
    wsRef.current.send(JSON.stringify({
      type: 'text_input',
      text: text
    }));
  };

  // Interrupt current processing
  const interrupt = () => {
    if (activeCall && wsRef.current) {
      wsRef.current.send(JSON.stringify({
        type: 'interrupt'
      }));
    }
  };

  const testAudioCapture = async () => {
    try {
      console.log('🧪 [Test] Testing audio capture...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('✅ [Test] Audio stream obtained:', stream);
      
      // Test if we can get audio data
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      
      processor.onaudioprocess = (event) => {
        const inputData = event.inputBuffer.getChannelData(0);
        console.log('🎵 [Test] Audio data received:', inputData.length, 'samples');
        console.log('🎵 [Test] Sample values:', inputData.slice(0, 5));
      };
      
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      // Stop after 3 seconds
      setTimeout(() => {
        processor.disconnect();
        source.disconnect();
        stream.getTracks().forEach(track => track.stop());
        console.log('🧪 [Test] Audio test completed');
      }, 3000);
      
    } catch (error) {
      console.error('❌ [Test] Audio test failed:', error);
    }
  };

  if (brainsLoading) {
    return <Loading />;
  }

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-8">📞 AI Calls</h1>
        
        {/* Connection Status */}
        <div className="mb-6 p-4 rounded-lg text-center">
          <div className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium ${
            isConnected ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            <div className={`w-3 h-3 rounded-full mr-2 ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}></div>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
            ❌ {error}
          </div>
        )}

        {/* Active Call */}
        {activeCall && (
          <div className="mb-6 p-6 bg-blue-50 rounded-lg">
            <h2 className="text-xl font-semibold mb-4">
               Active Call with {activeCall.brainName}
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="p-4 bg-white rounded-lg">
                <h3 className="font-medium text-blue-900 mb-2"> What you said:</h3>
                <p className="text-blue-800 min-h-[4rem]">
                  {activeCall.transcript || 'Start speaking...'}
                </p>
              </div>
              
              <div className="p-4 bg-white rounded-lg">
                <h3 className="font-medium text-green-900 mb-2"> AI Response:</h3>
                <p className="text-green-800 min-h-[4rem]">
                  {activeCall.aiResponse || 'Waiting for response...'}
                </p>
              </div>
            </div>
            
            <div className="flex justify-center space-x-4">
              <button
                onClick={interrupt}
                className="px-6 py-3 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg font-medium"
              >
                ⚡ Interrupt
              </button>
              
              <button
                onClick={endCall}
                className="px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium"
              >
                🛑 End Call
              </button>
            </div>
          </div>
        )}

        {/* Available Brains */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {brains.map((brain: any, index: number) => (
            <div 
              key={brain.id || `brain-${index}`} 
              className="p-6 bg-white rounded-lg shadow-lg border"
            >
              <h3 className="text-xl font-semibold mb-2">{brain.name}</h3>
              <p className="text-gray-600 mb-4 line-clamp-3">
                {brain.description || 'No description available'}
              </p>
              
              {activeCall ? (
                <button
                  disabled
                  className="w-full px-4 py-2 bg-gray-300 text-gray-500 rounded-lg cursor-not-allowed"
                >
                  📞 Call in Progress
                </button>
              ) : (
                <button
                  onClick={() => startCall(brain.id, brain.name)}
                  disabled={!isConnected}
                  className={`w-full px-4 py-2 rounded-lg font-medium transition-colors ${
                    isConnected
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  📞 Start Call
                </button>
              )}
            </div>
          ))}
        </div>

        {/* No Brains Message */}
        {brains.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-lg">
              No AI brains available. Please create one first.
            </p>
          </div>
        )}

        <button 
          onClick={testAudioCapture}
          className="px-4 py-2 bg-yellow-500 text-white rounded-lg mb-4"
        >
          🧪 Test Audio Capture
        </button>
      </div>
    </Layout>
  );
};