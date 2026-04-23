const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const { getConfig, ensureDirectorySync } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('recorder:config');

function detectAvailableRecorder() {
  const platform = os.platform();
  const recorders = [];

  if (platform === 'darwin') {
    recorders.push('sox', 'rec');
  } else if (platform === 'linux') {
    recorders.push('arecord', 'sox', 'rec');
  } else if (platform === 'win32') {
    recorders.push('sox', 'rec');
  }

  for (const recorder of recorders) {
    try {
      execSync(`which ${recorder}`, { stdio: 'ignore' });
      logger.info(`Found recorder backend: ${recorder}`);
      return recorder;
    } catch (err) {
      continue;
    }
  }

  return null;
}

function getRecordingDirectory() {
  const { recordingDir } = getConfig();
  ensureDirectorySync(recordingDir);
  return recordingDir;
}

function createRecordingFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `museonic-${timestamp}.wav`;
}

function getRecordingFilePath() {
  return path.join(getRecordingDirectory(), createRecordingFileName());
}

function detectSystemAudioDevice() {
  const platform = os.platform();
  
  if (platform !== 'darwin') {
    return null; // System audio capture primarily supported on macOS
  }

  try {
    // Check for BlackHole (most common virtual audio device for macOS)
    const devices = execSync('system_profiler SPAudioDataType', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    
    // BlackHole devices
    if (devices.includes('BlackHole')) {
      // Try to find BlackHole device name
      const blackHoleMatch = devices.match(/BlackHole\s+\d+ch/i);
      if (blackHoleMatch) {
        logger.info('Found BlackHole device for system audio capture');
        return 'BlackHole';
      }
    }
    
    // Check for Soundflower (alternative)
    if (devices.includes('Soundflower')) {
      logger.info('Found Soundflower device for system audio capture');
      return 'Soundflower';
    }
    
    // Check for Multi-Output Device (macOS built-in)
    if (devices.includes('Multi-Output Device')) {
      logger.info('Found Multi-Output Device for system audio capture');
      return 'Multi-Output Device';
    }
  } catch (err) {
    logger.debug('Could not detect system audio devices', err.message);
  }
  
  return null;
}

function listAudioDevices() {
  const platform = os.platform();
  const devices = [];
  
  try {
    if (platform === 'darwin') {
      // Use sox to list devices
      try {
        const output = execSync('sox --help 2>&1 | grep -A 20 "Input File" || true', { encoding: 'utf8' });
        // For rec, we can use system_profiler
        const sysDevices = execSync('system_profiler SPAudioDataType 2>/dev/null || true', { encoding: 'utf8' });
        if (sysDevices) {
          const deviceMatches = sysDevices.match(/([^\n]+)/g) || [];
          deviceMatches.forEach(line => {
            if (line.includes('Device:') || line.includes('Output Device:')) {
              devices.push(line.trim());
            }
          });
        }
      } catch (err) {
        // Ignore
      }
    }
  } catch (err) {
    logger.debug('Could not list audio devices', err.message);
  }
  
  return devices;
}

function getRecordingOptions() {
  const config = getConfig();
  const platform = os.platform();
  let recorderBackend = process.env.MUSEONIC_RECORDER_BACKEND || detectAvailableRecorder();

  if (!recorderBackend) {
    let installCmd = '';
    if (platform === 'darwin') {
      installCmd = 'brew install sox';
    } else if (platform === 'linux') {
      installCmd = 'sudo apt-get install sox alsa-utils';
    } else if (platform === 'win32') {
      installCmd = 'choco install sox';
    }

    throw new Error(
      `No audio recorder backend found. Please install sox:\n` +
      `  ${installCmd}\n` +
      `Or set MUSEONIC_RECORDER_BACKEND environment variable.`
    );
  }

  // On macOS, prefer 'rec' over 'sox' as it's more reliable
  if (platform === 'darwin' && recorderBackend === 'sox') {
    try {
      execSync('which rec', { stdio: 'ignore' });
      recorderBackend = 'rec';
      logger.info('Using rec instead of sox on macOS for better compatibility');
    } catch (err) {
      // rec not available, stick with sox
    }
  }

  const options = {
    recorder: recorderBackend,
    sampleRate: config.recordingSampleRate,
    channels: config.recordingChannels,
    threshold: config.recordingThreshold,
    endOnSilence: false,
    audioType: 'wav',
    device: null // Let the recorder choose default device
  };

  const recordingMode = config.recordingMode || 'auto';
  const systemDevice = detectSystemAudioDevice();
  const useSystemCapture =
    recordingMode === 'system' ||
    (recordingMode === 'auto' && platform === 'darwin' && Boolean(systemDevice));

  if (recordingMode === 'system' && !systemDevice) {
    throw new Error(
      'System audio (MUSEONIC_RECORDING_MODE=system) needs a virtual loopback device (e.g. BlackHole on macOS). ' +
        'Install from https://existential.audio/blackhole/ and route output through it, or set MUSEONIC_RECORDING_MODE=mic to use the built-in microphone.'
    );
  }

  if (useSystemCapture && systemDevice) {
    if (systemDevice === 'BlackHole') {
      const blackHoleDevices = ['BlackHole 2ch', 'BlackHole 16ch', 'BlackHole'];
      for (const device of blackHoleDevices) {
        try {
          execSync(`sox --help 2>&1 | grep -i "${device}" || true`, { stdio: 'ignore' });
          options.device = device;
          logger.info(`Using system audio device: ${device}`);
          break;
        } catch (err) {
          continue;
        }
      }
      if (!options.device && recorderBackend === 'rec') {
        options.device = 'BlackHole 2ch';
        logger.info('Using BlackHole 2ch for system audio (via rec)');
      }
    }
  }

  // For mic mode or if system device not found, use default
  if (!options.device) {
    if (platform === 'darwin' && recorderBackend === 'sox') {
      options.device = 'default';
    } else if (platform === 'darwin' && recorderBackend === 'rec') {
      // rec uses device names, try to get default input
      options.device = null; // Let rec choose default
    }
  }

  logger.debug('Recording options', { 
    ...options, 
    device: options.device || 'default',
    mode: recordingMode 
  });
  return options;
}

module.exports = {
  getRecordingDirectory,
  getRecordingFilePath,
  getRecordingOptions,
  detectSystemAudioDevice,
  listAudioDevices
};

