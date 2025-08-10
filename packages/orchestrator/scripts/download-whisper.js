#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const MODELS_DIR = path.join(process.cwd(), 'models', 'whisper');

const MODELS = {
  'tiny.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    size: '39 MB'
  },
  'base.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    size: '74 MB'
  },
  'small.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    size: '244 MB'
  },
  'medium.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin',
    size: '769 MB'
  },
  'large.en': {
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large.en.bin',
    size: '1550 MB'
  }
};

function downloadFile(url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download: ${response.statusCode}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = ((downloadedSize / totalSize) * 100).toFixed(1);
        process.stdout.write(`\rDownloading... ${progress}%`);
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        process.stdout.write('\n');
        resolve();
      });
      
      file.on('error', (err) => {
        fs.unlink(filepath, () => {}); // Delete the file async
        reject(err);
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  try {
    console.log('🚀 Whisper Model Downloader');
    console.log('============================\n');
    
    // Create models directory
    if (!fs.existsSync(MODELS_DIR)) {
      fs.mkdirSync(MODELS_DIR, { recursive: true });
      console.log(`📁 Created models directory: ${MODELS_DIR}\n`);
    }
    
    // Show available models
    console.log('Available models:');
    Object.entries(MODELS).forEach(([name, info]) => {
      console.log(`  ${name.padEnd(12)} - ${info.size}`);
    });
    console.log('');
    
    // Download base.en model by default
    const modelName = 'base.en';
    const modelInfo = MODELS[modelName];
    const modelPath = path.join(MODELS_DIR, `${modelName}.bin`);
    
    if (fs.existsSync(modelPath)) {
      console.log(`✅ Model ${modelName} already exists at: ${modelPath}`);
      return;
    }
    
    console.log(`📥 Downloading ${modelName} model (${modelInfo.size})...`);
    console.log(`URL: ${modelInfo.url}`);
    console.log(`Destination: ${modelPath}\n`);
    
    await downloadFile(modelInfo.url, modelPath);
    
    console.log(`\n✅ Successfully downloaded ${modelName} model!`);
    console.log(`📁 Location: ${modelPath}`);
    console.log(`💾 Size: ${(fs.statSync(modelPath).size / 1024 / 1024).toFixed(1)} MB`);
    
    console.log('\n🎉 You can now use local Whisper ASR without API costs!');
    console.log('\nTo use different models, modify the WHISPER_MODEL environment variable:');
    console.log('  WHISPER_MODEL=small.en  # Better accuracy, slower speed');
    console.log('  WHISPER_MODEL=tiny.en   # Lower accuracy, fastest speed');
    
  } catch (error) {
    console.error('\n❌ Download failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { downloadFile, MODELS };
