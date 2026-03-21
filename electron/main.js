const { app, BrowserWindow, session, shell, screen, ipcMain, Notification } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');
const database = require('./database');
const backup = require('./backup');


let mainWindow;
let localServer;
let db;
let isShuttingDown = false;
const activeConnections = new Set();
const PORT = 19532;
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

function ytProxyHTML(videoId, mute) {
  const safeVid = (videoId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:#000}#player{width:100%;height:100%}</style>
</head><body>
<div id="player"></div>
<script>
var tag=document.createElement('script');
tag.src='https://www.youtube.com/iframe_api';
document.head.appendChild(tag);
var player,isMuted=${mute?'true':'false'};
function onYouTubeIframeAPIReady(){
  player=new YT.Player('player',{
    videoId:'${safeVid}',
    playerVars:{autoplay:1,rel:0,modestbranding:1,iv_load_policy:3${mute?',mute:1':''}},
    events:{
      onReady:function(e){
        if(isMuted)e.target.mute();
        var d=e.target.getVideoData?e.target.getVideoData():{};
        var dur=e.target.getDuration?e.target.getDuration():0;
        window.parent.postMessage({type:'yt-ready',vid:'${safeVid}',isLive:!!d.isLive,duration:dur,title:d.title||''},'*');
      },
      onError:function(e){window.parent.postMessage({type:'yt-error',vid:'${safeVid}',code:e.data},'*')},
      onStateChange:function(e){window.parent.postMessage({type:'yt-state',vid:'${safeVid}',state:e.data},'*')}
    }
  });
}
window.addEventListener('message',function(e){
  if(!player)return;
  if(e.data==='yt-pause')player.pauseVideo();
  if(e.data==='yt-play')player.playVideo();
  if(typeof e.data==='object'&&e.data.type==='yt-volume')player.setVolume(e.data.vol);
});
</script>
</body></html>`;
}

// Check if a port is in use and attempt to kill the stale process
function killStaleProcess(port) {
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    // Windows: find PID using port, then kill it
    exec(`netstat -ano | findstr :${port} | findstr LISTENING`, (err, stdout) => {
      if (err || !stdout.trim()) { resolve(false); return; }
      const lines = stdout.trim().split('\n');
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && pid !== String(process.pid)) pids.add(pid);
      }
      if (pids.size === 0) { resolve(false); return; }
      console.log(`[Vorra] Killing stale process(es) on port ${port}: PIDs ${[...pids].join(', ')}`);
      let killed = 0;
      for (const pid of pids) {
        exec(`taskkill /PID ${pid} /F /T`, (e) => {
          killed++;
          if (e) console.log(`[Vorra] Could not kill PID ${pid}: ${e.message}`);
          else console.log(`[Vorra] Killed stale PID ${pid}`);
          if (killed >= pids.size) resolve(true);
        });
      }
    });
  });
}

function startLocalServer() {
  const distPath = path.join(__dirname, '..', 'dist');
  const mimeTypes = {
    '.html':'text/html','.js':'application/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
    '.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2',
  };
  return new Promise(async (resolve, reject) => {
    localServer = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname === '/yt-proxy') {
        const vid = (parsed.query.v || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const mute = parsed.query.mute === '1';
        res.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(ytProxyHTML(vid, mute));
        return;
      }
      if (parsed.pathname === '/yt-chat') {
        const vid = (parsed.query.v || '').replace(/[^a-zA-Z0-9_-]/g, '');
        res.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a14;overflow:hidden;font-family:sans-serif}
iframe{width:100%;height:100vh;border:none}
.err{color:#888;text-align:center;padding:40px 20px;font-size:13px}
.err a{color:#06d6a0;text-decoration:none}
</style></head><body>
<iframe src="https://www.youtube.com/live_chat?v=${vid}&embed_domain=127.0.0.1&dark_theme=1"
  onload="clearTimeout(window._t)"
  onerror="document.body.innerHTML='<div class=err>Live chat unavailable for this stream.<br>Comments may be available instead.</div>'"></iframe>
<script>
window._t=setTimeout(()=>{
  try{
    const f=document.querySelector('iframe');
    if(f&&!f.contentDocument)return;
  }catch(e){}
},8000);
window.addEventListener('message',e=>{
  if(e.data==='yt-chat-unavailable')
    window.parent.postMessage({type:'yt-chat-unavail'},'*');
});
</script></body></html>`);
        return;
      }

      let filePath = path.join(distPath, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
      const ext = path.extname(filePath).toLowerCase();
      fs.readFile(filePath, (err, data) => {
        if (!err) {
          // Prevent Chromium from caching stale assets
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
        if (err) {
          fs.readFile(path.join(distPath, 'index.html'), (e2, d2) => {
            if (e2) { res.writeHead(404); res.end('Not found'); }
            else { res.writeHead(200, {'Content-Type':'text/html','Referrer-Policy':'strict-origin-when-cross-origin'}); res.end(d2); }
          });
        } else {
          res.writeHead(200, {'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Referrer-Policy':'strict-origin-when-cross-origin'});
          res.end(data);
        }
      });
    });

    // Track all connections for forceful cleanup on shutdown
    localServer.on('connection', (socket) => {
      activeConnections.add(socket);
      socket.on('close', () => activeConnections.delete(socket));
    });

    // Handle EADDRINUSE: kill stale process and retry once
    localServer.on('error', async (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[Vorra] Port ${PORT} in use — attempting to kill stale process...`);
        const killed = await killStaleProcess(PORT);
        if (killed) {
          // Wait a moment for the port to free up, then retry
          setTimeout(() => {
            localServer.listen(PORT, '127.0.0.1', () => {
              console.log(`[Vorra] Server started on port ${PORT} (after clearing stale process)`);
              resolve();
            });
          }, 500);
        } else {
          const msg = `Port ${PORT} is already in use and could not be freed.\n\nAnother instance of Vorra may be running.\nClose it and try again, or restart your computer.`;
          console.error(`[Vorra] ${msg}`);
          const { dialog } = require('electron');
          dialog.showErrorBox('Vorra — Port Conflict', msg);
          app.quit();
        }
      } else {
        console.error(`[Vorra] Server error: ${err.message}`);
        reject(err);
      }
    });

    localServer.listen(PORT, '127.0.0.1', () => {
      console.log(`[Vorra] Server started on port ${PORT}`);
      resolve();
    });
  });
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  // Scale window to 80% of screen, with sensible bounds
  const ww = Math.min(Math.max(Math.round(sw * 0.8), 1100), 2200);
  const wh = Math.min(Math.max(Math.round(sh * 0.85), 700), 1600);
  
  mainWindow = new BrowserWindow({
    width: ww, height: wh, minWidth: 1000, minHeight: 700,
    title: `Vorra v${require('../package.json').version || '7.3.0'}`,
    backgroundColor: '#060a11',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
  });

  // Strip X-Frame-Options for YouTube (for chat iframe)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.includes('youtube.com') || details.url.includes('youtube-nocookie.com')) {
      const h = { ...details.responseHeaders };
      delete h['x-frame-options']; delete h['X-Frame-Options'];
      delete h['content-security-policy']; delete h['Content-Security-Policy'];
      callback({ responseHeaders: h });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  const isDev = process.env.ELECTRON_DEV === '1';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  }
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Register IPC handlers for database, backup, notifications, and platform
function registerIpcHandlers() {
  // Database channels
  ipcMain.handle('db:get', (_event, key) => {
    return database.getValue(key);
  });

  ipcMain.handle('db:set', (_event, key, value) => {
    database.setValue(key, value);
  });

  ipcMain.handle('db:getAll', () => {
    return database.getAllData();
  });

  ipcMain.handle('db:export', () => {
    return database.exportData();
  });

  ipcMain.handle('db:import', (_event, jsonStr) => {
    const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    // Support wrapped format { version, data } and raw key-value format
    const data = parsed.data || parsed;
    database.importData(data);
  });

  ipcMain.handle('db:getPath', () => {
    return database.getDbPath();
  });

  // Backup channels
  ipcMain.handle('backup:save', (_event, customPath) => {
    return backup.saveBackup(database, customPath || undefined);
  });

  ipcMain.handle('backup:restore', (_event, filePath) => {
    return backup.restoreBackup(database, filePath);
  });

  ipcMain.handle('backup:list', () => {
    return backup.listBackups();
  });

  ipcMain.handle('backup:auto', () => {
    backup.autoBackup(database);
  });

  // Notification channels
  ipcMain.handle('notify:show', (_event, title, body, options = {}) => {
    if (Notification.isSupported()) {
      const notif = new Notification({
        title,
        body,
        silent: options.silent || false,
        icon: options.icon || path.join(__dirname, '..', 'public', 'icon.png'),
      });
      notif.show();
    }
  });

  ipcMain.handle('notify:badge', (_event, count) => {
    if (mainWindow) {
      // Windows: overlay icon or flash taskbar
      if (count > 0) {
        mainWindow.setTitle(`(${count}) Vorra v${require('../package.json').version || '7.3.0'}`);
        mainWindow.flashFrame(true);
      } else {
        mainWindow.setTitle(`Vorra v${require('../package.json').version || '7.3.0'}`);
        mainWindow.flashFrame(false);
      }
    }
  });

  // Platform channel (sync for immediate access in preload)
  ipcMain.on('platform:version', (event) => {
    event.returnValue = require('../package.json').version || '7.3.0';
  });

  console.log('[Vorra] IPC handlers registered');
}

// Single instance lock — prevent duplicate launches that orphan processes
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.log('[Vorra] Another instance is running — quitting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  app.userAgentFallback = CHROME_UA;

  // Initialize SQLite database
  db = database.initDB();
  registerIpcHandlers();

  // Auto-backup on startup
  try {
    backup.autoBackup(database);
  } catch (err) {
    console.error('[Vorra] Startup auto-backup failed:', err.message);
  }

  await startLocalServer();
  createWindow();
});

// Ensure clean shutdown on all exit paths
function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('[Vorra] Shutting down...');

  // 1. Destroy all BrowserWindows to force renderer/GPU/utility teardown
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.destroy(); } catch (_e) {}
  }

  // 2. Remove session interceptors
  try {
    session.defaultSession.webRequest.onHeadersReceived(null);
  } catch (_e) {}

  // 3. Force-close HTTP server and all active connections
  if (localServer) {
    try {
      localServer.close();
      if (typeof localServer.closeAllConnections === 'function') {
        localServer.closeAllConnections();
      }
      for (const socket of activeConnections) {
        try { socket.destroy(); } catch (_e) {}
      }
      activeConnections.clear();
    } catch (_e) {}
    localServer = null;
  }

  // 4. Close database
  database.closeDB();
}

app.on('window-all-closed', () => {
  shutdown();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', shutdown);

app.on('will-quit', () => {
  shutdown();
  // Failsafe: force exit after 3 seconds if cleanup hangs
  setTimeout(() => {
    console.error('[Vorra] Shutdown timeout — forcing exit');
    process.exit(0);
  }, 3000).unref();
});

process.on('SIGINT', () => { shutdown(); process.exit(0); });
process.on('SIGTERM', () => { shutdown(); process.exit(0); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
