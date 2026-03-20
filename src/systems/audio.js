// SomaFM Audio System — streaming radio with crossfade + Web Audio API analyser

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";
import { toast } from "./toast.js";

// Lazy import to avoid circular dependency — youtube.js imports from audio.js
let _getYtStreams = () => [];
export function _setYtStreamsGetter(fn) { _getYtStreams = fn; }

// ── Station Database ────────────────────────────────────────────────
export const STATIONS = [
  //  Lo-fi & Chill
  { id:"gs",  cat:"lofi",    name:"Groove Salad",        emoji:"🥗", desc:"Ambient/downtempo grooves",     url:"https://ice1.somafm.com/groovesalad-128-mp3" },
  { id:"gsc", cat:"lofi",    name:"Groove Salad Classic", emoji:"🌿", desc:"The original downtempo",        url:"https://ice1.somafm.com/gsclassic-128-mp3" },
  { id:"lush",cat:"lofi",    name:"Lush",                emoji:"🌸", desc:"Sensuous electronica",          url:"https://ice1.somafm.com/lush-128-mp3" },
  { id:"cliq",cat:"lofi",    name:"Cliq Hop",            emoji:"🎧", desc:"Beats + clicks + bass",         url:"https://ice1.somafm.com/cliqhop-128-mp3" },
  { id:"flu", cat:"lofi",    name:"Fluid",               emoji:"💧", desc:"Instrumental hip-hop",          url:"https://ice1.somafm.com/fluid-128-mp3" },
  { id:"sl2", cat:"lofi",    name:"Seven Inch Soul",     emoji:"🎶", desc:"60s/70s soul 45s",              url:"https://ice1.somafm.com/7soul-128-mp3" },
  //  Ambient & Drone
  { id:"drn", cat:"ambient", name:"Drone Zone",          emoji:"🌌", desc:"Atmospheric textures & drones", url:"https://ice1.somafm.com/dronezone-128-mp3" },
  { id:"spc", cat:"ambient", name:"Space Station",       emoji:"🛸", desc:"Spaced-out ambient & mid-tempo",url:"https://ice1.somafm.com/spacestation-128-mp3" },
  { id:"dsp", cat:"ambient", name:"Deep Space One",      emoji:"🌠", desc:"Deep ambient electronica",      url:"https://ice1.somafm.com/deepspaceone-128-mp3" },
  { id:"mis", cat:"ambient", name:"Mission Control",     emoji:"🚀", desc:"NASA comms + ambient",          url:"https://ice1.somafm.com/missioncontrol-128-mp3" },
  { id:"vap", cat:"ambient", name:"Vaporwaves",          emoji:"🌊", desc:"Vaporwave aesthetics",          url:"https://ice1.somafm.com/vaporwaves-128-mp3" },
  { id:"n5md",cat:"ambient", name:"n5MD Radio",          emoji:"🎹", desc:"Post-rock + ambient",           url:"https://ice1.somafm.com/n5md-128-mp3" },
  { id:"trp", cat:"ambient", name:"The Trip",            emoji:"🌀", desc:"Progressive + psychedelic",     url:"https://ice1.somafm.com/thetrip-128-mp3" },
  { id:"dmm", cat:"ambient", name:"Doomed",              emoji:"😈", desc:"Dark ambient + industrial",     url:"https://ice1.somafm.com/doomed-128-mp3" },
  { id:"syn", cat:"ambient", name:"Synphaera",           emoji:"🔮", desc:"Atmospheric + experimental",    url:"https://ice1.somafm.com/synphaera-128-mp3" },
  { id:"scn", cat:"ambient", name:"SF 10-33",            emoji:"📻", desc:"Ambient scanner frequencies",   url:"https://ice1.somafm.com/sf1033-128-mp3" },
  //  Jazz & Lounge
  { id:"ill", cat:"jazz",    name:"Illinois Street",     emoji:"🍸", desc:"Classic cocktail lounge",       url:"https://ice1.somafm.com/illstreet-128-mp3" },
  { id:"sec", cat:"jazz",    name:"Secret Agent",        emoji:"🕵️", desc:"Bond soundtrack + lounge",      url:"https://ice1.somafm.com/secretagent-128-mp3" },
  { id:"son", cat:"jazz",    name:"Sonic Universe",      emoji:"🎷", desc:"Jazz from across the universe", url:"https://ice1.somafm.com/sonicuniverse-128-mp3" },
  { id:"bgl", cat:"jazz",    name:"BAGeL Radio",         emoji:"🥯", desc:"Eclectic blend of everything",  url:"https://ice1.somafm.com/bagel-128-mp3" },
  { id:"tki", cat:"jazz",    name:"Tiki Time",           emoji:"🍹", desc:"Exotic island + lounge",        url:"https://ice1.somafm.com/tikitime-128-mp3" },
  //  World & Folk
  { id:"goa", cat:"world",   name:"Suburbs of Goa",      emoji:"🕉️", desc:"Desi + world beat vibes",      url:"https://ice1.somafm.com/suburbsofgoa-128-mp3" },
  { id:"twv", cat:"world",   name:"ThistleRadio",        emoji:"🌺", desc:"Celtic + Scottish folk",        url:"https://ice1.somafm.com/thistle-128-mp3" },
  { id:"ful", cat:"world",   name:"Folk Forward",        emoji:"🪕", desc:"Modern + progressive folk",     url:"https://ice1.somafm.com/folkfwd-128-mp3" },
  { id:"bbl", cat:"world",   name:"Boot Liquor",         emoji:"🤠", desc:"Americana for reading + coding",url:"https://ice1.somafm.com/bootliquor-128-mp3" },
  { id:"dup", cat:"world",   name:"Dub Step Beyond",     emoji:"🔈", desc:"Dubstep + bass music",          url:"https://ice1.somafm.com/dubstep-128-mp3" },
  { id:"reg", cat:"world",   name:"Heavyweight Reggae",  emoji:"🟢", desc:"Roots reggae + dub",            url:"https://ice1.somafm.com/reggae-128-mp3" },
  //  Classical & Focus
  { id:"brk", cat:"classical",name:"Baroque",            emoji:"🎻", desc:"Bach, Vivaldi & baroque era",   url:"https://ice1.somafm.com/baroque-128-mp3" },
  //  Electronic & Energy
  { id:"ppl", cat:"energy",  name:"PopTron",             emoji:"⚡", desc:"Electropop + synthwave",        url:"https://ice1.somafm.com/poptron-128-mp3" },
  { id:"btb", cat:"energy",  name:"Beat Blender",        emoji:"🔊", desc:"Deep house + breaks",           url:"https://ice1.somafm.com/beatblender-128-mp3" },
  { id:"ind", cat:"energy",  name:"Indie Pop Rocks",     emoji:"🎸", desc:"Indie pop + rock",              url:"https://ice1.somafm.com/indiepop-128-mp3" },
  { id:"bck", cat:"energy",  name:"Black Rock FM",       emoji:"🔥", desc:"From Burning Man",              url:"https://ice1.somafm.com/brfm-128-mp3" },
  { id:"shr", cat:"energy",  name:"Digitalis",           emoji:"💊", desc:"IDM + glitch electronica",      url:"https://ice1.somafm.com/digitalis-128-mp3" },
  { id:"70s", cat:"energy",  name:"Left Coast 70s",      emoji:"🌅", desc:"Mellow 70s California vibes",   url:"https://ice1.somafm.com/seventies-128-mp3" },
  { id:"cvr", cat:"energy",  name:"Covers",              emoji:"🎤", desc:"Great covers of great songs",   url:"https://ice1.somafm.com/covers-128-mp3" },
  { id:"dfc", cat:"energy",  name:"DEF CON Radio",       emoji:"💀", desc:"Hacker conference music",       url:"https://ice1.somafm.com/defcon-128-mp3" },
  { id:"mtl", cat:"energy",  name:"Metal Detector",      emoji:"🤘", desc:"Heavy metal from all eras",     url:"https://ice1.somafm.com/metal-128-mp3" },
  { id:"u80", cat:"energy",  name:"Underground 80s",     emoji:"📼", desc:"Post-punk + new wave + early electro", url:"https://ice1.somafm.com/u80s-128-mp3" },
  { id:"chll",cat:"energy",  name:"Chillits",            emoji:"❄️", desc:"Chilled trippy grooves",        url:"https://ice1.somafm.com/chillits-128-mp3" },
  { id:"liv", cat:"energy",  name:"Live!",               emoji:"🎙️", desc:"Live performances + sessions",  url:"https://ice1.somafm.com/live-128-mp3" },
  //  Holiday & Seasonal
  { id:"xms", cat:"holiday", name:"Christmas Lounge",    emoji:"🎄", desc:"Holiday cocktail lounge",       url:"https://ice1.somafm.com/christmas-128-mp3" },
  { id:"xmr", cat:"holiday", name:"Christmas Rocks!",    emoji:"🎅", desc:"Rocking around the tree",       url:"https://ice1.somafm.com/xmasrocks-128-mp3" },
  { id:"xsf", cat:"holiday", name:"Xmas in Frisco",      emoji:"🌉", desc:"SF holiday vibes",              url:"https://ice1.somafm.com/xmasinfrisco-128-mp3" },
  { id:"jly", cat:"holiday", name:"Jolly Ol' Soul",      emoji:"⛄", desc:"Holiday soul & R&B",            url:"https://ice1.somafm.com/jollysoul-128-mp3" },
];

export const STATION_CATS = [
  { key:"lofi", label:"Lo-fi & Chill", iconKey:"CatLofi" },
  { key:"ambient", label:"Ambient & Drone", iconKey:"CatAmbient" },
  { key:"jazz", label:"Jazz & Lounge", iconKey:"CatJazz" },
  { key:"world", label:"World & Folk", iconKey:"CatWorld" },
  { key:"classical", label:"Classical & Focus", iconKey:"CatClassical" },
  { key:"energy", label:"Electronic & Energy", iconKey:"CatEnergy" },
  { key:"holiday", label:"Holiday & Seasonal", iconKey:"CatHoliday" },
];

// ── Station Health Check — periodic ping every 5 min ────────────────
let _stationHealth = {}; // id -> (ok, lastCheck)
let _healthSubs = [];
function healthNotify() { _healthSubs.forEach(fn => fn({..._stationHealth})); }

export function useStationHealth() {
  const [h,setH] = useState({..._stationHealth});
  useEffect(() => { _healthSubs.push(setH); return () => { _healthSubs = _healthSubs.filter(fn=>fn!==setH); }; }, []);
  return h;
}

export async function checkStationHealth() {
  dlog('info','radio','Running station health check...');
  let upCount = 0, downCount = 0;
  for (const station of STATIONS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(station.url, { method: 'HEAD', signal: controller.signal, mode: 'no-cors' });
      clearTimeout(timeout);
      _stationHealth[station.id] = { ok: true, lastCheck: Date.now() };
      upCount++;
    } catch(_e) {
      // no-cors HEAD will opaque-respond (type "opaque") which is fine — means server is reachable
      // Only truly dead if AbortError/network error
      if (_e.name === 'AbortError') {
        _stationHealth[station.id] = { ok: false, lastCheck: Date.now() };
        downCount++;
      } else {
        // Opaque response from no-cors is actually a success
        _stationHealth[station.id] = { ok: true, lastCheck: Date.now() };
        upCount++;
      }
    }
  }
  dlog('info','radio',`Health check done: ${upCount} up, ${downCount} down`);
  healthNotify();
}

// Run on load (3s delay) + every 10 min
setTimeout(checkStationHealth, 3000);
setInterval(checkStationHealth, 10 * 60 * 1000);

// ── Audio Playback Engine ───────────────────────────────────────────
let _audioEl = null; // Current HTMLAudioElement
let _audioFading = null; // Previous element being faded out
let _audioCtx = null;
let _audioAnalyser = null;
let _audioSource = null;
let _audioState = { playing: null, volume: 0.6, paused: false, levels: new Array(16).fill(0) };
let _audioSubs = [];
function audioNotify() { _audioSubs.forEach(fn => fn({..._audioState})); }

// Connect analyser to audio element for real-time frequency data
function _connectAnalyser(el) {
  try {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioSource) { try { _audioSource.disconnect(); } catch(_e) {} }
    _audioSource = _audioCtx.createMediaElementSource(el);
    _audioAnalyser = _audioCtx.createAnalyser();
    _audioAnalyser.fftSize = 64;
    _audioAnalyser.smoothingTimeConstant = 0.7;
    _audioSource.connect(_audioAnalyser);
    _audioAnalyser.connect(_audioCtx.destination);
  } catch(_e) { dlog('warn','ui',`Analyser connect failed: ${_e.message}`); }
}

// Poll frequency data and update levels
let _levelInterval = null;
function _startLevelPoll() {
  if (_levelInterval) clearInterval(_levelInterval);
  _levelInterval = setInterval(() => {
    if (_audioAnalyser && _audioState.playing && !_audioState.paused) {
      const data = new Uint8Array(_audioAnalyser.frequencyBinCount);
      _audioAnalyser.getByteFrequencyData(data);
      const levels = [];
      const binCount = data.length;
      for (let i = 0; i < 16; i++) {
        const idx = Math.floor((i / 16) * binCount);
        const next = Math.min(idx + 1, binCount - 1);
        const avg = (data[idx] + data[next]) / 2;
        levels.push(Math.round((avg / 255) * 100));
      }
      _audioState.levels = levels;
      audioNotify();
    } else if (_getYtStreams().length > 0 && !_getYtStreams().every(s => s.paused)) {
      // Trigger re-render for YouTube simulated visualizer
      _audioState.levels = new Array(16).fill(0);
      audioNotify();
    } else if ((_audioState.playing && _audioState.paused) || (_getYtStreams().length > 0 && _getYtStreams().every(s => s.paused))) {
      _audioState.levels = new Array(16).fill(0);
      audioNotify();
    }
  }, 60);
}
_startLevelPoll();

// Smoothly fade volume from current to target over duration ms
function _audioFade(el, fromVol, toVol, duration, onDone) {
  if (!el) { if (onDone) onDone(); return; }
  const steps = 30;
  const stepTime = duration / steps;
  const stepVol = (toVol - fromVol) / steps;
  let current = fromVol;
  let step = 0;
  const iv = setInterval(() => {
    step++;
    current += stepVol;
    try { el.volume = Math.max(0, Math.min(1, current)); } catch(_e) {}
    if (step >= steps) {
      clearInterval(iv);
      try { el.volume = Math.max(0, Math.min(1, toVol)); } catch(_e) {}
      if (onDone) onDone();
    }
  }, stepTime);
  return iv;
}

export function audioPlay(stationId) {
  const station = STATIONS.find(s => s.id === stationId);
  if (!station) { dlog('warn','audio',`Station not found: ${stationId}`); return; }
  dlog('info','audio',`Playing: ${station.name} [${station.id}] → ${station.url}`);

  // SomaFM and YouTube can now play simultaneously (combined mode)

  // Crossfade: fade out current station
  if (_audioEl && _audioState.playing) {
    const oldStation = STATIONS.find(s => s.id === _audioState.playing);
    dlog('debug','audio',`Crossfading from: ${oldStation?.name || _audioState.playing}`);
    const old = _audioEl;
    _audioFading = old;
    _audioFade(old, old.volume, 0, 1200, () => {
      try { old.pause(); old.src = ""; } catch(_e) {}
      if (_audioFading === old) _audioFading = null;
    });
  }

  // Start new station at volume 0, fade in
  _audioEl = new Audio(station.url);
  _audioEl.volume = 0;
  _audioEl.crossOrigin = "anonymous";
  _connectAnalyser(_audioEl);
  _audioEl.play().then(() => {
    _audioState.playing = stationId;
    _audioState.paused = false;
    _stationHealth[stationId] = { ok: true, lastCheck: Date.now() };
    audioNotify();
    healthNotify();
    dlog('info','audio',`✓ Now playing: ${station.name} — fading in over 1.5s`);
    _audioFade(_audioEl, 0, _audioState.volume, 1500);
  }).catch(e => {
    dlog('error','audio',`✗ Stream failed: ${station.name} — ${e.message}`);
    toast(`Couldn't connect to ${station.name}. May be offline.`, "warn");
    _stationHealth[stationId] = { ok: false, lastCheck: Date.now() };
    _audioState.playing = null;
    audioNotify();
    healthNotify();
  });
}

export function audioStop() {
  dlog('info','audio',`Stopping: ${_audioState.playing ? STATIONS.find(s=>s.id===_audioState.playing)?.name : 'nothing'}`);
  if (_audioEl) {
    const el = _audioEl;
    _audioFade(el, el.volume, 0, 800, () => {
      try { el.pause(); el.src = ""; } catch(_e) {}
    });
    _audioEl = null;
  }
  _audioState.playing = null;
  _audioState.paused = false;
  audioNotify();
}

export function audioToggle(stationId) {
  if (_audioState.playing === stationId && !_audioState.paused) audioStop();
  else if (_audioState.playing === stationId && _audioState.paused) audioPauseToggle();
  else audioPlay(stationId);
}

export function audioPauseToggle() {
  if (!_audioEl || !_audioState.playing) { dlog('debug','audio','Pause toggle: nothing playing'); return; }
  const station = STATIONS.find(s=>s.id===_audioState.playing);
  if (_audioState.paused) {
    dlog('info','audio',`Resuming: ${station?.name}`);
    _audioEl.play().catch(()=>{});
    _audioFade(_audioEl, 0, _audioState.volume, 600);
    _audioState.paused = false;
  } else {
    dlog('info','audio',`Pausing: ${station?.name}`);
    _audioFade(_audioEl, _audioEl.volume, 0, 400, () => { try { _audioEl.pause(); } catch(_e) {} });
    _audioState.paused = true;
  }
  audioNotify();
}

export function audioSetVolume(v) {
  _audioState.volume = v;
  if (_audioEl && !_audioState.paused) _audioEl.volume = v;
  audioNotify();
}

export function audioNext() {
  if (!_audioState.playing) return;
  const idx = STATIONS.findIndex(s => s.id === _audioState.playing);
  const next = STATIONS[(idx + 1) % STATIONS.length];
  dlog('info','audio',`Next: ${STATIONS[idx]?.name} → ${next.name}`);
  audioPlay(next.id);
  toast(`Now playing: ${next.name}`, "info");
}

export function audioPrev() {
  if (!_audioState.playing) return;
  const idx = STATIONS.findIndex(s => s.id === _audioState.playing);
  const prev = STATIONS[(idx - 1 + STATIONS.length) % STATIONS.length];
  dlog('info','audio',`Prev: ${STATIONS[idx]?.name} → ${prev.name}`);
  audioPlay(prev.id);
  toast(`Now playing: ${prev.name}`, "info");
}

export function useAudio() { const[s,setS]=useState({..._audioState}); useEffect(()=>{_audioSubs.push(setS);return()=>{_audioSubs=_audioSubs.filter(fn=>fn!==setS)}},[]);return s; }

// Re-export for level polling integration with YouTube
export function getAudioState() { return _audioState; }
export function triggerAudioNotify() { audioNotify(); }
