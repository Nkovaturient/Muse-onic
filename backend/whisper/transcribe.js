const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const { getConfig } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('whisper');

function ensureFileExists(filePath) {
  if (!filePath) throw new Error('No audio file provided for transcription.');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }
  
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    throw new Error(`Audio file is empty: ${filePath}`);
  }
}

function validatePythonEnvironment(config) {
  if (!fs.existsSync(config.pythonBinary)) {
    throw new Error(
      `Python binary not found: ${config.pythonBinary}\n` +
      'Please run: npm run setup-python'
    );
  }

  if (!fs.existsSync(config.whisperScript)) {
    throw new Error(
      `Whisper script not found: ${config.whisperScript}\n` +
      'Please ensure backend/whisper/transcribe.py exists'
    );
  }
}

function buildArgs(filePath) {
  const config = getConfig();
  const args = [config.whisperScript, '--file', filePath];

  if (config.whisperModel) {
    args.push('--model', config.whisperModel);
  }

  if (config.whisperLanguage) {
    args.push('--language', config.whisperLanguage);
  }

  return args;
}

async function transcribeAudio(filePath) {
  ensureFileExists(filePath);

  const config = getConfig();
  validatePythonEnvironment(config);
  
  const args = buildArgs(filePath);
  const workingDir = path.dirname(config.whisperScript);

  logger.info('Starting transcription', { filePath, model: config.whisperModel });

  // Longer timeout for first-time model download (5 minutes)
  // Subsequent runs will be faster (2 minutes)
  const TRANSCRIPTION_TIMEOUT = 300000; // 5 minutes to allow for model download

  return new Promise((resolve, reject) => {
    let resolved = false;
    let subprocess = null;

    const timeout = setTimeout(() => {
      if (!resolved && subprocess) {
        resolved = true;
        subprocess.kill('SIGTERM');
        const error = new Error(
          `Whisper transcription timed out after ${TRANSCRIPTION_TIMEOUT / 1000}s. ` +
          'The audio file may be too long or the model too slow. Try a smaller model or shorter audio.'
        );
        logger.error('whisper timeout', error);
        reject(error);
      }
    }, TRANSCRIPTION_TIMEOUT);

    subprocess = spawn(config.pythonBinary, args, {
      cwd: workingDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });

    let stdout = '';
    let stderr = '';
    let isDownloading = false;
    let downloadProgress = '';

    subprocess.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      logger.debug('whisper stdout', chunk.trim());
    });

    subprocess.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      
      // Filter out download progress messages (they're not errors)
      const chunkLower = chunk.toLowerCase();
      if (chunkLower.includes('%|') || chunkLower.includes('downloading') || chunkLower.includes('ib/s')) {
        isDownloading = true;
        // Extract progress percentage if available
        const percentMatch = chunk.match(/(\d+)%/);
        if (percentMatch) {
          downloadProgress = percentMatch[1] + '%';
          logger.info(`Whisper model download progress: ${downloadProgress}`);
        } else {
          logger.debug('whisper download progress', chunk.trim());
        }
      } else if (chunk.trim() && !chunkLower.includes('100%')) {
        // Only log non-download stderr as warnings
        logger.warn('whisper stderr', chunk.trim());
      }
    });

    subprocess.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      logger.error('whisper spawn error', err);
      
      if (err.code === 'ENOENT') {
        reject(new Error(
          `Python binary not found: ${config.pythonBinary}\n` +
          'Please run: npm run setup-python'
        ));
      } else {
        reject(err);
      }
    });

    subprocess.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      if (code !== 0) {
        // Filter out download progress from error messages
        let errorMsg = stderr || stdout || 'Unknown error';
        if (isDownloading) {
          errorMsg = errorMsg.split('\n')
            .filter(line => !line.includes('%|') && !line.includes('ib/s'))
            .join('\n')
            .trim() || 'Model download or transcription failed';
        }
        
        const error = new Error(
          `Whisper transcription failed (exit code ${code}): ${errorMsg}`
        );
        logger.error('whisper non-zero exit', { code, stderr: errorMsg, stdout });
        reject(error);
        return;
      }

      const text = stdout.trim();
      
      // Check stderr for warnings about no speech detected
      const hasNoSpeechWarning = stderr.toLowerCase().includes('no speech detected') || 
                                  stderr.toLowerCase().includes('warning');
      
      if (!text) {
        if (hasNoSpeechWarning) {
          logger.warn('Whisper detected no speech in audio', { filePath, stderr: stderr.substring(0, 200) });
        } else {
          logger.warn('Whisper returned empty transcript', { filePath, stderr: stderr.substring(0, 200) });
        }
        resolve('');
        return;
      }

      if (isDownloading) {
        logger.info('Transcription completed (model was downloaded)', { length: text.length });
      } else {
        logger.info('Transcription completed', { length: text.length });
      }
      resolve(text);
    });
  });
}

module.exports = {
  transcribeAudio
};

