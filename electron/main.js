const { app, BrowserWindow, session, shell, screen } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const url = require('url');


let mainWindow;
let localServer;
const PORT = 19532;
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

function ytProxyHTML(videoId, mute) {
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
    videoId:'${videoId}',
    playerVars:{autoplay:1,rel:0,modestbranding:1,iv_load_policy:3${mute?',mute:1':''}},
    events:{
      onReady:function(e){
        if(isMuted)e.target.mute();
        var d=e.target.getVideoData?e.target.getVideoData():{};
        var dur=e.target.getDuration?e.target.getDuration():0;
        window.parent.postMessage({type:'yt-ready',vid:'${videoId}',isLive:!!d.isLive,duration:dur,title:d.title||''},'*');
      },
      onError:function(e){window.parent.postMessage({type:'yt-error',vid:'${videoId}',code:e.data},'*')},
      onStateChange:function(e){window.parent.postMessage({type:'yt-state',vid:'${videoId}',state:e.data},'*')}
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

function startLocalServer() {
  const distPath = path.join(__dirname, '..', 'dist');
  const mimeTypes = {
    '.html':'text/html','.js':'application/javascript','.css':'text/css',
    '.json':'application/json','.png':'image/png','.jpg':'image/jpeg',
    '.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2',
  };
  return new Promise((resolve) => {
    localServer = http.createServer((req, res) => {
      const parsed = url.parse(req.url, true);
      if (parsed.pathname === '/yt-proxy') {
        const mute = parsed.query.mute === '1';
        res.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
        res.end(ytProxyHTML(parsed.query.v || '', mute));
        return;
      }
      if (parsed.pathname === '/yt-chat') {
        const vid = parsed.query.v || '';
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
    localServer.listen(PORT, '127.0.0.1', () => resolve());
  });
}

function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  // Scale window to 80% of screen, with sensible bounds
  const ww = Math.min(Math.max(Math.round(sw * 0.8), 1100), 2200);
  const wh = Math.min(Math.max(Math.round(sh * 0.85), 700), 1600);
  
  mainWindow = new BrowserWindow({
    width: ww, height: wh, minWidth: 1000, minHeight: 700,
    title: `DevonSYNC v${require('../package.json').version || '7.3.0'}`,
    backgroundColor: '#060a11',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
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

app.whenReady().then(async () => {
  app.userAgentFallback = CHROME_UA;
  await startLocalServer();
  createWindow();
});

app.on('window-all-closed', () => { if (localServer) localServer.close(); if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
