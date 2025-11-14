const fs = require('fs');
const record = require('node-record-lpcm16');
const { getRecordingFilePath, getRecordingOptions } = require('./config');
const { createLogger } = require('../utils/logger');

const logger = createLogger('recorder');

let activeRecorder = null;

function assertNoActiveRecording() {
  if (activeRecorder) {
    throw new Error('Recording already in progress.');
  }
}

async function startRecording() {
  assertNoActiveRecording();

  const filePath = getRecordingFilePath();
  const fileStream = fs.createWriteStream(filePath, { encoding: 'binary' });

  let recorderInstance;
  let audioStream;
  
  try {
    const options = getRecordingOptions();
    logger.debug('Starting recorder with options', { recorder: options.recorder, sampleRate: options.sampleRate });
    
    recorderInstance = record.record(options);
    audioStream = recorderInstance.stream();
    
    // Handle stream errors immediately
    audioStream.on('error', (err) => {
      logger.error('Audio stream error during recording', err);
      if (activeRecorder) {
        activeRecorder = null;
      }
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }
    });

    // Monitor for data to ensure recording is actually happening
    let hasData = false;
    audioStream.on('data', (chunk) => {
      hasData = true;
      logger.debug('Recording data received', { bytes: chunk.length });
    });

    // Set a timeout to check if we're actually getting data
    const dataCheckTimeout = setTimeout(() => {
      if (!hasData && activeRecorder) {
        logger.warn('No audio data received after 1 second - check microphone permissions');
      }
    }, 1000);

    audioStream.pipe(fileStream);
    
    // Store timeout for cleanup
    if (!activeRecorder) {
      activeRecorder = {
        filePath,
        recorderInstance,
        fileStream,
        audioStream,
        dataCheckTimeout
      };
    } else {
      activeRecorder.dataCheckTimeout = dataCheckTimeout;
    }

  } catch (err) {
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
    }
    logger.error('Failed to start recorder', err);
    
    let errorMsg = `Recording failed to start: ${err.message}`;
    if (err.message.includes('ENOENT') || err.message.includes('spawn')) {
      errorMsg += '\n\nPlease ensure:\n' +
        '1. Audio recorder (sox) is installed: brew install sox\n' +
        '2. Microphone permissions are granted in System Preferences\n' +
        '3. A microphone is connected and working';
    }
    
    throw new Error(errorMsg);
  }

  logger.info('Recording started', filePath);
  return filePath;
}

async function stopRecording() {
  if (!activeRecorder) {
    throw new Error('No active recording to stop.');
  }

  const { recorderInstance, fileStream, filePath, audioStream, dataCheckTimeout } = activeRecorder;
  
  // Clean up data check timeout
  if (dataCheckTimeout) {
    clearTimeout(dataCheckTimeout);
  }
  
  activeRecorder = null;

  return new Promise((resolve, reject) => {
    const TIMEOUT_MS = 10000; // Increased to 10 seconds
    let resolved = false;
    let streamEnded = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanupListeners();
        logger.error('Recording stop timeout', filePath);
        
        if (recorderInstance && recorderInstance.process) {
          try {
            recorderInstance.process.kill('SIGTERM');
          } catch (e) {
            logger.warn('Failed to kill recorder process', e);
          }
        }
        
        reject(new Error(
          'Recording stop timed out. The audio file may be incomplete.\n' +
          'This can happen if the microphone is not working or permissions are denied.'
        ));
      }
    }, TIMEOUT_MS);

    function cleanupListeners() {
      clearTimeout(timeout);
      if (fileStream) {
        fileStream.removeListener('close', onClose);
        fileStream.removeListener('finish', onFinish);
        fileStream.removeListener('error', onError);
      }
    }

    function done(success) {
      if (resolved) return;
      resolved = true;
      cleanupListeners();
      
      if (success) {
        setTimeout(() => {
          if (!fs.existsSync(filePath)) {
            logger.error('Recording file not found after stop', filePath);
            reject(new Error('Recording file was not created'));
            return;
          }
          
          const stats = fs.statSync(filePath);
          if (stats.size === 0) {
            logger.error('Recording file is empty', filePath);
            reject(new Error(
              'Recording file is empty. This usually means:\n' +
              '1. Microphone permissions were denied\n' +
              '2. No audio input was detected\n' +
              '3. The recorder backend (sox) is not working correctly'
            ));
            return;
          }

          logger.info('Recording saved', { filePath, size: stats.size });
          resolve(filePath);
        }, 100); // Small delay to ensure file is fully written
      }
    }

    function onClose() {
      streamEnded = true;
      done(true);
    }

    function onFinish() {
      streamEnded = true;
      done(true);
    }

    function onError(err) {
      if (resolved) return;
      resolved = true;
      cleanupListeners();
      logger.error('Recording stream error', err);
      reject(new Error(`Recording stream error: ${err.message}`));
    }

    fileStream.once('close', onClose);
    fileStream.once('finish', onFinish);
    fileStream.once('error', onError);

    try {
      // Stop the audio stream first
      if (audioStream && !audioStream.destroyed) {
        audioStream.removeAllListeners('error');
        audioStream.destroy();
      }
      
      // Then stop the recorder
      if (recorderInstance) {
        if (typeof recorderInstance.stop === 'function') {
          recorderInstance.stop();
        } else if (recorderInstance.process) {
          recorderInstance.process.kill('SIGTERM');
          // Give it a moment to clean up
          setTimeout(() => {
            if (recorderInstance.process && !recorderInstance.process.killed) {
              recorderInstance.process.kill('SIGKILL');
            }
          }, 500);
        }
      }
      
      // Finally end the file stream
      if (fileStream && !fileStream.destroyed) {
        fileStream.end();
      }
    } catch (err) {
      if (resolved) return;
      logger.warn('Error stopping recorder, forcing cleanup', err);
      try {
        if (audioStream && !audioStream.destroyed) {
          audioStream.destroy();
        }
        if (fileStream && !fileStream.destroyed) {
          fileStream.end();
        }
      } catch (e) {
        resolved = true;
        cleanupListeners();
        logger.error('Failed to stop recorder and end stream', e);
        reject(new Error(`Failed to stop recording: ${err.message}`));
      }
    }
  });
}

module.exports = {
  startRecording,
  stopRecording
};

