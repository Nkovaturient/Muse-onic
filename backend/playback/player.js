const { spawn } = require('child_process');
const { getConfig } = require('../utils/config');
const { createLogger } = require('../utils/logger');
const { notifyPlayback } = require('../../n8n/workflowHooks');

const logger = createLogger('playback');

let activeProcess = null;
let activeMeta = null;

function terminateActiveProcess() {
  if (!activeProcess) return;
  try {
    activeProcess.kill('SIGTERM');
    logger.info('Existing playback process terminated');
  } catch (err) {
    logger.warn('Unable to terminate playback process gracefully', err);
  }
  activeProcess = null;
}

function spawnPlayer(playerPath, args) {
  return spawn(playerPath, args, {
    stdio: ['ignore', 'ignore', 'pipe']
  });
}

async function playTrack(url, meta = {}) {
  if (!url) {
    throw new Error('No track URL provided for playback.');
  }

  const config = getConfig();
  const candidates = [
    {
      name: 'mpv',
      path: config.mpvPath,
      args: ['--no-terminal', '--really-quiet', url]
    },
    {
      name: 'vlc',
      path: config.vlcPath,
      args: ['--intf', 'dummy', '--quiet', url]
    }
  ];

  terminateActiveProcess();
  activeMeta = { url, ...meta };

  for (const candidate of candidates) {
    try {
      logger.info(`Attempting playback via ${candidate.name}`, candidate.path);
      const process = spawnPlayer(candidate.path, candidate.args);

      await new Promise((resolveSpawn, rejectSpawn) => {
        process.once('spawn', resolveSpawn);
        process.once('error', rejectSpawn);
      });

      process.stderr.on('data', (chunk) => {
        logger.debug(`${candidate.name} stderr`, chunk.toString().trim());
      });

      process.on('exit', async (code) => {
        if (code && code !== 0) {
          logger.warn(`${candidate.name} exited with code ${code}`);
        } else {
          logger.info(`${candidate.name} playback ended`);
        }
        if (process === activeProcess) {
          activeProcess = null;
          try {
            await notifyPlayback({
              event: 'stopped',
              track: activeMeta?.track || null,
              playable: activeMeta?.playable || { url: activeMeta?.url },
              reason: code === 0 ? 'ended' : 'error',
              player: candidate.name
            });
          } catch (err) {
            logger.debug('notifyPlayback failed on stop', err.message || err);
          }
          activeMeta = null;
        }
      });

      process.on('error', (err) => {
        logger.error(`${candidate.name} spawn error`, err);
      });

      activeProcess = process;

      try {
        await notifyPlayback({
          event: 'started',
          track: meta.track || null,
          playable: meta.playable || { url },
          player: candidate.name
        });
      } catch (err) {
        logger.debug('notifyPlayback failed on start', err.message || err);
      }

      return {
        player: candidate.name,
        pid: process.pid
      };
    } catch (err) {
      logger.warn(`Failed to start ${candidate.name}`, err);
    }
  }

  throw new Error('Unable to spawn any playback backend (mpv/vlc).');
}

async function stopPlayback() {
  if (!activeProcess) {
    return;
  }

  terminateActiveProcess();
  try {
    await notifyPlayback({
      event: 'stopped',
      track: activeMeta?.track || null,
      playable: activeMeta?.playable || { url: activeMeta?.url },
      reason: 'manual'
    });
  } catch (err) {
    logger.debug('notifyPlayback failed on manual stop', err.message || err);
  }
  activeMeta = null;
}

module.exports = {
  playTrack,
  stopPlayback
};

