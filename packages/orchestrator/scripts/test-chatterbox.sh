#!/bin/bash

echo "�� Testing Chatterbox TTS installation..."

# Test Python import
echo "🔍 Testing Python import..."
python3 -c "from chatterbox.tts import ChatterboxTTS; print('✅ Chatterbox TTS imported successfully')" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Chatterbox TTS is properly installed"
    
    # Test model loading (this will download the model on first run)
    echo "🚀 Testing model initialization (this may take a few minutes on first run)..."
    python3 -c "
import torchaudio as ta
from chatterbox.tts import ChatterboxTTS
import sys

try:
    print('Initializing model...')
    model = ChatterboxTTS.from_pretrained(device='cpu')
    print('✅ Model initialized successfully')
    
    print('Testing text generation...')
    text = 'Hello, this is a test.'
    wav = model.generate(text, exaggeration=0.5, cfg_weight=0.5)
    print('✅ Audio generation successful')
    print(f'Generated audio shape: {wav.shape}')
    print(f'Sample rate: {model.sr}')
    
    print('SUCCESS: All tests passed!')
    sys.exit(0)
except Exception as e:
    print(f'❌ Test failed: {e}')
    import traceback
    traceback.print_exc()
    sys.exit(1)
"
    
    if [ $? -eq 0 ]; then
        echo "🎉 All tests passed! Chatterbox TTS is working correctly."
    else
        echo "❌ Model test failed. Check the error above."
    fi
else
    echo "❌ Chatterbox TTS is not properly installed"
    echo "💡 Try running: npm run install-chatterbox"
    exit 1
fi
