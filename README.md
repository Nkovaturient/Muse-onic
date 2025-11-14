# Museonic

> **TL;DR: I was tired of Youtube Ads and Spotify Premium. Period.**

Museonic is a local-first, privacy-minded desktop assistant that turns spontaneous audio (a hum, a lyric, a muttered line) into immediate music playback. Built for speed and intuition: press a hotkey, sing, and the track plays — no subscription, no cloud lock-in, no momentum lost.

---

## Why Museonic Exists

People remember songs in the moment — a few notes or a phrase — and then lose the thread to friction: search, signup, or delay. Museonic removes that friction and restores the feeling-to-audio loop:

* **Instant**: capture and resolve audio in seconds.
* **Local-first**: core recognition and reasoning run on your device (Whisper, Ollama).
* **Composable**: workflows are orchestrated when needed (n8n) and can be extended.
* **Social**: optional P2P "Jam" mode for synchronous listening with peers via libp2p.
* **Privacy conscious**: user data stays local unless you choose otherwise.

---

## Quick Demo (What You Feel, in Three Steps)

1. Press `Cmd + M`.
2. Hum or say a lyric for 2–8 seconds.
3. Museonic transcribes, resolves a match, and plays the track locally.

   — If the answer is ambiguous, it asks a short clarifying question.
   
   — If you want to share or log, n8n automations can be triggered in the background.

---

## Architecture (Conceptual)

```
[User] ──(Cmd+M)──> Electron UI (React)

    └──> Recorder (node-record-lpcm16) ──> ./temp/audio.wav
         ├─> Microphone input (default)
         └─> System audio (BlackHole, optional)

                       └─> Whisper (local Python) ──> Transcript

                                      └─> Ollama (local LLM) ──> Intent & route

                                         ├─> Lyrics Search → YouTube/yt-dlp → Player (mpv)

                                         ├─> Melody Fingerprint → ACRCloud/n8n/YouTube fallback → Player

                                         └─> n8n webhook (logging, enrichment, automation)

                               Optional: js-libp2p (P2P Jam) ↔ peers (playback sync)
```

**Visual quick-start**: the app is Electron at the surface with a modular backend: `whisper` for STT, `ollama` for intent parsing, `n8n` for external automation, `mpv` for playback, and `libp2p` for peer discovery and sync. Supports both microphone and system audio capture.

---

## What's Inside the Repo (High Level)

```
museonic/
├─ main.js                 # Electron main process and IPC handlers
├─ preload.js              # Secure bridge between main and renderer
├─ renderer/               # React UI (floating mic, results, player controls)
│  ├─ src/
│  │  ├─ App.jsx          # Main application component
│  │  └─ components/
│  │     ├─ MicRecorder.jsx
│  │     ├─ PlayerControls.jsx
│  │     └─ ResultCard.jsx
│  └─ index.html
├─ backend/
│  ├─ recorder/           # Audio capture (mic/system via node-record-lpcm16)
│  │  ├─ mic.js           # Recording start/stop
│  │  └─ config.js        # Device detection & BlackHole support
│  ├─ whisper/            # Python wrapper for Whisper transcription
│  │  ├─ transcribe.js    # Node.js bridge
│  │  └─ transcribe.py    # Python Whisper execution
│  ├─ process/            # Main processing pipeline
│  │  └─ pipeline.js      # Orchestrates transcription → intent → search → playback
│  ├─ search/             # Lyrics & melody lookup
│  │  ├─ lyricsSearch.js  # YouTube/yt-dlp + n8n integration
│  │  └─ melodySearch.js  # Fingerprint matching (ACRCloud/n8n/fallback)
│  ├─ melody/             # Audio fingerprint extraction
│  │  ├─ extract.js
│  │  └─ extract.py
│  ├─ playback/           # mpv controller (play/stop/seek)
│  │  └─ player.js
│  ├─ network/            # P2P networking
│  │  └─ p2pNode.js       # js-libp2p manager for Jam mode
│  └─ utils/              # Shared utilities
│     ├─ config.js        # Configuration management
│     └─ logger.js        # Structured logging
├─ ollama/                # Local LLM integration
│  ├─ promptRouter.js     # Intent classification via Ollama
│  └─ modelConfig.json    # Model configuration
├─ n8n/                   # Automation hooks & sample workflows
│  ├─ workflowHooks.js    # Webhook triggers
│  └─ automationFlows.json
├─ python_env/            # Python dependencies & Whisper bootstrap
│  ├─ requirements.txt
│  └─ setup.sh
└─ package.json
```

---

<!-- ## Phase Summary (What Each Release Delivers)

### Phase 1 — MVP ✅
* Hotkey → mic/system recording → Whisper transcription → lyrics search → YouTube fetch → local playback.
* Fast, offline transcription where possible; network only for lookup.
* System audio capture support via BlackHole (macOS).

### Phase 2 — Ollama Intelligence ✅
* Intent detection (lyrics vs melody) via local Ollama model.
* Few-shot prompting to return strictly formatted JSON for reliable routing.
* Fallback to rule-based detection when Ollama is unavailable.

### Phase 3 — n8n Integration ✅
* Offload richer multi-step tasks to n8n: metadata enrichment, logging, remote notifications, playlist ops.
* Electron triggers n8n webhooks; n8n responds with results.

### Phase 4 — Melody Fingerprint ✅
* Audio embedding extraction and fingerprint matching (ACRCloud, n8n, or YouTube fallback).
* Improves match rate when lyrics are not present.
* Automatic fallback to YouTube search when specialized services unavailable.

### Phase 5 — UX Polish (Planned)
* Floating translucent UI, waveform visualizer, subtle 3-D mic animations, and smooth "Now Playing" overlay.

--- -->

## Installation (Developer Quick Start)

> Tested on macOS and Linux. Windows requires small path adjustments (mpv/ffmpeg, recording drivers).

### Prerequisites

* **Node.js** 18+ and npm
* **Python** 3.10+ (for local Whisper) and `ffmpeg`
* **mpv** installed and available in `PATH`
* **sox** or **rec** for audio recording (macOS: `brew install sox`)
* **yt-dlp** for YouTube search (recommended): `brew install yt-dlp`
* **(Optional)** Ollama running locally: `http://localhost:11434`
* **(Optional)** n8n instance for orchestration: `http://localhost:5678`
* **(Optional)** BlackHole for system audio capture: `brew install blackhole-2ch` (see [SYSTEM_AUDIO_SETUP.md](./SYSTEM_AUDIO_SETUP.md))

### Install

```bash
git clone https://github.com/your-org/museonic.git
cd museonic

# Node dependencies
npm install

# Python dependencies for Whisper
npm run setup-python

# Install audio tools (macOS)
brew install sox yt-dlp ffmpeg

# Optional: System audio capture (macOS)
brew install blackhole-2ch
# Then configure Multi-Output Device (see SYSTEM_AUDIO_SETUP.md)
```

### Run (Dev)

```bash
# Start the local Ollama instance if using Ollama
# (Download a model first: ollama pull llama2)

# Start n8n (optional) via docker-compose or local install
# docker run -it --rm --name n8n -p 5678:5678 n8nio/n8n

cd museonic
npm start
```

**Default hotkey**: `Cmd/Ctrl + M`. A floating mic UI will appear.

---

## Configuration & Environment

Create a `.env` file in the root directory:

### Configuration Options

* **`MUSEONIC_RECORDING_MODE`**: `mic` (default), `system` (requires BlackHole), or `auto` (auto-detect)
* **`MUSEONIC_WHISPER_MODEL`**: `tiny.en`, `base.en`, `small.en`, `medium.en` (English-only, faster) or `tiny`, `base`, `small`, `medium`, `large` (multilingual)
* **`MUSEONIC_OLLAMA_MODEL`**: model name (e.g., `llama3.2`, `mistral:7b`)
* **`MUSEONIC_SEARCH_PROVIDER`**: `youtube` (default, uses yt-dlp), `serpapi`, or `n8n`
* **`MUSEONIC_SEARCH_TIMEOUT`**: timeout in milliseconds (default: 45000)

**See also**: [SYSTEM_AUDIO_SETUP.md](./SYSTEM_AUDIO_SETUP.md) for system audio capture setup.

**Security note**: store private API keys via OS secure store (Keytar) rather than plaintext `.env`.

---

## How It Works — End-to-End (Expanded)

### 1. Recording
The Electron renderer triggers a node recorder via IPC. Audio is captured using `node-record-lpcm16` and saved to `./temp/audio.wav`. The recorder supports:
* **Microphone input** (default): captures user humming/singing
* **System audio** (optional): captures what's playing via BlackHole virtual device
* **Auto mode**: automatically detects and uses system audio if available

Recording mode is configurable via `MUSEONIC_RECORDING_MODE`. The recorder auto-detects available backends (sox, rec, arecord) and selects the best option for your platform.

### 2. Transcription
The main process spawns a Whisper process (Python) via `python-shell` to transcribe the audio. Whisper returns a transcript and confidence score. The Python script (`backend/whisper/transcribe.py`) handles model loading and inference.

### 3. Understanding
The transcript is sent to the local Ollama client (`ollama/promptRouter.js`) with a few-shot prompt. Ollama returns an intent JSON like:

```json
{
  "intent": "lyrics",
  "confidence": 0.82,
  "reason": "Recognized clear lyric phrases."
}
```

The intent can be `lyrics`, `melody`, or `unknown`. If confidence is below threshold (0.55) or transcript is empty, the system routes to melody fingerprinting.

### 4. Resolution

**Lyrics Path:**
* The app searches YouTube via `yt-dlp` (primary) or direct HTML parsing (fallback) (`backend/search/lyricsSearch.js`).
* `yt-dlp` extracts direct playable URLs and rich metadata.
* Results are ranked and the top match is selected.
* If n8n is enabled, it can enrich results with metadata or fetch playable URLs.

**Melody Path:**
* The audio is fingerprinted using `backend/melody/extract.py` (extracts mel-spectrogram embeddings).
* Fingerprints are matched via ACRCloud (if configured), n8n workflows, or YouTube fallback.
* The top result is resolved to a playable URL.
* Falls back to generic YouTube search if specialized services are unavailable.

### 5. Playback
The player controller (`backend/playback/player.js`) spawns an `mpv` process to stream/play the URL locally. The UI shows "Now Playing" and persists the match for quick replay or sharing.

### 6. Automation
Post-playback, Electron optionally posts to an n8n webhook (`n8n/workflowHooks.js`) with structured event data for background automations:
* Metadata enrichment
* Playlist addition
* Remote notifications
* Logging and analytics

### 7. Optional P2P Jam[upcoming]
The leader advertises a jam room via libp2p pubsub (`backend/network/p2pNode.js`). Peers join, fetch the same content, and sync playback with small drift corrections.

---

<!-- ## Developer Notes & Best Practices

* **Keep LLM outputs strict**: Ollama prompts are crafted to produce JSON only. If output cannot be parsed, the system falls back to `unknown` intent and requests clarification instead of executing commands.

* **Cache aggressively**: save known transcripts → URLs mapping to speed up replays. Consider implementing a local SQLite cache.

* **Graceful failures**: when transcription confidence is low, surface the raw audio + ask for re-record or manual typing rather than guessing.

* **Test across platforms**: audio capture and mpv options differ between macOS/Linux/Windows. Provide platform detection and adaptive options in `backend/recorder/config.js` and `backend/playback/player.js`.

* **IPC security**: the app uses `contextIsolation: true` and `preload.js` for secure communication between main and renderer processes. Never expose Node.js APIs directly to the renderer.

--- -->

## Security & Privacy

* **Default behavior is local-first**: Whisper and Ollama run locally, audio files remain on disk unless user opts in to upload or log events to external services.

* **Any external API use** (YouTube searches, fingerprint services) is opt-in; reveal these network calls in the UI preferences.

* **P2P mode must be explicitly enabled**; peers are discoverable only when user permits (mDNS on local network or explicit invite for global).

* **IPC isolation**: the renderer process cannot access Node.js APIs directly. All communication goes through the secure `preload.js` bridge.

* **Audio file cleanup**: temporary audio files in `./temp/` should be cleaned up after processing. Consider implementing automatic cleanup on app exit.

---

## Roadmap & Priorities

### Short Term
* Stabilize Phase 1: robust recording, fast Whisper, reliable YouTube fetch.
* Tighten Ollama few-shot prompts for better intent classification.
* Provide packaged installers (DMG for macOS, AppImage for Linux, NSIS for Windows).
* Implement audio file cleanup and cache management.

### Medium Term
* Add n8n sample workflows for common use cases (playlist management, metadata enrichment).
* Local embedding search with vector database (e.g., Chroma, Qdrant).
* Small public demo dataset for offline matching.
* Improve melody fingerprinting accuracy and speed.

### Long Term
* Fully offline melody embedding index with local vector search.
* Decentralized playlists (OrbitDB integration).
* Mobile companion app (React Native) for on-the-go capture.
* User profiles and cross-device sync (optional, encrypted).

---

## Contributing

If you want to help:

1. Fork the repo.
2. Create a branch named `feat/<describe>`.
3. Add tests where applicable (consider Jest for Node.js, Vitest for renderer).
4. Open PR with a clear description and a short demo GIF if UI changes.

We welcome work on:
* Audio preprocessing and robustness for low-quality recordings.
* Better fingerprinting algorithms and local embedding models.
* Packaging for Windows (NSIS installer, Windows audio backend).
* Documentation improvements and code comments.
* Performance optimizations (caching, parallel processing).

---

## Credits & Acknowledgements

* **Whisper** (OpenAI) — speech recognition backbone.
* **Ollama** — local LLM hosting and inference.
* **n8n** — workflow automation and orchestration.
* **libp2p** — decentralized peer-to-peer networking.
* **mpv** & **yt-dlp** — playback and media retrieval.
* **node-record-lpcm16** — cross-platform audio recording.
* **BlackHole** — virtual audio device for system audio capture (macOS).
* **Electron** — desktop application framework.
* **React** & **Vite** — modern UI development.

---


## Final Note — A Short Manifesto

> Muse: the best music moments are the ones left barely remembered — let the system find them for you when you need to hear them.

---

## Quick Reference

### Key Commands
```bash
npm start              # Start Electron app
npm run build:renderer # Build React frontend
npm run dev            # Run renderer in dev mode
npm run rebuild        # Rebuild native modules
npm run setup-python   # Setup Python environment
npm run transcribe     # Test transcription (requires sample.wav)
```
---

*Built with ❤️ for the moments between thought and song.*