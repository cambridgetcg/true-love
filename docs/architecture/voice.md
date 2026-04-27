# Voice — On-Device Text-to-Speech

Love can speak. This document describes the voice subsystem: provider abstraction,
synthesis pipeline, and integration with the /visit UI.

## Architecture

```
text ─→ synthesize() ─→ provider selection ─→ say / mlx ─→ WAV buffer
                              │
                         status cache
                        (5 min TTL)
```

### Provider contract

```typescript
interface VoiceProvider {
  id: string
  label: string
  synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesisResult>
  status(): Promise<VoiceProviderStatus>
}
```

Every provider returns a `SynthesisResult` with:
- `audio: Buffer` — complete WAV file (16-bit PCM, mono)
- `mimeType: 'audio/wav'`
- `durationSecs` — estimated from WAV header
- `providerId` — which provider synthesized
- `latencyMs` — wall-clock time

### Providers

| Provider | Binary | Quality | Latency | Setup |
|----------|--------|---------|---------|-------|
| **say** | `/usr/bin/say` | Good (Siri-era neural) | ~1-2s | Built into macOS |
| **mlx** | `openclaw-mlx-tts` | Higher (Soprano 80M) | ~2-5s first, ~1s cached | Build from openclaw |

**say** is the default fallback — always available on macOS, no setup needed.

**mlx** is the preferred provider when available — neural TTS via Apple's MLX
framework on Apple Silicon. Requires building the binary (see Setup below).

### Provider selection

1. Try the preferred provider (config: `preferredProvider`, default: `'mlx'`)
2. If unavailable, try each registered provider in order
3. If none available, throw

Status is cached for 5 minutes per provider (binaries don't appear/disappear mid-session).

## Setup

### macOS Say (zero setup)

Already installed on every Mac. Voices can be downloaded in System Settings →
Accessibility → Spoken Content → System Voice → Manage Voices.

Recommended: download the enhanced "Samantha" voice for better quality.

### MLX TTS (higher quality)

Build the binary from the openclaw repository:

```bash
cd ~/Desktop/openclaw/apps/macos-mlx-tts
swift build -c release
cp .build/release/openclaw-mlx-tts /usr/local/bin/
```

Requirements:
- macOS 15+
- Apple Silicon (M1/M2/M3/M4)
- Swift 6.1+
- ~500MB disk for the Soprano-80M model (downloaded on first use)

Verify: `openclaw-mlx-tts --text "hello" --output /tmp/test.wav`

## API

### POST /api/voice/synthesize

Synthesize text to speech.

**Request:**
```json
{ "text": "Hello, Yu.", "voiceId": "Samantha", "rate": 1.0 }
```

**Response:** Raw WAV audio (`audio/wav`), with headers:
- `X-Voice-Provider`: which provider synthesized (e.g. `say`)
- `X-Voice-Duration`: audio duration in seconds
- `X-Voice-Latency`: synthesis latency in ms

### GET /api/voice/status

Provider availability.

**Response:**
```json
{
  "available": true,
  "providers": {
    "mlx": { "id": "mlx", "label": "MLX TTS (on-device)", "available": false, "reason": "..." },
    "say": { "id": "say", "label": "macOS Say", "available": true }
  }
}
```

## /visit Integration

Love's messages in the /visit chat UI show a 🔊 button. Clicking it:

1. Sends `POST /api/voice/synthesize` with the message text
2. Creates an `<audio>` element with the returned WAV blob
3. Plays the audio
4. Button state: 🔊 (idle) → ⏳ (synthesizing) → 🔈 (playing) → 🔊 (done)

Clicking during playback stops the current audio. Only one message plays at a time.

## Voice configuration

```typescript
interface VoiceConfig {
  preferredProvider?: string    // 'mlx' | 'say'
  defaultVoiceId?: string       // e.g. 'Samantha'
  defaultLanguage?: string      // e.g. 'en-US'
  enabled: boolean              // master switch
  mode: 'always' | 'when-asked' | 'never'
}
```

Current defaults:
- `preferredProvider: 'mlx'` (falls back to `say`)
- `defaultVoiceId: 'Samantha'`
- `enabled: true`
- `mode: 'when-asked'` (voice button visible but not auto-playing)

## Files

```
src/services/love/voice/
  types.ts          — VoiceProvider interface, VoiceConfig, WAV duration
  say-provider.ts   — macOS say → AIFF → afconvert → WAV
  mlx-provider.ts   — openclaw-mlx-tts binary wrapper
  synthesize.ts     — orchestrator (provider selection, caching, fallback)
  index.ts          — public API
```

## Future

- **Auto-voice mode** (`mode: 'always'`): automatically synthesize voice for every Love reply
- **ElevenLabs provider**: cloud fallback for non-macOS or higher-fidelity voice
- **Voice in Telegram**: send voice notes through the Telegram channel
- **Voice streaming**: progressive playback while synthesis is still running
- **Voice identity**: a custom fine-tuned voice model that sounds like Love
