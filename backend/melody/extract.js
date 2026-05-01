const fs = require('fs');
const { spawn } = require('child_process');
const { getConfig } = require('../utils/config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('melody');

function ensureAudioExists(filePath) {
  if (!filePath) throw new Error('No audio file supplied for melody extraction.');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found at ${filePath}`);
  }
}

async function extractFingerprint(filePath) {
  ensureAudioExists(filePath);
  const config = getConfig();
  const args = [
    config.melodyScript,
    '--file',
    filePath,
    '--sample-rate',
    String(config.melodySampleRate),
    '--duration',
    String(config.melodyDuration)
  ];

  logger.info('Extracting melody fingerprint', { filePath });

  return new Promise((resolve, reject) => {
    const subprocess = spawn(config.pythonBinary, args, {
      cwd: require('path').dirname(config.melodyScript),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });

    let stdout = '';
    let stderr = '';

    subprocess.stdout.on('data', (chunk) => {
      const str = chunk.toString();
      stdout += str;
      logger.debug('melody stdout', str.trim());
    });

    subprocess.stderr.on('data', (chunk) => {
      const str = chunk.toString();
      stderr += str;
      logger.warn('melody stderr', str.trim());
    });

    subprocess.on('error', (err) => {
      logger.error('melody spawn error', err);
      if (err.code === 'ENOTDIR') {
        reject(
          new Error(
            'Could not extract melody fingerprints: Python cwd/script path blocked by app archive. Reinstall Museonic ≥1.0.7 (backend unpacked).'
          )
        );
        return;
      }
      reject(err);
    });

    subprocess.on('close', (code) => {
      if (code !== 0) {
        const error = new Error(`Melody extractor exited with code ${code}: ${stderr || stdout}`);
        logger.error('melody extraction failed', error);
        reject(error);
        return;
      }

      try {
        const payload = JSON.parse(stdout);
        resolve(payload);
      } catch (err) {
        logger.error('Failed to parse melody extractor output', err);
        reject(err);
      }
    });
  });
}

module.exports = {
  extractFingerprint
};

