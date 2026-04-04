// Preload Script — Context bridge for renderer process
// Exposes window.vorra API via Electron's contextBridge

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vorra', {
  // Database operations
  db: {
    get: (key) => ipcRenderer.invoke('db:get', key),
    set: (key, value) => ipcRenderer.invoke('db:set', key, value),
    getAll: () => ipcRenderer.invoke('db:getAll'),
    export: () => ipcRenderer.invoke('db:export'),
    import: (jsonStr) => ipcRenderer.invoke('db:import', jsonStr),
    getPath: () => ipcRenderer.invoke('db:getPath'),
  },

  // Backup operations
  backup: {
    save: (customPath) => ipcRenderer.invoke('backup:save', customPath),
    restore: (filePath) => ipcRenderer.invoke('backup:restore', filePath),
    listBackups: () => ipcRenderer.invoke('backup:list'),
    autoBackup: () => ipcRenderer.invoke('backup:auto'),
  },

  // Platform info
  platform: {
    isElectron: true,
    os: process.platform,
    appVersion: ipcRenderer.sendSync('platform:version'),
  },

  // Notifications
  notify: {
    show: (title, body, options) => ipcRenderer.invoke('notify:show', title, body, options),
    setBadge: (count) => ipcRenderer.invoke('notify:badge', count),
  },

  // Updates
  updates: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onAvailable: (cb) => { ipcRenderer.on('update:available', (_, info) => cb(info)); },
    onProgress: (cb) => { ipcRenderer.on('update:progress', (_, pct) => cb(pct)); },
    onReady: (cb) => { ipcRenderer.on('update:ready', (_, info) => cb(info)); },
  },
});
