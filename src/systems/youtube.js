// YouTube Multi-Stream Playback System

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";
import { toast } from "./toast.js";
import { YT_STREAMS } from "../streams.js";

// ── YouTube API Key ─────────────────────────────────────────────────
// User must provide their own YouTube Data API key in Settings → Integrations
export const DEFAULT_YT_API_KEY = "";
export function getYtApiKey(data) { return data?.ytApiKey || ""; }

// ── Multi-Stream State ──────────────────────────────────────────────
// YouTube multi-stream playback (up to 4 concurrent)
let _ytStreams = []; // [{vid, name, desc, cat, paused, volume, slot}]
let _ytPlaySubs = [];
// [STATE] ytPlayNotify — deep-copies stream objects so React detects paused state changes
function ytPlayNotify() { _ytPlaySubs.forEach(fn => fn(_ytStreams.map(s => ({...s})))); }

export function ytAddStream(stream) {
  if (!stream) return;
  // Already playing? Remove it
  const existing = _ytStreams.findIndex(s => s.vid === stream.vid);
  if (existing >= 0) { ytRemoveStream(stream.vid); return; }
  // Max 4 streams
  if (_ytStreams.length >= 4) {
    toast("Max 4 YouTube streams \u2014 remove one first", "warn");
    return;
  }
  // SomaFM and YouTube can now play simultaneously (combined mode)
  const slot = _ytStreams.length;
  _ytStreams.push({ ...stream, paused: false, volume: 80, slot });
  dlog('info','youtube',`Added stream [${slot}]: ${stream.name} [${stream.vid}] (${_ytStreams.length} active)`);
  ytPlayNotify();
}

export function ytRemoveStream(vid) {
  const idx = _ytStreams.findIndex(s => s.vid === vid);
  if (idx < 0) return;
  // Mark as closing for fade-out animation
  _ytStreams[idx].closing = true;
  ytPlayNotify();
  dlog('info','youtube',`Removed: ${_ytStreams[idx].name}`);
  // Actually remove after animation completes
  setTimeout(() => {
    _ytStreams = _ytStreams.filter(s => s.vid !== vid);
    _ytStreams.forEach((s, i) => s.slot = i);
    ytPlayNotify();
  }, 300);
}

export function ytClearAll() {
  dlog('info','youtube',`Clearing all ${_ytStreams.length} streams`);
  // Mark all as closing
  _ytStreams.forEach(s => s.closing = true);
  ytPlayNotify();
  // Remove after animation
  setTimeout(() => {
    _ytStreams = [];
    ytPlayNotify();
  }, 300);
}

export function ytPauseToggle(vid) {
  const s = vid ? _ytStreams.find(s => s.vid === vid) : _ytStreams[0];
  if (!s) return;
  s.paused = !s.paused;
  // Send to specific iframe by slot
  document.querySelectorAll(`iframe[data-yt-slot="${s.slot}"]`).forEach(f => {
    f.contentWindow?.postMessage(s.paused ? 'yt-pause' : 'yt-play', '*');
  });
  dlog('info','youtube',`${s.paused?'Paused':'Resumed'}: ${s.name}`);
  ytPlayNotify();
}

// Re-enforce pause state on all paused streams (prevents auto-play on page switch)
export function ytReenforcePause() {
  const doPause = () => {
    _ytStreams.forEach(s => {
      if (s.paused) {
        document.querySelectorAll(`iframe[data-yt-slot="${s.slot}"]`).forEach(f => {
          f.contentWindow?.postMessage('yt-pause', '*');
        });
      }
    });
  };
  // Fire multiple times to catch late-loading iframes
  doPause();
  setTimeout(doPause, 150);
  setTimeout(doPause, 500);
  setTimeout(doPause, 1200);
}

export function ytPauseAll() {
  // If ANY stream is playing, pause ALL. If ALL paused, resume ALL.
  const anyPlaying = _ytStreams.some(s => !s.paused);
  const targetPaused = anyPlaying; // true = pause all, false = resume all
  _ytStreams.forEach(s => {
    if (s.paused !== targetPaused) {
      s.paused = targetPaused;
      document.querySelectorAll(`iframe[data-yt-slot="${s.slot}"]`).forEach(f => {
        f.contentWindow?.postMessage(targetPaused ? 'yt-pause' : 'yt-play', '*');
      });
    }
  });
  dlog('info','youtube',targetPaused ? 'Paused ALL streams' : 'Resumed ALL streams');
  ytPlayNotify();
}

export function ytSetVolume(vol, vid) {
  const targets = vid ? _ytStreams.filter(s => s.vid === vid) : _ytStreams;
  targets.forEach(s => {
    s.volume = Math.round(vol);
    document.querySelectorAll(`iframe[data-yt-slot="${s.slot}"]`).forEach(f => {
      f.contentWindow?.postMessage({type:'yt-volume',vol:Math.round(vol)}, '*');
    });
  });
  ytPlayNotify();
}

export function ytNext() {
  if (_ytStreams.length === 0) return;
  const current = _ytStreams[0];
  const liveStreams = YT_STREAMS.filter(s => !_ytHealth[s.vid] || _ytHealth[s.vid].ok);
  const idx = liveStreams.findIndex(s => s.vid === current.vid);
  const next = liveStreams[(idx + 1) % liveStreams.length];
  ytRemoveStream(current.vid);
  ytAddStream({vid:next.vid, name:next.name, desc:next.desc, cat:next.cat});
  toast(`Now playing: ${next.name}`, "info");
}

export function ytPrev() {
  if (_ytStreams.length === 0) return;
  const current = _ytStreams[0];
  const liveStreams = YT_STREAMS.filter(s => !_ytHealth[s.vid] || _ytHealth[s.vid].ok);
  const idx = liveStreams.findIndex(s => s.vid === current.vid);
  const prev = liveStreams[(idx - 1 + liveStreams.length) % liveStreams.length];
  ytRemoveStream(current.vid);
  ytAddStream({vid:prev.vid, name:prev.name, desc:prev.desc, cat:prev.cat});
  toast(`Now playing: ${prev.name}`, "info");
}

export function useYtStreams() { const[s,setS]=useState(_ytStreams.map(x=>({...x}))); useEffect(()=>{_ytPlaySubs.push(setS);return()=>{_ytPlaySubs=_ytPlaySubs.filter(fn=>fn!==setS)}},[]);return s; }

// ── YouTube Health Check ────────────────────────────────────────────
let _ytHealth = {}; // vid -> (ok, lastCheck, reason)
let _ytHealthSubs = [];
let _ytCheckProgress = {active:false, phase:'', done:0, total:0};
let _ytCheckSubs = [];
function ytHealthNotify() { _ytHealthSubs.forEach(fn => fn({..._ytHealth})); }
function ytCheckNotify() { _ytCheckSubs.forEach(fn => fn({..._ytCheckProgress})); }

export function useYtHealth() {
  const [h,setH] = useState({..._ytHealth});
  useEffect(() => { _ytHealthSubs.push(setH); return () => { _ytHealthSubs = _ytHealthSubs.filter(fn=>fn!==setH); }; }, []);
  return h;
}
export function useYtCheckProgress() {
  const [p,setP] = useState({..._ytCheckProgress});
  useEffect(() => { _ytCheckSubs.push(setP); return () => { _ytCheckSubs = _ytCheckSubs.filter(fn=>fn!==setP); }; }, []);
  return p;
}

// ── YouTube Stats (Data API) ────────────────────────────────────────
// YouTube Data API stats — fetches live viewer count, view count, etc.
let _ytStats = {}; // vid -> {views, viewers, title, live, lastFetch}
let _ytStatsSubs = [];
function ytStatsNotify() { _ytStatsSubs.forEach(fn => fn({..._ytStats})); }
export function useYtStats() {
  const [s,setS] = useState({..._ytStats});
  useEffect(() => { _ytStatsSubs.push(setS); return () => { _ytStatsSubs = _ytStatsSubs.filter(fn=>fn!==setS); }; }, []);
  return s;
}

export async function fetchYtStats(apiKey) {
  if (!apiKey) return;
  dlog('info','youtube','Fetching YouTube Data API stats...');
  const vids = YT_STREAMS.map(s => s.vid);
  let fetched = 0;
  for (let i = 0; i < vids.length; i += 50) {
    const batch = vids.slice(i, i + 50).join(',');
    try {
      const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,liveStreamingDetails,contentDetails&id=${batch}&key=${apiKey}`, { signal: AbortSignal.timeout(12000) });
      if (!resp.ok) {
        const errBody = await resp.text().catch(()=>'');
        dlog('warn','youtube',`Stats API error ${resp.status}: ${errBody.slice(0,200)}`);
        break;
      }
      const data = await resp.json();
      for (const item of (data.items || [])) {
        const vid = item.id;
        const snippet = item.snippet || {};
        const stats = item.statistics || {};
        const lsd = item.liveStreamingDetails || {};
        const cd = item.contentDetails || {};

        // Determine stream type using multiple signals
        const broadcastContent = snippet.liveBroadcastContent; // "live", "upcoming", "none"
        const hasLiveDetails = !!lsd.actualStartTime;
        const hasConcurrentViewers = !!lsd.concurrentViewers;
        const duration = cd.duration || ''; // ISO 8601 e.g. "PT0S" for live, "PT3H12M" for video
        const isLiveNow = broadcastContent === 'live';
        const isUpcoming = broadcastContent === 'upcoming';
        // PT0S or no duration = live stream; anything else = video
        const durationIsZero = duration === 'PT0S' || duration === 'P0D' || duration === '';
        const isLikelyStream = isLiveNow || (hasLiveDetails && durationIsZero) || hasConcurrentViewers;
        const detectedType = isLiveNow ? 'live' : isUpcoming ? 'upcoming' : isLikelyStream ? 'live' : 'video';

        // Parse duration for display
        let durationSec = 0;
        const durMatch = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        if (durMatch) durationSec = (parseInt(durMatch[1]||0)*3600) + (parseInt(durMatch[2]||0)*60) + parseInt(durMatch[3]||0);

        _ytStats[vid] = {
          views: parseInt(stats.viewCount || 0),
          likes: parseInt(stats.likeCount || 0),
          viewers: parseInt(lsd.concurrentViewers || 0),
          title: snippet.title || '',
          live: isLiveNow,
          upcoming: isUpcoming,
          detectedType,
          durationSec,
          durationRaw: duration,
          channelTitle: snippet.channelTitle || '',
          publishedAt: snippet.publishedAt || '',
          lastFetch: Date.now(),
        };
        fetched++;

        // Mark non-existent or ended live streams
        if (broadcastContent === 'none' && !stats.viewCount && hasLiveDetails && !hasConcurrentViewers) {
          _ytHealth[vid] = { ok: false, lastCheck: Date.now(), reason: 'Stream ended (API)' };
        }

        dlog('debug','youtube',`API: ${snippet.title?.slice(0,30)} \u2014 ${detectedType}${isLiveNow?' [LIVE]':''}${hasConcurrentViewers?` [${lsd.concurrentViewers} watching]`:''} views:${fmtNum(parseInt(stats.viewCount||0))}`);
      }
      // Videos not in response are deleted/private
      const returned = new Set((data.items || []).map(i => i.id));
      batch.split(',').forEach(vid => {
        if (!returned.has(vid)) {
          _ytHealth[vid] = { ok: false, lastCheck: Date.now(), reason: 'Not found (API)' };
        }
      });
    } catch(e) {
      dlog('warn','youtube',`Stats fetch failed: ${e.message}`);
    }
  }
  dlog('info','youtube',`Stats fetched: ${fetched} videos (${Object.values(_ytStats).filter(s=>s.live).length} live, ${Object.values(_ytStats).filter(s=>s.detectedType==='video').length} videos)`);
  ytStatsNotify();
  ytHealthNotify();
}

export function fmtNum(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}
export function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s/60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m/60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h/24); if (d < 30) return d + 'd ago';
  const mo = Math.floor(d/30); if (mo < 12) return mo + 'mo ago';
  return Math.floor(mo/12) + 'y ago';
}

// ── Favorites ───────────────────────────────────────────────────────
// Favorites system — stored in localStorage
const FAV_KEY = 'vorra-favs';
let _favs = { yt: [], soma: [] };
try { const raw = localStorage.getItem(FAV_KEY); if (raw) _favs = JSON.parse(raw); } catch(_e) {}

// [STATE] Custom user-added streams — persisted in localStorage
const CUSTOM_KEY = 'vorra-custom-streams';
let _customStreams = [];
try { const raw = localStorage.getItem(CUSTOM_KEY); if (raw) _customStreams = JSON.parse(raw); } catch(_e) {}
let _customSubs = [];
function customNotify() { localStorage.setItem(CUSTOM_KEY, JSON.stringify(_customStreams)); _customSubs.forEach(fn => fn([..._customStreams])); }
export function useCustomStreams() {
  const [s, setS] = useState([..._customStreams]);
  useEffect(() => { _customSubs.push(setS); return () => { _customSubs = _customSubs.filter(fn => fn !== setS); }; }, []);
  return s;
}
export function addCustomStream(vid, name) {
  if (_customStreams.some(s => s.vid === vid)) return;
  _customStreams.push({ vid, name: name || `Custom ${vid.slice(0,6)}`, addedAt: Date.now() });
  customNotify();
  dlog('info','youtube',`Custom stream added: ${vid}`);
}
export function removeCustomStream(vid) {
  _customStreams = _customStreams.filter(s => s.vid !== vid);
  customNotify();
  dlog('info','youtube',`Custom stream removed: ${vid}`);
}
let _favSubs = [];
function favNotify() { localStorage.setItem(FAV_KEY, JSON.stringify(_favs)); _favSubs.forEach(fn => fn({..._favs})); }
export function useFavs() {
  const [f,setF] = useState({..._favs});
  useEffect(() => { _favSubs.push(setF); return () => { _favSubs = _favSubs.filter(fn=>fn!==setF); }; }, []);
  return f;
}
export function toggleFav(type, id) {
  const list = _favs[type] || [];
  if (list.includes(id)) { _favs[type] = list.filter(x => x !== id); } else { _favs[type] = [...list, id]; }
  dlog('debug','ui',`Favorite ${list.includes(id)?'removed':'added'}: ${type}/${id}`);
  favNotify();
}

// ── Embed Test ──────────────────────────────────────────────────────
// Pre-flight embed test — yt-ready often fires BEFORE yt-error (150)
// So we wait 700ms after ready to check if an error follows
export function ytEmbedTest(vid) {
  return new Promise((resolve) => {
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none';
    document.body.appendChild(container);
    const iframe = document.createElement('iframe');
    iframe.src = `http://127.0.0.1:19532/yt-proxy?v=${vid}&mute=1`;
    iframe.style.cssText = 'width:1px;height:1px;border:none';
    let settled = false;
    let readyData = null;
    const cleanup = () => { if (container.parentNode) container.parentNode.removeChild(container); };
    const handler = (e) => {
      if (!e.data || typeof e.data !== 'object' || e.data.vid !== vid) return;
      if (settled) return;
      if (e.data.type === 'yt-error') {
        settled = true; window.removeEventListener('message', handler); cleanup();
        resolve({ ok: false, reason: `Error ${e.data.code}` });
      }
      if (e.data.type === 'yt-ready') {
        readyData = e.data;
        // Don't resolve yet — wait for potential error 150
        setTimeout(() => {
          if (settled) return; // error already fired
          settled = true; window.removeEventListener('message', handler); cleanup();
          const isLive = readyData.isLive;
          const dur = readyData.duration || 0;
          const detectedType = isLive ? "live" : dur > 0 ? "video" : "unknown";
          if (!_ytStats[vid]) _ytStats[vid] = {};
          _ytStats[vid].live = isLive;
          _ytStats[vid].duration = dur;
          _ytStats[vid].detectedType = detectedType;
          resolve({ ok: true, reason: '', type: detectedType });
        }, 400);
      }
    };
    window.addEventListener('message', handler);
    container.appendChild(iframe);
    setTimeout(() => { if (!settled) { settled = true; window.removeEventListener('message', handler); cleanup(); resolve({ ok: true, reason: '' }); } }, 8000);
  });
}

export async function checkYtStreamHealth() {
  dlog('info','radio',`Checking ${YT_STREAMS.length} YouTube streams via API...`);
  _ytCheckProgress = { active: true, phase: 'Fetching stream data...', done: 0, total: YT_STREAMS.length };
  ytCheckNotify();

  // Use YouTube Data API for fast batch verification (50 per call)
  let apiKey;
  try { apiKey = getYtApiKey(JSON.parse(localStorage.getItem('vorra-v1') || '{}')); } catch(_) { apiKey = ""; }
  if (!apiKey) { _ytCheckProgress = { active: false, phase: 'No API key — add one in Settings', done: 0, total: 0 }; ytCheckNotify(); return; }

  const allVids = YT_STREAMS.map(s => s.vid);
  let up = 0, down = 0, checked = new Set();

  for (let i = 0; i < allVids.length; i += 50) {
    const batch = allVids.slice(i, i + 50);
    try {
      const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status,snippet&id=${batch.join(',')}&key=${apiKey}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const data = await r.json();
        const foundIds = new Set((data.items || []).map(it => it.id));
        batch.forEach(vid => {
          checked.add(vid);
          if (foundIds.has(vid)) {
            const item = data.items.find(it => it.id === vid);
            const embeddable = item?.status?.embeddable !== false;
            _ytHealth[vid] = { ok: embeddable, lastCheck: Date.now(), reason: embeddable ? '' : 'Embedding disabled' };
            if (embeddable) up++; else down++;
          } else {
            _ytHealth[vid] = { ok: false, lastCheck: Date.now(), reason: 'Video not found or private' };
            down++;
          }
        });
      }
    } catch(e) {
      dlog('warn','radio',`API batch failed: ${e.message}`);
    }
    _ytCheckProgress.done = Math.min(i + 50, allVids.length);
    ytCheckNotify();
  }

  // Mark unchecked streams as presumed ok (API might have failed)
  allVids.forEach(vid => {
    if (!checked.has(vid) && !_ytHealth[vid]) {
      _ytHealth[vid] = { ok: true, lastCheck: Date.now(), reason: '' };
      up++;
    }
  });

  dlog('info','radio',`Health check: ${up} available, ${down} unavailable (${YT_STREAMS.length} total)`);
  _ytCheckProgress = { active: false, phase: 'Complete', done: up + down, total: up + down };
  ytCheckNotify();
  ytHealthNotify();
}

// ── Message Listener (error/ready/state from proxy iframes) ─────────
// Listen for YouTube error/ready messages from proxy iframes
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    // Validate origin — only accept messages from our local server
    if (e.origin !== 'http://127.0.0.1:19532' && e.origin !== window.location.origin) return;
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'yt-error') {
      const code = e.data.code;
      const vid = e.data.vid;
      const reasons = {2:"Invalid video ID",5:"HTML5 error",100:"Video not found",101:"Embedding disabled",150:"Embedding disabled"};
      const reason = reasons[code] || `Error ${code}`;
      dlog('warn','youtube',`Playback error: ${reason} (code ${code}) for ${vid}`);
      _ytHealth[vid] = { ok: false, lastCheck: Date.now(), reason };
      ytHealthNotify();
      // Auto-remove errored stream
      const stream = _ytStreams.find(s => s.vid === vid);
      if (stream) {
        toast(`Stream unavailable: ${stream.name} \u2014 ${reason}`, "warn");
        ytRemoveStream(vid);
      }
    }
    if (e.data.type === 'yt-ready') {
      const vid = e.data.vid;
      const isLive = e.data.isLive;
      const dur = e.data.duration || 0;
      const detectedType = isLive ? "live" : dur > 0 ? "video" : "unknown";
      dlog('info','youtube',`Player ready: ${vid} (${detectedType}${isLive?' \u2014 LIVE':dur>0?` \u2014 ${Math.round(dur/60)}min`:''})`);
      _ytHealth[vid] = { ok: true, lastCheck: Date.now(), reason: "" };
      if (!_ytStats[vid]) _ytStats[vid] = {};
      _ytStats[vid].live = isLive;
      _ytStats[vid].duration = dur;
      _ytStats[vid].detectedType = detectedType;
      ytStatsNotify();
      ytHealthNotify();
      // If this stream is supposed to be paused, immediately re-send pause
      const stream = _ytStreams.find(s => s.vid === vid);
      if (stream && stream.paused) {
        document.querySelectorAll(`iframe[data-yt-slot="${stream.slot}"]`).forEach(f => {
          f.contentWindow?.postMessage('yt-pause', '*');
        });
      }
    }
    // Catch auto-play on paused streams (YouTube state 1 = PLAYING)
    if (e.data.type === 'yt-state' && e.data.state === 1) {
      const stream = _ytStreams.find(s => s.vid === e.data.vid);
      if (stream && stream.paused) {
        document.querySelectorAll(`iframe[data-yt-slot="${stream.slot}"]`).forEach(f => {
          f.contentWindow?.postMessage('yt-pause', '*');
        });
      }
    }
  });
}

// ── Auto-start health/stats checks ─────────────────────────────────
setTimeout(checkYtStreamHealth, 3000);
setInterval(checkYtStreamHealth, 10 * 60 * 1000); // every 10 min

// Fetch YouTube stats on startup (5s delay) and every 10 min
setTimeout(() => {
  try {
    const d = JSON.parse(localStorage.getItem('vorra-v1') || '{}');
    const k = getYtApiKey(d);
    if (k) fetchYtStats(k);
  } catch(_e) { /* no key */ }
}, 5000);
setInterval(() => {
  try {
    const d = JSON.parse(localStorage.getItem('vorra-v1') || '{}');
    const k = getYtApiKey(d);
    if (k) fetchYtStats(k);
  } catch(_e) { /* no key */ }
}, 10 * 60 * 1000);
