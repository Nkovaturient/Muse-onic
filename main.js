const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { clearConfigCache } = require('./backend/utils/config');

if (process.platform === 'darwin') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/sbin'].filter((p) =>
    fs.existsSync(p)
  );
  if (extra.length) {
    process.env.PATH = `${extra.join(':')}:${process.env.PATH || ''}`;
  }
}

if (app && app.isPackaged) {
  const bundled = path.join(process.resourcesPath, 'venv', 'bin', 'python3');
  if (fs.existsSync(bundled)) {
    process.env.MUSEONIC_PYTHON_BIN = bundled;
  }
}

clearConfigCache();

const { startRecording, stopRecording } = require('./backend/recorder/mic');
const { transcribeAudio } = require('./backend/whisper/transcribe');
const { searchSong } = require('./backend/search/lyricsSearch');
const { playTrack, stopPlayback } = require('./backend/playback/player');
const { determineIntent } = require('./ollama/promptRouter');
const { processRecording } = require('./backend/process/pipeline');
const { createLogger } = require('./backend/utils/logger');
const { getRuntimeDiagnostics } = require('./backend/utils/runtimeDiagnostics');

const logger = createLogger('main');
let mainWindow;
function resolveBrandLogoPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'renderer', 'dist', 'logo2.png'),
    path.join(__dirname, 'renderer', 'dist', 'logo3.jpeg'),
    path.join(__dirname, 'renderer', 'public', 'logo2.png'),
    path.join(__dirname, 'renderer', 'public', 'logo3.jpeg')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function calculateWindowPosition() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const windowWidth = 380;
  const windowHeight = 580;
  const margin = 20;
  
  return {
    x: screenWidth - windowWidth - margin,
    y: screenHeight - windowHeight - margin
  };
}

function createWindow() {
  const windowSize = {
    width: 480,
    height: 680
  };
  
  const position = calculateWindowPosition();
  const brandLogoPath = resolveBrandLogoPath();
  
  mainWindow = new BrowserWindow({
    width: windowSize.width,
    height: windowSize.height,
    x: position.x,
    y: position.y,
    minWidth: 400,
    minHeight: 550,
    maxWidth: 700,
    maxHeight: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    show: false,
    resizable: true,
    movable: true,
    fullscreenable: false,
    icon: brandLogoPath || undefined,
  });

  const rendererPath = path.join(__dirname, 'renderer', 'dist', 'index.html');
  mainWindow.loadFile(rendererPath);

  screen.on('display-metrics-changed', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const newPosition = calculateWindowPosition();
      const [currentX, currentY] = mainWindow.getPosition();
      const { width, height } = mainWindow.getBounds();
      
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const margin = 20;
      
      if (currentX > screenWidth - width - margin - 50 && 
          currentY > screenHeight - height - margin - 50) {
        mainWindow.setPosition(newPosition.x, newPosition.y);
        logger.info('Window repositioned due to screen change');
      }
    }
  });

  mainWindow.once('ready-to-show', () => {
    logger.info('Window ready', { position, size: windowSize });
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerHotkey() {
  const ret = globalShortcut.register('CommandOrControl+M', () => {
    if (!mainWindow) {
      logger.warn('Main window not available, creating new window');
      createWindow();
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    
    if (!mainWindow.isVisible()) {
      const position = calculateWindowPosition();
      mainWindow.setPosition(position.x, position.y);
    }
    
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('trigger-record');
    logger.info('Hotkey triggered: Ctrl/Cmd+M');
  });

  if (!ret) {
    logger.error('Failed to register global shortcut CommandOrControl+M');
    logger.warn('Hotkey may be in use by another application');
  } else {
    logger.info('Global shortcut registered: CommandOrControl+M');
  }
}

app.whenReady().then(() => {
  const brandLogoPath = resolveBrandLogoPath();
  if (brandLogoPath && process.platform === 'darwin' && app.dock?.setIcon) {
    app.dock.setIcon(brandLogoPath);
  }

  createWindow();

  registerHotkey();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

ipcMain.handle('record:start', async () => {
  try {
    return await startRecording();
  } catch (err) {
    logger.error('record:start failed', err);
    throw err;
  }
});

ipcMain.handle('record:stop', async () => {
  try {
    return await stopRecording();
  } catch (err) {
    logger.error('record:stop failed', err);
    throw err;
  }
});

ipcMain.handle('audio:transcribe', async (_, filePath) => {
  try {
    return await transcribeAudio(filePath);
  } catch (err) {
    logger.error('audio:transcribe failed', err);
    throw err;
  }
});

ipcMain.handle('song:search', async (_, text) => {
  try {
    return await searchSong(text);
  } catch (err) {
    logger.error('song:search failed', err);
    throw err;
  }
});

ipcMain.handle('song:play', async (_, payload) => {
  try {
    if (typeof payload === 'string') {
      return await playTrack(payload);
    }
    const { url, meta } = payload || {};
    return await playTrack(url, meta);
  } catch (err) {
    logger.error('song:play failed', err);
    throw err;
  }
});

ipcMain.handle('song:stop', async () => {
  try {
    await stopPlayback();
    return true;
  } catch (err) {
    logger.error('song:stop failed', err);
    throw err;
  }
});

ipcMain.handle('intent:determine', async (_, transcript) => {
  try {
    return await determineIntent(transcript);
  } catch (err) {
    logger.error('intent:determine failed', err);
    throw err;
  }
});

ipcMain.handle('capture:process', async (_, filePath) => {
  try {
    return await processRecording({ filePath });
  } catch (err) {
    logger.error('capture:process failed', err);
    throw err;
  }
});

ipcMain.handle('app:diagnostics', async () => {
  try {
    return getRuntimeDiagnostics();
  } catch (err) {
    logger.error('app:diagnostics failed', err);
    return { error: err.message || String(err) };
  }
});

ipcMain.handle('app:branding', async () => {
  return {
    logoPath: resolveBrandLogoPath()
  };
});