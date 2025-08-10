#!/bin/bash

echo "�� Installing Chatterbox TTS..."

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python3 is not installed. Please install Python 3.11+ first."
    exit 1
fi

# Check Python version
PYTHON_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "🐍 Python version: $PYTHON_VERSION"

# Install Chatterbox TTS
echo "�� Installing chatterbox-tts package..."
python3 -m pip install chatterbox-tts

# Install additional dependencies that might be needed
echo "📦 Installing additional dependencies..."
python3 -m pip install torchaudio librosa

echo "✅ Chatterbox TTS installation complete!"
echo ""
echo "🎯 Next steps:"
echo "1. Update your .env file with Chatterbox configuration"
echo "2. Set TTS_PROVIDER=chatterbox"
echo "3. Configure CHATTERBOX_DEVICE, CHATTERBOX_EXAGGERATION, etc."
echo ""
echo "🔧 Test the installation:"
echo "python3 -c \"from chatterbox.tts import ChatterboxTTS; print('Chatterbox TTS imported successfully!')\""
