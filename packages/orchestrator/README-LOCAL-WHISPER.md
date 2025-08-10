# Local Whisper ASR Implementation

This implementation provides **completely free** speech-to-text functionality using OpenAI's Whisper model running locally on your machine.

## �� Benefits

- **�� ZERO API costs** - No more OpenAI API charges for STT
- **🔒 Privacy** - Audio stays on your machine
- **⚡ Low latency** - No network round-trips
- **�� Offline capability** - Works without internet connection
- **🎛️ Configurable** - Choose model size vs. accuracy trade-offs

## �� Quick Start

### 1. Install Dependencies

```bash
cd packages/orchestrator
npm install
```

### 2. Download Whisper Model

```bash
npm run download-whisper
```

This downloads the `base.en` model (~74 MB) which provides good accuracy and speed.

### 3. Configure Environment

```bash
cp env.example .env
```

Edit `.env` and set:
```env
STT_PROVIDER=local-whisper
WHISPER_MODEL=base.en
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=float32
WHISPER_NUM_THREADS=4
```

### 4. Start the Service

```bash
npm run dev
```

## �� Model Comparison

| Model | Size | Accuracy | Speed | Use Case |
|-------|------|----------|-------|----------|
| `tiny.en` | 39 MB | Low | Fastest | Real-time, basic accuracy |
| `base.en` | 74 MB | Medium | Fast | **Recommended default** |
| `small.en` | 244 MB | Good | Medium | Better accuracy, slower |
| `medium.en` | 769 MB | High | Slow | High accuracy, slower |
| `large.en` | 1550 MB | Highest | Slowest | Best accuracy, slowest |

## ⚙️ Configuration Options

### Environment Variables

```env
# STT Provider
STT_PROVIDER=local-whisper

# Whisper Model
WHISPER_MODEL=base.en

# Hardware Configuration
WHISPER_DEVICE=cpu          # 'cpu' or 'cuda' (if you have GPU)
WHISPER_COMPUTE_TYPE=float32 # 'float32', 'float16', or 'int8'
WHISPER_NUM_THREADS=4       # Number of CPU threads to use

# Fallback Configuration
STT_FALLBACK_TO_OPENAI=false # Set to 'true' to fallback to OpenAI API
```

### Performance Tuning

- **CPU Users**: Use `float32` for best accuracy, `int8` for speed
- **GPU Users**: Set `WHISPER_DEVICE=cuda` for significant speed boost
- **Threads**: Set to number of CPU cores for optimal performance

## 🔧 Troubleshooting

### Common Issues

1. **Model not found**
   ```bash
   npm run download-whisper
   ```

2. **Out of memory**
   - Use smaller model (e.g., `tiny.en` instead of `large.en`)
   - Reduce `WHISPER_NUM_THREADS`

3. **Slow performance**
   - Use smaller model
   - Enable GPU if available (`WHISPER_DEVICE=cuda`)
   - Use `int8` compute type

### Performance Monitoring

The service logs performance metrics:
```
