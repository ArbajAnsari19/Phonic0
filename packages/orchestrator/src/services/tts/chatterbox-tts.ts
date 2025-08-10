import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface ChatterboxConfig {
  pythonPath?: string;
  modelPath?: string;
  device?: string;
  voicePromptPath?: string;
  exaggeration?: number;
  cfgWeight?: number;
  timeout?: number;
}

export class ChatterboxTTS {
  private cfg: ChatterboxConfig;
  private tempDir: string;
  private isModelLoaded: boolean = false;
  
  constructor(cfg: ChatterboxConfig) {
    this.cfg = {
      pythonPath: 'python3',
      device: 'cpu',
      exaggeration: 0.5,
      cfgWeight: 0.5,
      timeout: 120000, // 2 minutes for first run, model loading
      ...cfg
    };
    
    // Ensure we use environment variables as defaults
    this.cfg.pythonPath = this.cfg.pythonPath || process.env.PYTHON_PATH || 'python3';
    this.cfg.device = this.cfg.device || process.env.CHATTERBOX_DEVICE || 'cpu';
    this.cfg.exaggeration = this.cfg.exaggeration || parseFloat(process.env.CHATTERBOX_EXAGGERATION || '0.5');
    this.cfg.cfgWeight = this.cfg.cfgWeight || parseFloat(process.env.CHATTERBOX_CFG_WEIGHT || '0.5');
    this.cfg.timeout = this.cfg.timeout || parseInt(process.env.CHATTERBOX_TIMEOUT || '120000');
    
    // Create temp directory for audio files
    this.tempDir = path.join(process.cwd(), 'temp_audio');
    this.ensureTempDir();
    
    console.log(`🎤 [ChatterboxTTS] Initialized with device: ${this.cfg.device}`);
    console.log(` [ChatterboxTTS] Exaggeration: ${this.cfg.exaggeration}, CFG Weight: ${this.cfg.cfgWeight}`);
    console.log(`⏱️ [ChatterboxTTS] Timeout: ${this.cfg.timeout}ms`);
  }

  private async ensureTempDir(): Promise<void> {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      console.warn(`⚠️ [ChatterboxTTS] Could not create temp directory: ${error}`);
    }
  }

  async synthesize(text: string, voicePromptPath?: string): Promise<Buffer> {
    try {
      console.log(`🎤 [ChatterboxTTS] Synthesizing text: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
      
      const outputFile = path.join(this.tempDir, `${uuidv4()}.wav`);
      const voicePrompt = voicePromptPath || this.cfg.voicePromptPath;
      
      // Create Python script for Chatterbox TTS
      const pythonScript = this.createPythonScript(text, outputFile, voicePrompt);
      const scriptPath = path.join(this.tempDir, `${uuidv4()}.py`);
      
      try {
        await fs.writeFile(scriptPath, pythonScript);
        
        console.log(`🎤 [ChatterboxTTS] Running Python script: ${scriptPath}`);
        console.log(`🎤 [ChatterboxTTS] Model loading status: ${this.isModelLoaded ? 'Already loaded' : 'First time - may take longer'}`);
        
        const result = await this.runPythonScript(scriptPath);
        
        if (result.success) {
          // Read the generated audio file
          const audioBuffer = await fs.readFile(outputFile);
          
          console.log(`✅ [ChatterboxTTS] Successfully generated audio, size: ${audioBuffer.length} bytes`);
          
          // Mark model as loaded for future runs
          this.isModelLoaded = true;
          
          // Clean up temporary files
          await this.cleanupTempFiles(scriptPath, outputFile);
          
          return audioBuffer;
        } else {
          throw new Error(`Chatterbox TTS failed: ${result.error}`);
        }
        
      } finally {
        // Clean up script file
        try {
          await fs.unlink(scriptPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
      
    } catch (error: any) {
      console.error(`❌ [ChatterboxTTS] Synthesis failed:`, {
        error: error.message,
        device: this.cfg.device,
        exaggeration: this.cfg.exaggeration,
        cfgWeight: this.cfg.cfgWeight,
        isModelLoaded: this.isModelLoaded
      });
      
      throw error;
    }
  }

  private createPythonScript(text: string, outputFile: string, voicePromptPath?: string): string {
    const escapedText = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
    const escapedOutput = outputFile.replace(/\\/g, '/');
    
    let script = `
import torchaudio as ta
import sys
import os
import warnings

# Suppress all warnings and deprecation messages
warnings.filterwarnings("ignore")
os.environ['PYTHONWARNINGS'] = 'ignore'

try:
    # Suppress specific library warnings
    import torch
    torch.set_warn_always(False)
    
    # Suppress diffusers warnings
    import diffusers
    diffusers.logging.set_verbosity_error()
    
    # Suppress transformers warnings
    import transformers
    transformers.logging.set_verbosity_error()
    
    # Suppress tqdm progress bars
    import tqdm
    tqdm.tqdm.monitor_interval = 0
    
    print("🔍 Checking if chatterbox is available...")
    from chatterbox.tts import ChatterboxTTS
    print("✅ Chatterbox TTS imported successfully")
    
    print(f" Initializing model on device: ${this.cfg.device}")
    # Initialize the model
    model = ChatterboxTTS.from_pretrained(device="${this.cfg.device}")
    print("✅ Model initialized successfully")
    
    # Generate audio
    text = "${escapedText}"
    print(f"📝 Generating audio for text: {text[:50]}...")
    
    wav = model.generate(
        text, 
        exaggeration=${this.cfg.exaggeration}, 
        cfg_weight=${this.cfg.cfgWeight}
    )
    print("✅ Audio generation completed")
    
    # Save the audio
    print(f"💾 Saving audio to: ${escapedOutput}")
    ta.save("${escapedOutput}", wav, model.sr)
    print("✅ Audio saved successfully")
    
    print("SUCCESS: Audio generated successfully")
    sys.exit(0)
    
except ImportError as e:
    print(f"ERROR: Import failed - {e}")
    print("💡 Try running: pip install chatterbox-tts")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: {str(e)}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
`;

    // Add voice prompt if provided
    if (voicePromptPath) {
      const escapedVoicePrompt = voicePromptPath.replace(/\\/g, '/');
      script = script.replace(
        'wav = model.generate(',
        `wav = model.generate(text, audio_prompt_path="${escapedVoicePrompt}",`
      );
    }
    
    return script;
  }

  private async runPythonScript(scriptPath: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const pythonProcess = spawn(this.cfg.pythonPath!, [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONWARNINGS: 'ignore' }
      });

      let stdout = '';
      let stderr = '';

      pythonProcess.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        
        // Only log important messages, filter out noise
        const lines = output.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && (
            trimmed.startsWith('🔍') || 
            trimmed.startsWith('✅') || 
            trimmed.startsWith('🚀') || 
            trimmed.startsWith('📝') || 
            trimmed.startsWith('💾') || 
            trimmed.startsWith('SUCCESS') || 
            trimmed.startsWith('ERROR')
          )) {
            console.log(` [Python] ${trimmed}`);
          }
        }
      });

      pythonProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        
        // Only log actual errors, not warnings or deprecation messages
        const lines = output.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && (
            !trimmed.includes('FutureWarning') &&
            !trimmed.includes('deprecated') &&
            !trimmed.includes('Sampling:') &&
            !trimmed.includes('LoRACompatibleLinear') &&
            !trimmed.includes('torch.backends.cuda.sdp_kernel') &&
            !trimmed.includes('LlamaSdpaAttention') &&
            !trimmed.includes('past_key_values')
          )) {
            console.error(`🐍 [Python Error] ${trimmed}`);
          }
        }
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          const errorMsg = stderr || stdout || `Process exited with code ${code}`;
          console.error(`❌ [ChatterboxTTS] Python script failed with code ${code}:`, errorMsg);
          resolve({ 
            success: false, 
            error: errorMsg
          });
        }
      });

      pythonProcess.on('error', (error) => {
        const errorMsg = `Failed to start Python process: ${error.message}`;
        console.error(`❌ [ChatterboxTTS] ${errorMsg}`);
        resolve({ 
          success: false, 
          error: errorMsg
        });
      });

      // Set a timeout - longer for first run
      const timeout = this.isModelLoaded ? 60000 : this.cfg.timeout; // 1 min if loaded, 2 min if first time
      console.log(`⏱️ [ChatterboxTTS] Setting timeout to ${timeout}ms`);
      
      setTimeout(() => {
        console.warn(`⚠️ [ChatterboxTTS] Killing Python process due to timeout (${timeout}ms)`);
        pythonProcess.kill();
        resolve({ 
          success: false, 
          error: `Python script execution timed out after ${timeout}ms. This might be due to model download on first run.`
        });
      }, timeout);
    });
  }

  private async cleanupTempFiles(...files: string[]): Promise<void> {
    for (const file of files) {
      try {
        await fs.unlink(file);
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  }

  // Method to test if Chatterbox is properly installed
  async testInstallation(): Promise<boolean> {
    try {
      console.log(`🧪 [ChatterboxTTS] Testing installation...`);
      
      const testScript = `
import sys
import warnings
warnings.filterwarnings("ignore")

try:
    from chatterbox.tts import ChatterboxTTS
    print("SUCCESS: Chatterbox TTS is properly installed")
    sys.exit(0)
except ImportError as e:
    print(f"ERROR: {e}")
    sys.exit(1)
`;
      
      const scriptPath = path.join(this.tempDir, `test_${uuidv4()}.py`);
      await fs.writeFile(scriptPath, testScript);
      
      const result = await this.runPythonScript(scriptPath);
      
      try {
        await fs.unlink(scriptPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      
      return result.success;
    } catch (error) {
      console.error(`❌ [ChatterboxTTS] Installation test failed:`, error);
      return false;
    }
  }
}
