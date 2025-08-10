import { useEffect, useRef, useState } from 'react';
import { MicRecorder, playBase64Wav, int16ToBase64 } from '../lib/audio';
import { brainApi } from '../lib/api';
import toast from 'react-hot-toast';

// Remove the duplicate int16ToBase64 function - it's now imported from audio.ts

// Fixed WebSocket URL function
function wsBaseUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname;
  const port = '3004'; // Orchestrator port
  return `${protocol}//${host}:${port}`;
}

export default function Calls() {
  const [brains, setBrains] = useState<any[]>([]);
  const [selectedBrain, setSelectedBrain] = useState<string>('');
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [conversationStarted, setConversationStarted] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [aiResponse, setAiResponse] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Add this ref to track recording state
  const isRecordingRef = useRef(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MicRecorder | null>(null);
  const audioChunksRef = useRef<Int16Array[]>([]);

  useEffect(() => {
    loadBrains();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const loadBrains = async () => {
    try {
      console.log('🔄 Loading brains...');
      const response = await brainApi.getAll();
      console.log('✅ Brains loaded:', response.data.brains);
      setBrains(response.data.brains);
    } catch (error) {
      console.error('❌ Failed to load brains:', error);
      toast.error('Failed to load AI brains');
    }
  };

  const startCall = async () => {
    if (!selectedBrain) {
      toast.error('Please select an AI Brain first');
      return;
    }

    try {
      console.log(' Starting call with brain:', selectedBrain);
      
      // Fix: Use the correct localStorage key for token
      const token = localStorage.getItem('phonic0_token');
      
      if (!token) {
        toast.error('Authentication token not found. Please login again.');
        return;
      }

      console.log('🔑 Token found, length:', token.length);

      // 1. Start WebSocket connection
      const wsUrl = `${wsBaseUrl()}?token=${token}`;
      console.log('🔌 Attempting WebSocket connection to:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected successfully');
        setIsConnected(true);
        
        // Don't send start_conversation here - wait for session_created
        toast.success('WebSocket connected!');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log(' Received WebSocket message:', message);
          
          switch (message.type) {
            case 'session_created':
              console.log('🎉 Session created successfully:', message.sessionId);
              
              // NOW send start_conversation after session is ready
              console.log('🧠 Sending start_conversation message...');
              const startMessage = {
                type: 'start_conversation',
                brainId: selectedBrain
              };
              ws.send(JSON.stringify(startMessage));
              
              setConversationStarted(true);
              toast.success('Call session started!');
              break;
              
            case 'conversation_started':
              console.log('🎉 Conversation started successfully');
              setConversationStarted(true);
              toast.success('Conversation started!');
              break;
              
            case 'listening_started':
              console.log('👂 AI is now listening...');
              break;
              
            case 'speech_recognized':
              console.log('🎤 Speech recognized:', message.transcript);
              setTranscript(message.transcript);
              break;
              
            case 'ai_response_generated':
              console.log('🤖 AI response generated:', message.response);
              setAiResponse(message.response);
              break;
              
            case 'speech_generated':
              console.log('🎵 Speech generated, playing audio...');
              // Play AI audio response
              if (message.audio) {
                playBase64Wav(message.audio);
              }
              setIsProcessing(false);
              break;
              
            case 'error':
              console.error('❌ Server error:', message.message);
              toast.error(message.message);
              setIsProcessing(false);
              break;
              
            default:
              console.log('❓ Unknown message type:', message.type, 'Full message:', message);
          }
        } catch (error) {
          console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        toast.error('Connection error occurred');
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        console.log('🔌 WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        setConversationStarted(false);
        setIsRecording(false);
        toast.error('Connection lost unexpectedly');
      };

    } catch (error) {
      console.error('❌ Failed to start call:', error);
      toast.error('Failed to start call');
    }
  };


const startRecording = () => {
  console.log('🎤 Starting recording...');
  
  if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
    toast.error('WebSocket not connected');
    return;
  }

  try {
    // 1. Tell backend to start listening
    console.log('📤 Sending start_listening message...');
    wsRef.current.send(JSON.stringify({
      type: 'start_listening'
    }));

    // 2. Create recorder and set callback FIRST
    recorderRef.current = new MicRecorder();
    
    // Set up chunk streaming callback BEFORE starting
    recorderRef.current.onAudioChunk = (chunk: Int16Array) => {
      console.log('🎯 [Calls] onAudioChunk callback triggered!', chunk.length, 'samples');
      // Use ref instead of state variable
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN && isRecordingRef.current) {
        const base64Chunk = int16ToBase64(chunk);
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          data: base64Chunk
        }));
        console.log('📡 Sent audio chunk:', chunk.length, 'samples');
      } else {
        console.warn('⚠️ [Calls] Cannot send audio chunk:', {
          wsReady: wsRef.current?.readyState === WebSocket.OPEN,
          isRecording: isRecordingRef.current,
          wsState: wsRef.current?.readyState
        });
      }
    };
    
    console.log('🔧 [Calls] Callback set:', !!recorderRef.current.onAudioChunk);
    
    // 3. Start recording AFTER setting callback
    recorderRef.current.start();
    setIsRecording(true);
    isRecordingRef.current = true; // Set ref
    audioChunksRef.current = [];
    
    console.log('✅ Recording started successfully');
    toast.success('Recording started - speak now!');
  } catch (error) {
    console.error('❌ Failed to start recording:', error);
    toast.error('Failed to start recording');
  }
};

  const stopRecording = () => {
    console.log('⏹️ Stopping recording...');
    
    if (!recorderRef.current || !isRecording) return;

    try {
      // 1. Stop local recording
      recorderRef.current.stop();
      setIsRecording(false);
      isRecordingRef.current = false; // Clear ref
      
      // 2. Tell backend to stop listening and process audio
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('📤 Sending stop_listening message...');
        wsRef.current.send(JSON.stringify({
          type: 'stop_listening'
        }));
        setIsProcessing(true);
      }
      
      console.log('✅ Recording stopped, processing...');
      toast.success('Processing your speech...');
    } catch (error) {
      console.error('❌ Failed to stop recording:', error);
      toast.error('Failed to stop recording');
    }
  };

  const endCall = () => {
    console.log(' Ending call...');
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'end_conversation'
      }));
    }
    
    if (wsRef.current) {
      wsRef.current.close();
    }
    
    setConversationStarted(false);
    setIsRecording(false);
    setIsConnected(false);
    setTranscript('');
    setAiResponse('');
    setIsProcessing(false);
    
    console.log('✅ Call ended successfully');
    toast.success('Call ended');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Call Logs</h1>
            <div className="flex items-center space-x-3">
              <div className={`w-3 h-3 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-600">
                {isConnected ? 'connected' : 'disconnected'}
              </span>
            </div>
          </div>

          {/* Brain Selection */}
          {!conversationStarted && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select AI Brain for Call
              </label>
              <select
                value={selectedBrain}
                onChange={(e) => setSelectedBrain(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-md"
              >
                <option key="default" value="">Choose a brain...</option>
                {brains.map((brain) => (
                  <option key={brain._id} value={brain._id}>
                    {brain.name}
                  </option>
                ))}
              </select>
              <button
                onClick={startCall}
                disabled={!selectedBrain || isConnected}
                className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                Start Call
              </button>
            </div>
          )}

          {/* Call Controls - Show when conversation is started */}
          {conversationStarted && (
            <div className="mb-6 p-4 bg-green-50 rounded-lg">
              <h3 className="text-lg font-semibold text-green-800 mb-4">Call in Progress</h3>
              <div className="flex items-center justify-center space-x-4">
                <button
                  onClick={startRecording}
                  disabled={isRecording || isProcessing}
                  className="px-6 py-3 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 flex items-center space-x-2"
                >
                  <span>🎤</span>
                  <span>{isRecording ? 'Recording...' : 'Start Recording'}</span>
                </button>
                
                {isRecording && (
                  <button
                    onClick={stopRecording}
                    className="px-6 py-3 bg-red-600 text-white rounded-full hover:bg-red-700"
                  >
                    Stop Recording
                  </button>
                )}
                
                <button
                  onClick={endCall}
                  className="px-6 py-3 bg-gray-600 text-white rounded-full hover:bg-gray-700"
                >
                  End Call
                </button>
              </div>
              
              {/* Status indicators */}
              <div className="mt-4 flex items-center justify-center space-x-6 text-sm">
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-red-500' : 'bg-gray-300'}`}></div>
                  <span>{isRecording ? 'Recording' : 'Not Recording'}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-500' : 'bg-gray-300'}`}></div>
                  <span>{isProcessing ? 'Processing...' : 'Ready'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Call History */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Call History</h2>
            <div className="bg-gray-100 p-4 rounded-lg min-h-[100px]">
              {!conversationStarted ? (
                <p className="text-gray-500">No conversations yet.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                    <div>
                      <p className="text-sm text-gray-600">Conversation started with selected brain</p>
                      <p className="text-xs text-gray-400">Ready to record</p>
                    </div>
                  </div>
                  
                  {transcript && (
                    <div className="flex items-start space-x-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm text-gray-600">You said:</p>
                        <p className="text-sm font-medium">{transcript}</p>
                      </div>
                    </div>
                  )}
                  
                  {aiResponse && (
                    <div className="flex items-start space-x-3">
                      <div className="w-2 h-2 bg-purple-500 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm text-gray-600">AI responded:</p>
                        <p className="text-sm font-medium">{aiResponse}</p>
                      </div>
                    </div>
                  )}
                  
                  {isProcessing && (
                    <div className="flex items-start space-x-3">
                      <div className="w-2 h-2 bg-yellow-500 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm text-gray-600">Processing...</p>
                        <p className="text-xs text-gray-400">AI is thinking and generating response</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Live Transcript */}
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Live Transcript</h2>
            <div className="bg-gray-100 p-4 rounded-lg min-h-[200px]">
              {!conversationStarted ? (
                <div className="flex items-center space-x-2 text-gray-500">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <span>Connecting to AI Brain...</span>
                </div>
              ) : !isRecording ? (
                <div className="flex items-center space-x-2 text-green-500">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Ready to record - click Start Recording</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 text-red-500">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></div>
                  <span>Recording... speak now!</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}