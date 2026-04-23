const { spawn, execFileSync, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const { getConfig } = require('../utils/config');
const { createLogger } = require('../utils/logger');
const { notifyPlayback } = require('../../n8n/workflowHooks');

const execFileAsync = promisify(execFile);

const logger = createLogger('playback');
const STARTUP_GRACE_MS = 4000;

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

function resolveExecutable(cmd) {
  if (!cmd) {
    return null;
  }
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) {
    return cmd;
  }
  const base = path.basename(cmd);
  try {
    if (process.platform === 'win32') {
      return execFileSync('where', [base], { encoding: 'utf8' }).split('\n')[0].trim() || null;
    }
    return execFileSync('which', [base], { encoding: 'utf8' }).trim() || null;
  } catch (e) {
    return null;
  }
}

function resolveMpvPath(config) {
  return resolveExecutable(config.mpvPath) || (process.platform === 'darwin' && fs.existsSync('/opt/homebrew/bin/mpv') ? '/opt/homebrew/bin/mpv' : null) || (process.platform === 'darwin' && fs.existsSync('/usr/local/bin/mpv') ? '/usr/local/bin/mpv' : null);
}

function resolveVlcPath(config) {
  const p = resolveExecutable(config.vlcPath);
  if (p) {
    return p;
  }
  if (process.platform === 'darwin') {
    const macVlc = '/Applications/VLC.app/Contents/MacOS/VLC';
    if (fs.existsSync(macVlc)) {
      return macVlc;
    }
  }
  return null;
}

function isYouTubeWatchOrShare(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'youtu.be' && u.pathname.length > 1) {
      return true;
    }
    if (!host.endsWith('youtube.com')) {
      return false;
    }
    if (u.pathname === '/results') {
      return false;
    }
    if (u.pathname === '/watch' && u.searchParams.get('v')) {
      return true;
    }
    if (u.pathname.startsWith('/embed/') && u.pathname.length > '/embed/'.length + 2) {
      return true;
    }
    if (u.pathname.startsWith('/shorts/') && u.pathname.length > '/shorts/'.length + 2) {
      return true;
    }
  } catch (e) {
    return false;
  }
  return false;
}

function isYouTubePage(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.endsWith('youtube.com') || h === 'youtu.be';
  } catch (e) {
    return false;
  }
}

function buildMpvArgsStreamDirect(streamUrl) {
  return [
    '--no-terminal',
    '--really-quiet',
    '--no-video',
    streamUrl
  ];
}

function buildMpvArgsWithYtdlHook(config, pageUrl) {
  const ytdlBin = resolveExecutable(config.ytDlpPath);
  const args = [
    '--no-terminal',
    '--really-quiet',
    '--no-video',
    pageUrl
  ];
  if (isYouTubePage(pageUrl)) {
    if (ytdlBin) {
      args.unshift(`--ytdl-path=${ytdlBin}`, '--ytdl');
    } else {
      args.unshift('--ytdl');
      logger.warn(
        'YouTube URL but yt-dlp was not found in PATH; install: brew install yt-dlp, or set MUSEONIC_YTDLP_PATH. mpv may still fail to open the stream.'
      );
    }
  }
  return args;
}

/**
 * Resolves a single HTTPS stream URL with yt-dlp (avoids mpv's ytdl Lua hook, which often fails
 * on Homebrew mpv: exit 1, no stderr).
 */
async function tryExtractYoutubeStreamUrl(ytDlpConfigPath, pageUrl) {
  const bin = resolveExecutable(ytDlpConfigPath) || resolveExecutable('yt-dlp');
  if (!bin) {
    return null;
  }
  const formatAttempts = [
    ['-f', '18', '-g', '--no-warnings', '--no-playlist'],
    ['-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio', '-g', '--no-warnings', '--no-playlist'],
    ['-f', 'bestaudio/best', '-g', '--no-warnings', '--no-playlist'],
    ['-f', 'b', '-g', '--no-warnings', '--no-playlist']
  ];
  for (const prefix of formatAttempts) {
    try {
      const { stdout } = await execFileAsync(bin, [...prefix, pageUrl], {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 120000
      });
      const lines = stdout
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('http'));
      if (lines.length === 1) {
        logger.info('yt-dlp resolved a direct stream URL (mpv hook not needed)');
        return lines[0];
      }
    } catch (e) {
      logger.debug('yt-dlp -g format attempt failed', e.message || e);
    }
  }
  return null;
}

function buildVlcArgs(url) {
  return ['--intf', 'dummy', '--quiet', url];
}

function spawnPlayer(playerPath, args) {
  return spawn(playerPath, args, {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function waitForStartupOrFail(child, name) {
  let combined = '';
  const append = (tag, s) => {
    combined += s;
    if (s.trim()) {
      logger.debug(`${name} ${tag}`, s.trim().slice(0, 500));
    }
  };
  child.stderr.on('data', (chunk) => append('stderr', chunk.toString()));
  child.stdout.on('data', (chunk) => append('stdout', chunk.toString()));

  return new Promise((resolve) => {
    let finished = false;
    const t = setTimeout(() => {
      if (finished) {
        return;
      }
      finished = true;
      child.removeListener('exit', onExit);
      resolve({ stillRunning: true, stderr: combined.trim() });
    }, STARTUP_GRACE_MS);

    function onExit(code) {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(t);
      const tail = combined.trim().slice(-4000) || '(no output on stdout/stderr)';
      if (code !== 0 && code != null) {
        logger.warn(`${name} failed to open the stream (exit ${code})`, { output: tail });
      } else {
        logger.warn(`${name} exited before playback could start (code ${code})`, { output: tail });
      }
      resolve({ stillRunning: false, exitCode: code, stderr: combined.trim() });
    }
    child.once('exit', onExit);
  });
}

async function playTrack(url, meta = {}) {
  if (!url) {
    throw new Error('No track URL provided for playback.');
  }

  if (!isYouTubeWatchOrShare(url) && (String(url).includes('youtube.com/results') || (String(url).includes('search_query=') && isYouTubePage(url)))) {
    throw new Error(
      'This link is a YouTube search page, not a single video. Pick a result that has a direct watch URL, or try recording again.'
    );
  }

  const config = getConfig();
  let youtubeDirectStream = null;
  if (isYouTubePage(url)) {
    youtubeDirectStream = await tryExtractYoutubeStreamUrl(config.ytDlpPath, url);
  }
  const mpvPlayRef = youtubeDirectStream || url;
  const useMpvDirectStream = Boolean(youtubeDirectStream);

  const candidates = [
    {
      name: 'mpv',
      getArgs: () =>
        useMpvDirectStream
          ? buildMpvArgsStreamDirect(mpvPlayRef)
          : buildMpvArgsWithYtdlHook(config, url),
      resolvePath: () => resolveMpvPath(config)
    },
    {
      name: 'vlc',
      getArgs: () => buildVlcArgs(url),
      resolvePath: () => resolveVlcPath(config)
    }
  ];

  terminateActiveProcess();
  activeMeta = { url, ...meta };
  const playable = meta.playable || { url };
  const track = meta.track || null;

  const failureNotes = [];
  for (const candidate of candidates) {
    const resolvedPath = candidate.resolvePath();
    if (!resolvedPath) {
      logger.warn(`Skipping ${candidate.name}: executable not found`, candidate.name === 'vlc' ? 'install VLC or set MUSEONIC_VLC_PATH' : config.mpvPath);
      failureNotes.push(
        candidate.name === 'vlc' ? 'VLC is not installed (optional fallback).' : 'mpv was not found in PATH.'
      );
      // eslint-disable-next-line no-continue
      continue;
    }

    const args = candidate.getArgs();
    try {
      logger.info(`Attempting playback via ${candidate.name}`, {
        path: resolvedPath,
        ytdl: config.ytDlpPath,
        mpvDirectStream: useMpvDirectStream
      });
      const child = spawnPlayer(resolvedPath, args);
      await new Promise((resolve, reject) => {
        child.once('spawn', () => resolve());
        child.once('error', reject);
      });

      const startup = await waitForStartupOrFail(child, candidate.name);
      if (!startup.stillRunning) {
        // eslint-disable-next-line no-continue
        continue;
      }

      let exitHandled = false;
      child.on('exit', async (code) => {
        if (exitHandled) {
          return;
        }
        exitHandled = true;
        if (code && code !== 0) {
          logger.warn(`${candidate.name} exited with code ${code}`);
        } else {
          logger.info(`${candidate.name} playback ended`);
        }
        if (child === activeProcess) {
          activeProcess = null;
          try {
            await notifyPlayback({
              event: 'stopped',
              track: activeMeta?.track || track,
              playable: activeMeta?.playable || playable,
              reason: code === 0 ? 'ended' : 'error',
              player: candidate.name
            });
          } catch (err) {
            logger.debug('notifyPlayback failed on stop', err.message || err);
          }
          activeMeta = null;
        }
      });

      activeProcess = child;

      try {
        await notifyPlayback({
          event: 'started',
          track,
          playable,
          player: candidate.name
        });
      } catch (err) {
        logger.debug('notifyPlayback failed on start', err.message || err);
      }

      return {
        player: candidate.name,
        pid: child.pid
      };
    } catch (err) {
      failureNotes.push(`${candidate.name}: ${err.message || err}`);
      logger.warn(`Failed to start ${candidate.name}`, err);
    }
  }

  const hint = [
    'Could not start playback.',
    isYouTubePage(url) && !youtubeDirectStream
      ? 'YouTube: yt-dlp could not get a direct stream; ensure yt-dlp is current (brew upgrade yt-dlp) and the video is playable in your region.'
    : null,
    failureNotes.length ? `Details: ${failureNotes.join(' | ')}` : null
  ]
    .filter(Boolean)
    .join(' ');

  throw new Error(
    hint ||
      'Install mpv and yt-dlp (brew install mpv yt-dlp), or install VLC. Use a watch URL (youtube.com/watch?v=…), not a search page.'
  );
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

