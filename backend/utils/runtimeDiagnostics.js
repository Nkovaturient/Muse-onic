const fs = require('fs');
const { spawnSync } = require('child_process');
const { app } = require('electron');
const { getConfig } = require('./config');
const { detectSystemAudioDevice } = require('../recorder/config');

function onPath(cmd) {
  const { status } = spawnSync('which', [cmd], { stdio: 'ignore' });
  if (status === 0) {
    return true;
  }
  if (process.platform === 'win32') {
    const w = spawnSync('where', [cmd], { stdio: 'ignore' });
    return w.status === 0;
  }
  return false;
}

function checkWhisperImport(pythonBinary) {
  const r = spawnSync(
    pythonBinary,
    ['-c', 'import whisper'],
    { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  if (r.status === 0) {
    return { ok: true };
  }
  return { ok: false, stderr: (r.stderr || r.stdout || '').trim() };
}

function pythonPathLooksValid(pythonBinary) {
  if (!pythonBinary) {
    return false;
  }
  if (pythonBinary === 'python3' || pythonBinary === 'python') {
    return true;
  }
  return fs.existsSync(pythonBinary);
}

function getRuntimeDiagnostics() {
  const config = getConfig();
  const py = config.pythonBinary;
  const pathOk = pythonPathLooksValid(py);
  let whisperImportOk = false;
  if (pathOk) {
    const w = checkWhisperImport(py);
    whisperImportOk = w.ok;
  }

  return {
    isPackaged: app.isPackaged,
    userData: app.getPath('userData'),
    recordingMode: config.recordingMode,
    pythonBinary: py,
    pythonPathOk: pathOk,
    whisperImportOk,
    recorderOk: onPath('rec') || onPath('sox'),
    systemAudioDevice: detectSystemAudioDevice(),
    mpvOrPlayback: onPath('mpv') || onPath('vlc'),
    ytDlpOk: onPath('yt-dlp')
  };
}

module.exports = {
  getRuntimeDiagnostics
};
