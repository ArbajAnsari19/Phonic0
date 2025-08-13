import React, { useState, useRef, useEffect } from 'react';
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

  // WebSocket connection
  useEffect(() => {
    if (token) {
      connectWebSocket();
    }
    return () => disconnectWebSocket();
  }, [token]);

  const connectWebSocket = () => {
    try {
      const ws = new WebSocket(`ws://localhost:3004?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        setIsConnected(true);
        setError(null);
      };

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Handle binary audio from TTS
          handleBinaryAudio(event.data);
        } else {
          // Handle JSON messages
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setError('WebSocket connection failed');
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket disconnected');
        setIsConnected(false);
      };

    } catch (error) {
      console.error('❌ Failed to connect WebSocket:', error);
      setError('Failed to connect to server');
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
    switch (message.type) {
      case 'conversation_started':
        console.log('✅ Conversation started:', message.conversationId);
        break;
        
      case 'stt_result':
        if (message.data?.results?.[0]?.alternatives?.[0]?.transcript) {
          const transcript = message.data.results[0].alternatives[0].transcript;
          setActiveCall(prev => prev ? { ...prev, transcript } : null);
          
          // If final result, send to LLM
          if (message.data.results[0].isFinal) {
            sendToLLM(transcript);
          }
        }
        break;
        
      case 'ai_response':
        setActiveCall(prev => prev ? { ...prev, aiResponse: message.text } : null);
        break;
        
      case 'error':
        setError(message.error);
        break;
        
      default:
        console.log('📨 Unknown message type:', message.type);
    }
  };

  // Start a call
  const startCall = async (brainId: string, brainName: string) => {
    if (!isConnected || !wsRef.current) {
      setError('Not connected to server');
      return;
    }

    try {
      // Start conversation (unmute.sh style)
      wsRef.current.send(JSON.stringify({
        type: 'start_conversation',
        brainId: brainId
      }));

      // Start audio recording
      await startRecording();
      
      setActiveCall({
        id: Date.now().toString(),
        brainId,
        brainName,
        isActive: true,
        startTime: new Date(),
        transcript: '',
        aiResponse: ''
      });

    } catch (error) {
      console.error('❌ Error starting call:', error);
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

  // Start recording
  const startRecording = async () => {
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

      streamRef.current = stream;
      
      // Create audio context for real-time processing
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      // Create audio source from microphone
      const source = audioContext.createMediaStreamSource(stream);
      
      // Create script processor for real-time audio chunks
      const processor = audioContext.createScriptProcessor(1024, 1, 1);
      processorRef.current = processor;
      
      // Process audio chunks in real-time
      processor.onaudioprocess = (event) => {
        if (!isRecording || !wsRef.current) return;
        
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);
        
        // Convert float32 to int16 (16-bit PCM)
        const pcmBuffer = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          pcmBuffer[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
        }
        
        // Convert to Buffer and send binary (unmute.sh style)
        const audioChunk = Buffer.from(pcmBuffer.buffer);
        
        // Send audio metadata first
        wsRef.current.send(JSON.stringify({
          type: 'audio_input',
          audioLength: audioChunk.length
        }));
        
        // Send binary audio data immediately after
        wsRef.current.send(audioChunk);
      };
      
      // Connect audio nodes
      source.connect(processor);
      processor.connect(audioContext.destination);
      
      setIsRecording(true);
      console.log('🎤 Recording started');
      
    } catch (error) {
      console.error('❌ Failed to start recording:', error);
      setError('Failed to start recording');
    }
  };

  // Stop recording
  const stopRecording = () => {
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
      console.log('🛑 Recording stopped');
      
    } catch (error) {
      console.error('❌ Error stopping recording:', error);
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
          {brains.map((brain:any) => (
            <div key={brain.id} className="p-6 bg-white rounded-lg shadow-lg border">
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
      </div>
    </Layout>
  );
};