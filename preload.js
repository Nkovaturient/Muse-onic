const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('museonic', {
  onRecordTrigger: (callback) => ipcRenderer.on('trigger-record', callback),
  recordStart: () => ipcRenderer.invoke('record:start'),
  recordStop: () => ipcRenderer.invoke('record:stop'),
  transcribeAudio: (file) => ipcRenderer.invoke('audio:transcribe', file),
  searchSong: (text) => ipcRenderer.invoke('song:search', text),
  playSong: (payload) => ipcRenderer.invoke('song:play', payload),
  stopSong: () => ipcRenderer.invoke('song:stop'),
  determineIntent: (transcript) => ipcRenderer.invoke('intent:determine', transcript),
  processRecording: (file) => ipcRenderer.invoke('capture:process', file)
});
