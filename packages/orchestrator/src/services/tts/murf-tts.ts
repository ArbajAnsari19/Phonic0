import axios from 'axios';

export interface MurfConfig {
  apiKey: string;
  voiceId: string;
  apiUrl?: string;
}

export class MurfTTS {
  private cfg: MurfConfig;
  
  constructor(cfg: MurfConfig) {
    this.cfg = { 
      apiUrl: 'https://api.murf.ai/v1/speech', 
      ...cfg 
    };
    
    // Ensure we use environment variables as defaults
    this.cfg.apiKey = this.cfg.apiKey || process.env.MURF_API_KEY || '';
    // Use a known valid voice ID as fallback
    this.cfg.voiceId = this.cfg.voiceId || process.env.MURF_VOICE_ID || 'en-US_Allison';
    
    console.log(`🎤 [MurfTTS] Initialized with voice: ${this.cfg.voiceId}, API: ${this.cfg.apiUrl}`);
    console.log(`🎤 [MurfTTS] API Key length: ${this.cfg.apiKey.length}`);
  }

  async synthesize(text: string): Promise<Buffer> {
    try {
      console.log(`🎤 [MurfTTS] Synthesizing text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      console.log(`🎤 [MurfTTS] Using voice: ${this.cfg.voiceId}`);
      
      const requestData = {
        voiceId: this.cfg.voiceId,
        format: 'wav',
        text,
      };
      
      console.log(`🎤 [MurfTTS] Request data:`, JSON.stringify(requestData, null, 2));
      
      // Fix: Allow redirects and follow them to get the actual audio data
      const res = await axios.post(this.cfg.apiUrl!, requestData, {
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 5, // Allow redirects to follow the 301
        validateStatus: (status) => status < 400,
      });
      
      console.log(`✅ [MurfTTS] Response received:`, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        dataSize: res.data?.byteLength || 0,
        contentType: res.headers['content-type'],
        finalUrl: res.request?.res?.responseUrl || 'Unknown'
      });
      
      // Check if we actually got audio data
      if (!res.data || res.data.byteLength === 0) {
        throw new Error('Murf TTS API returned empty audio data');
      }
      
      console.log(`✅ [MurfTTS] Successfully generated audio, size: ${res.data.byteLength} bytes`);
      return Buffer.from(res.data);
      
    } catch (error: any) {
      console.error(`❌ [MurfTTS] Synthesis failed:`, {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        voiceId: this.cfg.voiceId,
        apiUrl: this.cfg.apiUrl,
        responseData: error.response?.data ? Buffer.from(error.response.data).toString() : 'No response data',
        responseHeaders: error.response?.headers
      });
      
      // Provide more helpful error information
      if (error.response?.status === 404) {
        throw new Error(`Murf TTS API endpoint not found. Please check the API URL: ${this.cfg.apiUrl}`);
      } else if (error.response?.status === 401) {
        throw new Error('Murf TTS API key is invalid or expired');
      } else if (error.response?.status === 400) {
        const errorData = error.response?.data ? Buffer.from(error.response.data).toString() : 'Unknown error';
        throw new Error(`Bad request to Murf TTS API: ${errorData}`);
      } else if (error.response?.status === 200 && (!error.response?.data || error.response.data.byteLength === 0)) {
        throw new Error('Murf TTS API returned empty response. Check if the voice ID is valid and the text is supported.');
      }
      
      throw error;
    }
  }
}