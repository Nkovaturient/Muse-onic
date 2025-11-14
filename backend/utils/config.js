const fs = require('fs');
const os = require('os');
const path = require('path');
const dotenv = require('dotenv');

let cachedConfig = null;

function loadEnv() {
  const projectRoot = path.resolve(__dirname, '../..');
  const envPath = path.join(projectRoot, '.env');

  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  } else {
    dotenv.config();
  }

  return projectRoot;
}

function ensureDirectorySync(targetPath) {
  if (!fs.existsSync(targetPath)) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
}

function getConfig() {
  if (cachedConfig) return cachedConfig;

  const projectRoot = loadEnv();
  const tmpRoot = path.join(os.tmpdir(), 'museonic');
  ensureDirectorySync(tmpRoot);

  const recordingDir =
    process.env.MUSEONIC_RECORD_DIR || path.join(tmpRoot, 'captures');
  ensureDirectorySync(recordingDir);

  const pythonBinary =
    process.env.MUSEONIC_PYTHON_BIN ||
    path.join(projectRoot, 'venv', 'bin', 'python3');

  const whisperScript =
    process.env.MUSEONIC_WHISPER_SCRIPT ||
    path.join(projectRoot, 'backend', 'whisper', 'transcribe.py');

  const melodyScript =
    process.env.MUSEONIC_MELODY_SCRIPT ||
    path.join(projectRoot, 'backend', 'melody', 'extract.py');

  const n8nBaseUrl =
    process.env.MUSEONIC_N8N_BASE_URL || 'http://localhost:5678';

  const ollamaBaseUrl =
    process.env.MUSEONIC_OLLAMA_BASE_URL || 'http://localhost:11434';

  cachedConfig = {
    projectRoot,
    recordingDir,
    recordingSampleRate: Number(process.env.MUSEONIC_SAMPLE_RATE) || 16000,
    recordingChannels: Number(process.env.MUSEONIC_CHANNELS) || 1,
    recordingThreshold: Number(process.env.MUSEONIC_RECORD_THRESHOLD) || 0,
    recordingMaxDuration: Number(process.env.MUSEONIC_MAX_RECORDING_DURATION) || 10000, // 10 seconds default
    recordingMode: process.env.MUSEONIC_RECORDING_MODE || 'auto', // 'mic', 'system', 'auto'
    pythonBinary,
    whisperScript,
    // Use base.en for English-only (better accuracy) or base for multilingual
    // Options: tiny.en, base.en, small.en, medium.en (English-only, faster/better)
    //         tiny, base, small, medium, large, turbo (multilingual)
    // turbo is fastest but English-only; small.en is good balance
    whisperModel: process.env.MUSEONIC_WHISPER_MODEL || 'base.en',
    whisperLanguage: process.env.MUSEONIC_WHISPER_LANG || undefined,
    melodyScript,
    melodySampleRate: Number(process.env.MUSEONIC_MELODY_SAMPLE_RATE) || 22050,
    melodyDuration: Number(process.env.MUSEONIC_MELODY_DURATION) || 8,
    mpvPath: process.env.MUSEONIC_MPV_PATH || 'mpv',
    vlcPath: process.env.MUSEONIC_VLC_PATH || 'vlc',
    n8nBaseUrl,
    n8nEnabled: process.env.MUSEONIC_N8N_ENABLED === 'true',
    n8nHooksToken: process.env.MUSEONIC_N8N_TOKEN || null,
    serpApiKey: process.env.SERPAPI_KEY || null,
    acrHost: process.env.MUSEONIC_ACR_HOST || null,
    acrAccessKey: process.env.MUSEONIC_ACR_ACCESS_KEY || null,
    acrAccessSecret: process.env.MUSEONIC_ACR_ACCESS_SECRET || null,
    ollamaBaseUrl,
    // Recommended models for intent classification:
    // - llama3.2 or llama3.2:latest (3.2B params, ~2GB, good balance)
    // - llama3.2:1b (1B params, ~1GB, fastest if available)
    // - mistral:7b (alternative, good performance)
    // Note: Use 'llama3.2' or 'llama3.2:latest' if you have the 3.2B model
    ollamaModel: process.env.MUSEONIC_OLLAMA_MODEL || 'llama3.2',
    logLevel: process.env.MUSEONIC_LOG_LEVEL || 'info',
    // Search configuration
    searchProvider: process.env.MUSEONIC_SEARCH_PROVIDER || 'youtube', // youtube, serpapi, n8n
    searchTimeout: Number(process.env.MUSEONIC_SEARCH_TIMEOUT) || 45000, // Increased for YouTube
    ytDlpPath: process.env.MUSEONIC_YTDLP_PATH || 'yt-dlp'
  };

  return cachedConfig;
}

module.exports = {
  getConfig,
  ensureDirectorySync
};

