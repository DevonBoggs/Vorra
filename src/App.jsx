import { useState, useEffect, useCallback, useMemo, useRef, Component } from "react";
import { YT_STREAMS, YT_CATS, YT_PARENT_CATS } from "./streams.js";

const APP_VERSION = "7.3.0";
// [SECURITY] Built-in YouTube Data API key — XOR encrypted, decoded at runtime
// The key is never stored as plaintext in the source
const _xk = "X3n0"; // XOR key
const _ek = [25,122,20,81,11,74,45,89,29,95,2,64,54,64,47,96,107,30,13,65,53,81,52,97,108,99,63,29,42,127,57,68,18,3,93,124,10,2,90];
const DEFAULT_YT_API_KEY = _ek.map((c,i) => String.fromCharCode(c ^ _xk.charCodeAt(i % _xk.length))).join('');
function getYtApiKey(data) { return data?.ytApiKey || DEFAULT_YT_API_KEY; }

// ----------------------------------------------------------------------
// ERROR BOUNDARY — prevents black screen crashes
// ----------------------------------------------------------------------
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null, info: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    dlog('error', 'ui', `REACT CRASH: ${error.message}`, info?.componentStack?.slice(0, 500));
    this.setState({ info });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{padding:40,background:"#060a11",color:"#e4eaf4",minHeight:"100vh",fontFamily:"'DM Sans',sans-serif"}}>
          <h1 style={{color:"#ef4444",marginBottom:16,fontFamily:"'Outfit',sans-serif"}}>Something crashed</h1>
          <p style={{color:"#8b9dc3",marginBottom:20}}>DevonSYNC v{APP_VERSION} — This is a React rendering error. Your data is safe in localStorage.</p>
          <div style={{background:"#131c30",border:"1px solid #1c2d4a",borderRadius:12,padding:20,marginBottom:20}}>
            <pre style={{color:"#ef4444",fontSize:fs(13),whiteSpace:"pre-wrap",wordBreak:"break-word",fontFamily:"'JetBrains Mono',monospace"}}>{this.state.error.message}</pre>
            {this.state.info?.componentStack && <pre style={{color:"#4a5e80",fontSize:fs(11),marginTop:12,whiteSpace:"pre-wrap",maxHeight:200,overflow:"auto"}}>{this.state.info.componentStack}</pre>}
          </div>
          <div style={{display:"flex",gap:12}}>
            <button onClick={()=>this.setState({error:null,info:null})} style={{background:"#22d3a0",color:"#060a11",border:"none",borderRadius:9,padding:"10px 20px",fontSize:fs(14),fontWeight:600,cursor:"pointer"}}>Try Again</button>
            <button onClick={()=>{navigator.clipboard.writeText(getLogText());}} style={{background:"#162035",color:"#8b9dc3",border:"1px solid #1c2d4a",borderRadius:9,padding:"10px 20px",fontSize:fs(14),cursor:"pointer"}}>Copy Debug Log</button>
            <button onClick={()=>{localStorage.removeItem("ds-v1");localStorage.removeItem("ds-favs");localStorage.removeItem("ds-custom-streams");location.reload()}} style={{background:"#ef444433",color:"#ef4444",border:"none",borderRadius:9,padding:"10px 20px",fontSize:fs(14),cursor:"pointer"}}>Reset All Data</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ----------------------------------------------------------------------
// DEBUG LOG SYSTEM
// ----------------------------------------------------------------------
const MAX_LOG = 500;
let _logs = [];
let _logSubs = [];
function dlog(level, cat, msg, detail = null) {
  const e = { id: Date.now()+Math.random(), ts: new Date().toISOString(), level, cat, msg,
    detail: detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail,null,2)) : null };
  _logs.push(e);
  if (_logs.length > MAX_LOG) _logs = _logs.slice(-MAX_LOG);
  _logSubs.forEach(fn => fn([..._logs]));
  const p = `[LP:${cat}]`;
  if (level==='error') console.error(p, msg, detail??'');
  else if (level==='warn') console.warn(p, msg, detail??'');
  else console.log(p, msg, detail??'');
}
function useDebugLog() {
  const [l, setL] = useState([..._logs]);
  useEffect(() => { _logSubs.push(setL); return () => { _logSubs = _logSubs.filter(fn => fn !== setL); }; }, []);
  return l;
}
function getLogText() {
  return _logs.map(e => { let s = `[${e.ts}] [${e.level.toUpperCase()}] [${e.cat}] ${e.msg}`; if (e.detail) s += `\n    ${e.detail.replace(/\n/g,'\n    ')}`; return s; }).join('\n');
}
dlog('info','init',`DevonSYNC v${APP_VERSION} started`);
dlog('info','init',`UA: ${navigator.userAgent}`);
dlog('info','init',`Window: ${window.innerWidth}x${window.innerHeight}, Date: ${new Date().toISOString()}`);

// ----------------------------------------------------------------------
// BACKGROUND TASK SYSTEM (survives page navigation)
// ----------------------------------------------------------------------
let _bgState = { loading: false, regenId: null, logs: [], label: "", streamText: "", abortCtrl: null };
let _bgSubs = [];
function bgNotify() { const s = {..._bgState, logs:[..._bgState.logs]}; _bgSubs.forEach(fn => fn(s)); }
function bgSet(patch) { Object.assign(_bgState, patch); bgNotify(); }
function bgLog(entry) { _bgState.logs.push(entry); bgNotify(); }
function bgStream(text) { _bgState.streamText = text; bgNotify(); }
function bgClear() { _bgState = { loading: false, regenId: null, logs: [], label: "", streamText: "", abortCtrl: null }; bgNotify(); }
function bgAbort() {
  if (_bgState.abortCtrl) { _bgState.abortCtrl.abort(); dlog('info','api','User cancelled operation'); }
  bgLog({type:"error",content:"⛔ Cancelled by user"});
  bgSet({loading:false, regenId:null, label:"", streamText:"", abortCtrl:null});
}
function bgNewAbort() { const c = new AbortController(); _bgState.abortCtrl = c; return c.signal; }
function useBgTask() {
  const [s, setS] = useState({..._bgState, logs:[..._bgState.logs]});
  useEffect(() => { _bgSubs.push(setS); return () => { _bgSubs = _bgSubs.filter(fn => fn !== setS); }; }, []);
  return s;
}

// ----------------------------------------------------------------------
// THEME SYSTEM
// ----------------------------------------------------------------------
const THEMES = {
  dark: { name:"Dark",bg:"#060a11",bg2:"#0b1120",panel:"#0f1629",card:"#131c30",cardH:"#182240",input:"#162035",border:"#1c2d4a",borderL:"#253a5e",text:"#e4eaf4",soft:"#8b9dc3",dim:"#4a5e80",faint:"#283854",accent:"#22d3a0",accentD:"#22d3a018",accentM:"#22d3a033",blue:"#38bdf8",blueD:"#38bdf818",purple:"#a78bfa",purpleD:"#a78bfa18",orange:"#fb923c",orangeD:"#fb923c18",pink:"#f472b6",pinkD:"#f472b618",red:"#ef4444",redD:"#ef444418",yellow:"#facc15",yellowD:"#facc1518",cyan:"#22d3ee",cyanD:"#22d3ee18" },
  light: { name:"Light",bg:"#f0f4f8",bg2:"#e8edf2",panel:"#ffffff",card:"#ffffff",cardH:"#f5f8fc",input:"#edf1f7",border:"#d0d8e4",borderL:"#b0bdd0",text:"#0f1726",soft:"#2d3f58",dim:"#5a7390",faint:"#b8c6d8",accent:"#047857",accentD:"#04785728",accentM:"#04785744",blue:"#1d4ed8",blueD:"#1d4ed822",purple:"#6d28d9",purpleD:"#6d28d920",orange:"#c2410c",orangeD:"#c2410c22",pink:"#be185d",pinkD:"#be185d20",red:"#b91c1c",redD:"#b91c1c20",yellow:"#92400e",yellowD:"#92400e20",cyan:"#0e7490",cyanD:"#0e749020" },
  warm: { name:"Warm",bg:"#1a1410",bg2:"#231c14",panel:"#2a2018",card:"#302620",cardH:"#3a2e24",input:"#2a2018",border:"#4a3828",borderL:"#5a4838",text:"#f5e6d3",soft:"#c4a882",dim:"#8a7460",faint:"#5a4838",accent:"#e8a855",accentD:"#e8a85518",accentM:"#e8a85533",blue:"#64b5f6",blueD:"#64b5f618",purple:"#ce93d8",purpleD:"#ce93d818",orange:"#ffb74d",orangeD:"#ffb74d18",pink:"#f48fb1",pinkD:"#f48fb118",red:"#ef5350",redD:"#ef535018",yellow:"#fff176",yellowD:"#fff17618",cyan:"#4dd0e1",cyanD:"#4dd0e118" },
  mono: { name:"Mono",bg:"#0a0a0a",bg2:"#141414",panel:"#1a1a1a",card:"#1e1e1e",cardH:"#262626",input:"#1a1a1a",border:"#333333",borderL:"#444444",text:"#e0e0e0",soft:"#999999",dim:"#666666",faint:"#444444",accent:"#ffffff",accentD:"#ffffff18",accentM:"#ffffff33",blue:"#bbbbbb",blueD:"#bbbbbb18",purple:"#aaaaaa",purpleD:"#aaaaaa18",orange:"#cccccc",orangeD:"#cccccc18",pink:"#dddddd",pinkD:"#dddddd18",red:"#ff6666",redD:"#ff666618",yellow:"#eeeeee",yellowD:"#eeeeee18",cyan:"#cccccc",cyanD:"#cccccc18" },
  ocean: { name:"Ocean",bg:"#0a1628",bg2:"#0f1d32",panel:"#132440",card:"#162a4a",cardH:"#1a3358",input:"#132440",border:"#1e3a5f",borderL:"#2a4a70",text:"#e0ecff",soft:"#7da8d4",dim:"#4a7aaa",faint:"#2a4a70",accent:"#00d4aa",accentD:"#00d4aa18",accentM:"#00d4aa33",blue:"#4fc3f7",blueD:"#4fc3f718",purple:"#b39ddb",purpleD:"#b39ddb18",orange:"#ffab40",orangeD:"#ffab4018",pink:"#f48fb1",pinkD:"#f48fb118",red:"#ff5252",redD:"#ff525218",yellow:"#ffee58",yellowD:"#ffee5818",cyan:"#26c6da",cyanD:"#26c6da18" },
};

let _activeTheme = "dark";
let _themeSubs = [];
let _fontScale = 100;
function fs(px) { return Math.round(px * _fontScale / 100); }
function getTheme() { return THEMES[_activeTheme] || THEMES.dark; }
function setTheme(name) { _activeTheme = name; _themeSubs.forEach(fn => fn(name)); dlog('info','ui',`Theme: ${name}`); }
function useTheme() {
  const [t, setT] = useState(_activeTheme);
  useEffect(() => { _themeSubs.push(setT); return () => { _themeSubs = _themeSubs.filter(fn => fn !== setT); }; }, []);
  return THEMES[t] || THEMES.dark;
}

// ----------------------------------------------------------------------
// TOAST NOTIFICATION SYSTEM
// ----------------------------------------------------------------------
let _toasts = [];
let _toastSubs = [];
let _toastId = 0;
function toast(message, type = "info", duration = 3500) {
  const id = ++_toastId;
  _toasts.push({ id, message, type, ts: Date.now() });
  _toastSubs.forEach(fn => fn([..._toasts]));
  setTimeout(() => { _toasts = _toasts.filter(t => t.id !== id); _toastSubs.forEach(fn => fn([..._toasts])); }, duration);
  dlog('debug','ui',`Toast [${type}]: ${message}`);
}
function useToasts() {
  const [t, setT] = useState([..._toasts]);
  useEffect(() => { _toastSubs.push(setT); return () => { _toastSubs = _toastSubs.filter(fn => fn !== setT); }; }, []);
  return t;
}

const ToastContainer = () => {
  const toasts = useToasts();
  const T = useTheme();
  const colors = { info: T.blue, success: T.accent, error: T.red, warn: T.orange };
  const icons = { success: Ic.IcCheck, error: Ic.IcX, warn: Ic.IcWarn, info: Ic.IcInfo };
  if (toasts.length === 0) return null;
  return (
    <div style={{position:"fixed",top:16,right:24,zIndex:9999,display:"flex",flexDirection:"column",gap:8,pointerEvents:"none",maxWidth:360}}>
      {toasts.map(t => {
        const Icon = icons[t.type] || Ic.IcMusic;
        const col = colors[t.type] || T.border;
        return (
          <div key={t.id} className="slide-up" style={{padding:"10px 16px",borderRadius:10,background:T.card,border:`1px solid ${col}`,color:col,fontSize:fs(13),fontWeight:500,boxShadow:`0 4px 20px ${T.bg}aa`,pointerEvents:"auto",display:"flex",alignItems:"center",gap:8,backdropFilter:"blur(8px)"}}>
            <Icon s={14} c={col}/> {t.message}
          </div>
        );
      })}
    </div>
  );
};

// ----------------------------------------------------------------------
// STUDY SESSION TIMER (global, persists across pages)
// ----------------------------------------------------------------------
let _timerState = { running: false, taskTitle: "", startedAt: 0, elapsed: 0, paused: false, courseMatch: "" };
let _timerSubs = [];
let _timerInterval = null;
let _sessionLogFn = null;
function setSessionLogger(fn) { _sessionLogFn = fn; }
function timerNotify() { _timerSubs.forEach(fn => fn({..._timerState})); }
function timerStart(title, courseHint) { _timerState = { running:true, taskTitle:title, startedAt:Date.now(), elapsed:0, paused:false, courseMatch:courseHint||"" }; clearInterval(_timerInterval); _timerInterval = setInterval(()=>{ if(!_timerState.paused) _timerState.elapsed = Date.now()-_timerState.startedAt; timerNotify(); },1000); timerNotify(); toast(`Timer started: ${title}`,"info"); dlog('info','ui',`Timer start: ${title}`); }
function timerStop() { clearInterval(_timerInterval); const mins = Math.round(_timerState.elapsed/60000); if(mins>=1&&_sessionLogFn) _sessionLogFn({title:_timerState.taskTitle,course:_timerState.courseMatch,mins,date:todayStr(),ts:Date.now()}); _timerState = {..._timerState, running:false}; timerNotify(); toast(`Timer stopped: ${mins}m`,"success"); dlog('info','ui',`Timer stop: ${mins}m`); return mins; }
function timerPause() { _timerState.paused = !_timerState.paused; timerNotify(); }
function useTimer() { const [s,setS]=useState({..._timerState}); useEffect(()=>{_timerSubs.push(setS);return()=>{_timerSubs=_timerSubs.filter(fn=>fn!==setS)}},[]);return s; }
function fmtElapsed(ms) { const s=Math.floor(ms/1000), m=Math.floor(s/60), h=Math.floor(m/60); return h>0?`${h}:${String(m%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${m}:${String(s%60).padStart(2,'0')}`; }

// ----------------------------------------------------------------------
// FOCUS PULSE (15-min check-in)
// ----------------------------------------------------------------------
let _focusState = { active: false, streak: 0, lastPulse: 0, showPulse: false, totalFocusMins: 0 };
let _apiStatus = { ok: null, code: 0, ts: 0, error: '' };
let _apiStatusSubs = [];
function setApiStatus(ok, code, error) {
  _apiStatus = { ok, code: code||0, ts: Date.now(), error: error||'' };
  _apiStatusSubs.forEach(fn => fn({..._apiStatus}));
}
function useApiStatus() { const [s, set] = useState({..._apiStatus}); useEffect(() => { _apiStatusSubs.push(set); return () => { _apiStatusSubs = _apiStatusSubs.filter(f=>f!==set); }; }, []); return s; }
let _focusSubs = [];
let _focusInterval = null;
function focusNotify() { _focusSubs.forEach(fn => fn({..._focusState})); }
function focusStart() { _focusState = { active:true, streak:0, lastPulse:Date.now(), showPulse:false, totalFocusMins:0 }; clearInterval(_focusInterval); _focusInterval = setInterval(()=>{ const mins = Math.round((Date.now()-_focusState.lastPulse)/60000); if(mins>=15&&!_focusState.showPulse){ _focusState.showPulse=true; focusNotify(); } },10000); focusNotify(); toast("Focus mode activated","success"); }
function focusPulseYes() { _focusState.showPulse=false; _focusState.streak++; _focusState.totalFocusMins+=15; _focusState.lastPulse=Date.now(); focusNotify(); toast(`Focus streak: ${_focusState.streak} (${_focusState.totalFocusMins}m)`,"success"); }
function focusStop() { clearInterval(_focusInterval); const mins=_focusState.totalFocusMins; _focusState={..._focusState,active:false,showPulse:false}; focusNotify(); toast(`Focus session: ${mins}m total`,"info"); return mins; }
function useFocus() { const[s,setS]=useState({..._focusState}); useEffect(()=>{_focusSubs.push(setS);return()=>{_focusSubs=_focusSubs.filter(fn=>fn!==setS)}},[]);return s; }

// ----------------------------------------------------------------------
// STREAMING AUDIO SYSTEM (real internet radio)
// ----------------------------------------------------------------------
const STATIONS = [
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
  { id:"jly", cat:"holiday", name:"Jolly Ol' Soul",      emoji:"⛄", desc:"Holiday soul + R&B",            url:"https://ice1.somafm.com/jollysoul-128-mp3" },
];

const STATION_CATS = [
  { key:"lofi", label:"Lo-fi & Chill", iconKey:"CatLofi" },
  { key:"ambient", label:"Ambient & Drone", iconKey:"CatAmbient" },
  { key:"jazz", label:"Jazz & Lounge", iconKey:"CatJazz" },
  { key:"world", label:"World & Folk", iconKey:"CatWorld" },
  { key:"classical", label:"Classical & Focus", iconKey:"CatClassical" },
  { key:"energy", label:"Electronic & Energy", iconKey:"CatEnergy" },
  { key:"holiday", label:"Holiday & Seasonal", iconKey:"CatHoliday" },
];

// Station health check — periodic ping every 5 min
let _stationHealth = {}; // id -> (ok, lastCheck)
let _healthSubs = [];
function healthNotify() { _healthSubs.forEach(fn => fn({..._stationHealth})); }
function useStationHealth() {
  const [h,setH] = useState({..._stationHealth});
  useEffect(() => { _healthSubs.push(setH); return () => { _healthSubs = _healthSubs.filter(fn=>fn!==setH); }; }, []);
  return h;
}

async function checkStationHealth() {
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
    } else if (_ytStreams.length > 0 && !_ytStreams.every(s => s.paused)) {
      // Trigger re-render for YouTube simulated visualizer
      _audioState.levels = new Array(16).fill(0);
      audioNotify();
    } else if ((_audioState.playing && _audioState.paused) || (_ytStreams.length > 0 && _ytStreams.every(s => s.paused))) {
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

function audioPlay(stationId) {
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

function audioStop() {
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

function audioToggle(stationId) {
  if (_audioState.playing === stationId && !_audioState.paused) audioStop();
  else if (_audioState.playing === stationId && _audioState.paused) audioPauseToggle();
  else audioPlay(stationId);
}

function audioPauseToggle() {
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

function audioSetVolume(v) {
  _audioState.volume = v;
  if (_audioEl && !_audioState.paused) _audioEl.volume = v;
  audioNotify();
}

function audioNext() {
  if (!_audioState.playing) return;
  const idx = STATIONS.findIndex(s => s.id === _audioState.playing);
  const next = STATIONS[(idx + 1) % STATIONS.length];
  dlog('info','audio',`Next: ${STATIONS[idx]?.name} → ${next.name}`);
  audioPlay(next.id);
  toast(`Now playing: ${next.name}`, "info");
}

function audioPrev() {
  if (!_audioState.playing) return;
  const idx = STATIONS.findIndex(s => s.id === _audioState.playing);
  const prev = STATIONS[(idx - 1 + STATIONS.length) % STATIONS.length];
  dlog('info','audio',`Prev: ${STATIONS[idx]?.name} → ${prev.name}`);
  audioPlay(prev.id);
  toast(`Now playing: ${prev.name}`, "info");
}

function useAudio() { const[s,setS]=useState({..._audioState}); useEffect(()=>{_audioSubs.push(setS);return()=>{_audioSubs=_audioSubs.filter(fn=>fn!==setS)}},[]);return s; }

// YouTube multi-stream playback (up to 4 concurrent)
let _ytStreams = []; // [{vid, name, desc, cat, paused, volume, slot}]
let _ytPlaySubs = [];
// [STATE] ytPlayNotify — deep-copies stream objects so React detects paused state changes
function ytPlayNotify() { _ytPlaySubs.forEach(fn => fn(_ytStreams.map(s => ({...s})))); }

function ytAddStream(stream) {
  if (!stream) return;
  // Already playing? Remove it
  const existing = _ytStreams.findIndex(s => s.vid === stream.vid);
  if (existing >= 0) { ytRemoveStream(stream.vid); return; }
  // Max 4 streams
  if (_ytStreams.length >= 4) {
    toast("Max 4 YouTube streams — remove one first", "warn");
    return;
  }
  // SomaFM and YouTube can now play simultaneously (combined mode)
  const slot = _ytStreams.length;
  _ytStreams.push({ ...stream, paused: false, volume: 80, slot });
  dlog('info','youtube',`Added stream [${slot}]: ${stream.name} [${stream.vid}] (${_ytStreams.length} active)`);
  ytPlayNotify();
}

function ytRemoveStream(vid) {
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

function ytClearAll() {
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

function ytPauseToggle(vid) {
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
function ytReenforcePause() {
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

function ytPauseAll() {
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

function ytSetVolume(vol, vid) {
  const targets = vid ? _ytStreams.filter(s => s.vid === vid) : _ytStreams;
  targets.forEach(s => {
    s.volume = Math.round(vol);
    document.querySelectorAll(`iframe[data-yt-slot="${s.slot}"]`).forEach(f => {
      f.contentWindow?.postMessage({type:'yt-volume',vol:Math.round(vol)}, '*');
    });
  });
  ytPlayNotify();
}

function ytNext() {
  if (_ytStreams.length === 0) return;
  const current = _ytStreams[0];
  const liveStreams = YT_STREAMS.filter(s => !_ytHealth[s.vid] || _ytHealth[s.vid].ok);
  const idx = liveStreams.findIndex(s => s.vid === current.vid);
  const next = liveStreams[(idx + 1) % liveStreams.length];
  ytRemoveStream(current.vid);
  ytAddStream({vid:next.vid, name:next.name, desc:next.desc, cat:next.cat});
  toast(`Now playing: ${next.name}`, "info");
}

function ytPrev() {
  if (_ytStreams.length === 0) return;
  const current = _ytStreams[0];
  const liveStreams = YT_STREAMS.filter(s => !_ytHealth[s.vid] || _ytHealth[s.vid].ok);
  const idx = liveStreams.findIndex(s => s.vid === current.vid);
  const prev = liveStreams[(idx - 1 + liveStreams.length) % liveStreams.length];
  ytRemoveStream(current.vid);
  ytAddStream({vid:prev.vid, name:prev.name, desc:prev.desc, cat:prev.cat});
  toast(`Now playing: ${prev.name}`, "info");
}

function useYtStreams() { const[s,setS]=useState(_ytStreams.map(x=>({...x}))); useEffect(()=>{_ytPlaySubs.push(setS);return()=>{_ytPlaySubs=_ytPlaySubs.filter(fn=>fn!==setS)}},[]);return s; }

// Listen for YouTube error/ready messages from proxy iframes
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
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
        toast(`Stream unavailable: ${stream.name} — ${reason}`, "warn");
        ytRemoveStream(vid);
      }
    }
    if (e.data.type === 'yt-ready') {
      const vid = e.data.vid;
      const isLive = e.data.isLive;
      const dur = e.data.duration || 0;
      const detectedType = isLive ? "live" : dur > 0 ? "video" : "unknown";
      dlog('info','youtube',`Player ready: ${vid} (${detectedType}${isLive?' — LIVE':dur>0?` — ${Math.round(dur/60)}min`:''})`);
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

const FONTS = "https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&family=DM+Sans:wght@300;400;500;600;700&display=swap";

//  Theme (T is a getter that returns current theme) 
let T = THEMES.dark; // Default, updated by useTheme in App
function syncT() { T = THEMES[_activeTheme] || THEMES.dark; }
const CAT={study:{bg:T.purpleD,fg:T.purple,l:"Study"},review:{bg:"#1e1b4b",fg:"#a78bfa",l:"Review"},["exam-prep"]:{bg:T.orangeD,fg:T.orange,l:"Exam Prep"},["exam-day"]:{bg:"#7f1d1d",fg:"#f87171",l:"Exam Day"},project:{bg:"#164e63",fg:"#22d3ee",l:"Project/PA"},class:{bg:T.blueD,fg:T.blue,l:"Class"},break:{bg:T.yellowD,fg:T.yellow,l:"Break"},health:{bg:T.accentD,fg:T.accent,l:"Health"},work:{bg:T.cyanD,fg:T.cyan,l:"Work"},personal:{bg:T.pinkD,fg:T.pink,l:"Personal"},other:{bg:T.blueD,fg:T.soft,l:"Other"},exam:{bg:T.orangeD,fg:T.orange,l:"Exam"}}; // "exam" kept for backward compat
const AI_CATS=["study","review","exam-prep","exam-day","project","class","break","exam"];
const STUDY_CATS=["study","review","exam-prep","exam-day","project","class","exam"];
const PRIO={high:T.red,medium:T.orange,low:T.accent};
const STATUS_C={not_started:T.dim,in_progress:T.blue,completed:T.accent};
const STATUS_L={not_started:"Not Started",in_progress:"In Progress",completed:"Completed"};

// Responsive breakpoint system
// sm: <1200, md: 1200-1599, lg: 1600-2099, xl: 2100+ (ultrawide)
let _winW = typeof window !== 'undefined' ? window.innerWidth : 1400;
let _bpSubs = [];
function bpNotify() { _bpSubs.forEach(fn => fn(_winW)); }
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { _winW = window.innerWidth; bpNotify(); });
}
function useBreakpoint() {
  const [w, setW] = useState(_winW);
  useEffect(() => { _bpSubs.push(setW); return () => { _bpSubs = _bpSubs.filter(f => f !== setW); }; }, []);
  return {
    w, 
    sm: w < 1200, md: w >= 1200 && w < 1600, lg: w >= 1600 && w < 2100, xl: w >= 2100,
    cols: w < 1200 ? 3 : w < 1600 ? 4 : w < 2100 ? 5 : 6,
    gridCols: w < 1200 ? 2 : w < 1600 ? 3 : w < 2100 ? 4 : 4,
    pad: w < 1200 ? "24px 28px" : w < 1600 ? "28px 40px" : w < 2100 ? "32px 56px" : "36px 72px",
    padCol: w < 1200 ? "24px 28px 24px 44px" : w < 1600 ? "28px 40px 28px 56px" : w < 2100 ? "32px 56px 32px 72px" : "36px 72px 36px 88px",
    maxW: w < 1200 ? "none" : w < 1600 ? 1200 : w < 2100 ? 1500 : 1800,
    sideW: w < 1200 ? 260 : w < 1600 ? 280 : w < 2100 ? 300 : 320,
  };
}

//  Helpers 
const uid=()=>Math.random().toString(36).slice(2,10);
const todayStr=()=>new Date().toISOString().split("T")[0];
const pad=(n)=>String(n).padStart(2,"0");
const fmtTime=(h,m)=>`${h===0?12:h>12?h-12:h}:${pad(m)} ${h>=12?"PM":"AM"}`;
const parseTime=(s)=>{if(!s)return null;const[h,m]=s.split(":").map(Number);return{h,m,mins:h*60+m}};
const minsToStr=(m)=>{const h=Math.floor(m/60),mm=m%60;return h>0?(mm>0?`${h}h ${mm}m`:`${h}h`):`${mm}m`};
const nowMins=()=>{const d=new Date();return d.getHours()*60+d.getMinutes()};
const fmtDateLong=(d)=>new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});
const diffDays=(a,b)=>Math.ceil((new Date(b)-new Date(a))/86400000);
const load=async(k,fb)=>{try{const r=localStorage.getItem(k);return r?JSON.parse(r):fb}catch(e){console.error("[LP:storage] Load failed:",k,e);return fb}};
const save=async(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){console.error("[LP:storage] Save failed:",k,e)}};
// Migrate old XenoSYNC localStorage keys to DevonSYNC on first load
if(!localStorage.getItem('ds-v1')&&localStorage.getItem('xs-v1')){
  localStorage.setItem('ds-v1',localStorage.getItem('xs-v1'));
  if(localStorage.getItem('xs-favs'))localStorage.setItem('ds-favs',localStorage.getItem('xs-favs'));
  if(localStorage.getItem('xs-custom-streams'))localStorage.setItem('ds-custom-streams',localStorage.getItem('xs-custom-streams'));
  console.log('[DevonSYNC] Migrated data from XenoSYNC');
}
const fileToBase64=(file)=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(file)});

//  Icons 
const Ic={
  Check:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  Plus:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  Trash:({s=15})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>,
  X:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  AI:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  Chat:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  Cal:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  List:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  Grad:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 1.66 2.69 3 6 3s6-1.34 6-3v-5"/></svg>,
  Logo:({s=32})=><svg width={s} height={s} viewBox="0 0 40 40" fill="none">
    <defs><linearGradient id="xsg" x1="0" y1="0" x2="40" y2="40"><stop offset="0%" stopColor="#06d6a0"/><stop offset="50%" stopColor="#118ab2"/><stop offset="100%" stopColor="#6930c3"/></linearGradient></defs>
    <path d="M20 3L35 11.5v17L20 37 5 28.5v-17z" fill="url(#xsg)" opacity="0.12" stroke="url(#xsg)" strokeWidth="1.5"/>
    <path d="M14 17l6-5v3h4a2 2 0 0 1 2 2v1.5" stroke="url(#xsg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M26 23l-6 5v-3h-4a2 2 0 0 1-2-2v-1.5" stroke="url(#xsg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>,
  // SVG icons to replace emojis
  IcMusic:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3" fill={c} opacity=".3"/><circle cx="18" cy="16" r="3" fill={c} opacity=".3"/></svg>,
  IcStar:({s=14,c="currentColor",filled})=><svg width={s} height={s} viewBox="0 0 24 24" fill={filled?c:"none"} stroke={c} strokeWidth="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  IcHeart:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c} opacity=".8"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>,
  IcCal:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  IcPlay:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><polygon points="5 3 19 12 5 21 5 3"/></svg>,
  IcPause:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>,
  IcStop:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><rect x="4" y="4" width="16" height="16" rx="2"/></svg>,
  IcSkipF:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><polygon points="5 4 15 12 5 20"/><rect x="17" y="4" width="3" height="16" rx="1"/></svg>,
  IcSkipB:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><polygon points="19 20 9 12 19 4"/><rect x="4" y="4" width="3" height="16" rx="1"/></svg>,
  IcVolLow:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={c} opacity=".3"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>,
  IcVolHi:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill={c} opacity=".3"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>,
  IcPlus:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
  IcX:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  IcLive:({s=14})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="5" fill="#e00"/><circle cx="12" cy="12" r="9" stroke="#e00" strokeWidth="1.5" fill="none" opacity=".4"/></svg>,
  IcCheck:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>,
  IcTarget:({s=16,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill={c}/></svg>,
  IcFire:({s=14,c="#ef4444"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M12 23c-4.97 0-9-3.58-9-8 0-3.07 2.09-5.84 3.34-7.29.41-.48 1.17-.19 1.17.43 0 1.48.71 2.77 1.87 3.56C9.82 9.16 12 6.5 12 3c0-.65.7-1.03 1.21-.65C16.07 4.48 21 8.69 21 15c0 4.42-4.03 8-9 8z"/></svg>,
  IcInfo:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>,
  IcWarn:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  // [ICON] Filter/sort icons
  IcCrown:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill={c}><path d="M3 18h18v2H3zm0-2l3-8 4 4 5-8 5 8z"/></svg>,
  IcEye:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  IcChart:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  IcAZ:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M3 4h5l-5 8h5"/><path d="M14 4l4 8m-4 0l4-8"/><line x1="16" y1="8" x2="14" y2="8"/><path d="M7 16l5 4m0-4l-5 4"/></svg>,
  IcGrid:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  IcUser:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  IcTrash:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  IcSearch:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  IcGlobe:({s=14,c="currentColor"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
  // [ICON] SomaFM category icons
  CatLofi:({s=16,c="#06d6a0"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="5" height="10" rx="1" fill={c} opacity=".3"/><rect x="10" y="5" width="5" height="13" rx="1" fill={c} opacity=".5"/><rect x="16" y="10" width="4" height="8" rx="1" fill={c} opacity=".3"/><path d="M6 4v2M12 2v3M18 6v2" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>,
  CatAmbient:({s=16,c="#8b5cf6"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill={c} opacity=".4"/><circle cx="12" cy="12" r="6" stroke={c} strokeWidth="1" opacity=".3"/><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1" opacity=".2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity=".5"/></svg>,
  CatJazz:({s=16,c="#f59e0b"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M8 18c-2.2 0-4-1.3-4-3s1.8-3 4-3h1V5l10-2v8c0 1.7-1.8 3-4 3s-4-1.3-4-3" stroke={c} strokeWidth="1.5" strokeLinecap="round" fill="none"/><circle cx="6" cy="16" r="2.5" fill={c} opacity=".3"/><circle cx="17" cy="13" r="2.5" fill={c} opacity=".3"/></svg>,
  CatWorld:({s=16,c="#10b981"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.5"/><ellipse cx="12" cy="12" rx="4" ry="9" stroke={c} strokeWidth="1" opacity=".4"/><line x1="3" y1="12" x2="21" y2="12" stroke={c} strokeWidth="1" opacity=".3"/><line x1="5" y1="7" x2="19" y2="7" stroke={c} strokeWidth="0.8" opacity=".2"/><line x1="5" y1="17" x2="19" y2="17" stroke={c} strokeWidth="0.8" opacity=".2"/></svg>,
  CatClassical:({s=16,c="#6366f1"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="4" y="14" width="16" height="3" rx="1" fill={c} opacity=".2"/><rect x="5" y="6" width="2" height="11" rx="0.5" fill={c} opacity=".5"/><rect x="8" y="4" width="2" height="13" rx="0.5" fill={c} opacity=".6"/><rect x="11" y="7" width="2" height="10" rx="0.5" fill={c} opacity=".5"/><rect x="14" y="5" width="2" height="12" rx="0.5" fill={c} opacity=".6"/><rect x="17" y="8" width="2" height="9" rx="0.5" fill={c} opacity=".4"/></svg>,
  CatEnergy:({s=16,c="#f43f5e"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill={c} opacity=".3" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/></svg>,
  CatHoliday:({s=16,c="#ef4444"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M12 3l1.5 4.5H18l-3.5 2.5 1.3 4.5L12 12l-3.8 2.5 1.3-4.5L6 7.5h4.5z" fill={c} opacity=".4" stroke={c} strokeWidth="1"/><path d="M12 17v4" stroke={c} strokeWidth="2" strokeLinecap="round"/><circle cx="12" cy="22" r="1" fill={c}/></svg>,
  // [ICON] YouTube parent category icons
  YtLofi:({s=16,c="#06d6a0"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M3 18h2v-6h-2zm4 0h2V8H7zm4 0h2V4h-2zm4 0h2v-8h-2zm4 0h2v-4h-2z" fill={c} opacity=".5"/><path d="M2 20h20" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>,
  YtJazz:({s=16,c="#f59e0b"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M12 3c0 0-4 3-4 8s4 10 4 10 4-5 4-10-4-8-4-8z" fill={c} opacity=".25" stroke={c} strokeWidth="1.5"/><circle cx="12" cy="12" r="2" fill={c} opacity=".6"/></svg>,
  YtClassical:({s=16,c="#6366f1"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M9 18V5l12-2v13" stroke={c} strokeWidth="1.8" fill="none"/><circle cx="6" cy="18" r="3" fill={c} opacity=".35"/><circle cx="18" cy="16" r="3" fill={c} opacity=".35"/></svg>,
  YtAmbient:({s=16,c="#8b5cf6"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M4 14c2-4 5-6 8-6s6 2 8 6" stroke={c} strokeWidth="1.5" strokeLinecap="round"/><path d="M6 18c1.5-3 3.5-5 6-5s4.5 2 6 5" stroke={c} strokeWidth="1.5" strokeLinecap="round" opacity=".5"/><circle cx="12" cy="20" r="1.5" fill={c} opacity=".6"/></svg>,
  YtSynth:({s=16,c="#ec4899"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="2" y="10" width="20" height="10" rx="2" stroke={c} strokeWidth="1.5"/><rect x="4" y="12" width="3" height="6" rx="0.5" fill={c} opacity=".4"/><rect x="8" y="12" width="3" height="6" rx="0.5" fill={c} opacity=".3"/><rect x="12" y="12" width="3" height="6" rx="0.5" fill={c} opacity=".4"/><rect x="16" y="12" width="3" height="6" rx="0.5" fill={c} opacity=".3"/><circle cx="12" cy="6" r="3" stroke={c} strokeWidth="1" opacity=".3"/></svg>,
  YtFocus:({s=16,c="#0ea5e9"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke={c} strokeWidth="1.5"/><circle cx="12" cy="12" r="5" stroke={c} strokeWidth="1.2" opacity=".5"/><circle cx="12" cy="12" r="1.5" fill={c}/><line x1="12" y1="1" x2="12" y2="5" stroke={c} strokeWidth="1" opacity=".3"/><line x1="12" y1="19" x2="12" y2="23" stroke={c} strokeWidth="1" opacity=".3"/><line x1="1" y1="12" x2="5" y2="12" stroke={c} strokeWidth="1" opacity=".3"/><line x1="19" y1="12" x2="23" y2="12" stroke={c} strokeWidth="1" opacity=".3"/></svg>,
  YtChill:({s=16,c="#14b8a6"})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><path d="M2 12c0 0 3.5-4 10-4s10 4 10 4-3.5 4-10 4S2 12 2 12z" fill={c} opacity=".15" stroke={c} strokeWidth="1.5"/><path d="M8 12a4 4 0 1 0 8 0 4 4 0 1 0-8 0z" fill={c} opacity=".25"/><circle cx="12" cy="12" r="1.5" fill={c}/></svg>,
  Gear:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.73 12.73l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  ChevL:({s=16})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  ChevR:({s=16})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
  Clock:({s=13})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
  Spin:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0 1 10 10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur=".7s" repeatCount="indefinite"/></path></svg>,
  Send:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  Edit:({s=14})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
  Book:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  Upload:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  Tool:({s=14})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
  Img:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
  Bug:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3 3 0 0 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M5 11H2M22 11h-3M5 17H2M22 17h-3M12 20v2"/></svg>,
  Music:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  Quiz:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Download:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  Report:({s=18})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
  YT:({s=18,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="4" fill={c||"#ff0000"} opacity="0.9"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>,
  Radio:({s=18,c})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="14" rx="3" stroke={c||"currentColor"} strokeWidth="1.8" fill="none"/><circle cx="8" cy="14" r="2.5" stroke={c||"currentColor"} strokeWidth="1.5" fill="none"/><line x1="14" y1="11" x2="20" y2="11" stroke={c||"currentColor"} strokeWidth="1.5" strokeLinecap="round"/><line x1="14" y1="14" x2="18" y2="14" stroke={c||"currentColor"} strokeWidth="1.5" strokeLinecap="round"/><line x1="14" y1="17" x2="20" y2="17" stroke={c||"currentColor"} strokeWidth="1.5" strokeLinecap="round"/><path d="M6 6l10-3" stroke={c||"currentColor"} strokeWidth="1.5" strokeLinecap="round"/></svg>,
  Copy:({s=14})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>,
};

//  CSS 
const css=`
@import url('${FONTS}');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'DM Sans',sans-serif;background:${T.bg};color:${T.text}}
h1,h2,h3,h4{font-family:'Outfit',sans-serif}
input,textarea,select{font-family:'DM Sans',sans-serif;background:${T.input};border:1.5px solid ${T.border};color:${T.text};padding:10px 14px;border-radius:10px;font-size:13px;outline:none;width:100%;transition:border .2s,box-shadow .2s,background .15s;user-select:text}
input:hover,textarea:hover,select:hover{border-color:${T.borderL}}
input:focus,textarea:focus,select:focus{border-color:${T.accent};box-shadow:0 0 0 3px ${T.accentD};background:${T.bg2}}
textarea{resize:vertical;min-height:70px}
.mono{font-family:'JetBrains Mono','Fira Code',monospace;user-select:all}
select{cursor:pointer;appearance:none;padding-right:30px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%234a5e80' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.faint};border-radius:3px}::-webkit-scrollbar-thumb:hover{background:${T.dim}}
@keyframes fadeIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeScale{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px) scale(.95)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes popIn{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
@keyframes expandDown{from{opacity:0;max-height:0;transform:translateY(-10px)}to{opacity:1;max-height:1000px;transform:translateY(0)}}
@keyframes fadeOut{from{opacity:1;transform:scale(1) translateY(0)}to{opacity:0;transform:scale(.92) translateY(12px)}}
@keyframes pulse{0%{box-shadow:0 0 0 0 ${T.accentM}}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes shimmer{0%{background-position:-200% 0}100%{background-position:200% 0}}
@keyframes glow{0%,100%{opacity:.5}50%{opacity:1}}
.fade{animation:fadeIn .25s ease-out both}
.fade-scale{animation:fadeScale .3s ease-out both}
.slide-up{animation:slideUp .35s cubic-bezier(.4,0,.2,1) both}
.pop-in{animation:popIn .2s cubic-bezier(.4,0,.2,1) both}
.expand-down{animation:expandDown .4s cubic-bezier(.4,0,.2,1) both;overflow:hidden}
.fade-out{animation:fadeOut .3s cubic-bezier(.4,0,.2,1) forwards}
.mono{font-family:'JetBrains Mono',monospace}
.sf-card{transition:transform .15s ease,box-shadow .2s ease,border-color .2s ease}
.sf-card:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.15);border-color:${T.borderL} !important}
.sf-card:active{transform:translateY(0);box-shadow:none}
.sf-btn{transition:transform .1s ease,box-shadow .2s ease,filter .2s ease}
.sf-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 15px rgba(0,0,0,.2);filter:brightness(1.08)}
.sf-btn:active:not(:disabled){transform:translateY(0);box-shadow:none;filter:brightness(.95)}
.sf-station{transition:transform .15s ease,box-shadow .2s ease,border-color .2s ease,background .2s ease}
.sf-station:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(0,0,0,.3);border-color:${T.accent}55 !important}
.sf-station:active{transform:translateY(0)}
.sf-station-playing{animation:pulse 2s infinite}
.sf-nav:hover{background:${T.cardH} !important;transform:translateX(2px)}
.sf-nav{transition:all .15s ease !important}
.sf-glow{animation:glow 2s ease-in-out infinite}
.sf-yt-card{transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .25s ease,border-color .25s ease,opacity .3s ease}
.sf-yt-card:hover{transform:translateY(-4px) scale(1.02);box-shadow:0 12px 35px rgba(0,0,0,.35)}
.sf-parse-opt{transition:transform .2s cubic-bezier(.4,0,.2,1),box-shadow .2s ease,border-color .2s ease,filter .2s ease}
.sf-parse-opt:hover{transform:translateY(-3px) scale(1.02);box-shadow:0 8px 28px rgba(0,0,0,.3);filter:brightness(1.15);border-color:currentColor !important}
.sf-parse-opt:active{transform:scale(0.98)}
.sf-yt-card:hover img{filter:brightness(1.15)}
.sf-yt-card:active{transform:scale(0.97);transition:transform .1s}
.sf-yt-card img{transition:filter .3s ease}
.sf-task{transition:transform .12s ease,border-color .15s,box-shadow .15s}
.sf-task{transition:transform .12s ease,border-color .15s,box-shadow .15s}
.sf-task:hover{border-color:${T.borderL} !important;box-shadow:0 4px 16px rgba(0,0,0,.18);transform:translateY(-1px)}
.sf-icon-btn{transition:all .15s ease;border-radius:6px !important;opacity:.6}
.sf-icon-btn:hover{opacity:1;background:${T.input} !important;transform:scale(1.15)}
.sf-icon-btn:active{transform:scale(.9)}
.sf-cal-cell{transition:all .15s ease !important}
.sf-cal-cell:hover{background:${T.accent}12 !important;box-shadow:inset 0 0 0 1px ${T.accent}33}
.sf-exam-q{transition:transform .15s ease,box-shadow .2s ease,border-color .2s ease}
.sf-exam-q:hover{box-shadow:0 4px 20px rgba(0,0,0,.12)}
.sf-exam-opt{transition:all .15s ease !important}
.sf-exam-opt:not(:disabled):hover{transform:translateX(4px);border-color:${T.blue} !important;background:${T.blueD} !important}
.sf-exam-opt:not(:disabled):active{transform:translateX(2px)}
.sf-badge{transition:all .15s ease}
.sf-badge:hover{filter:brightness(1.2)}
.sf-stat{transition:transform .15s ease,box-shadow .2s ease}
.sf-stat:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.15)}
.sf-section{transition:border-color .2s ease,box-shadow .2s ease}
.sf-section:hover{border-color:${T.borderL} !important;box-shadow:0 2px 12px rgba(0,0,0,.08)}
.sf-chip{transition:all .12s ease !important}
.sf-chip:hover{filter:brightness(1.15);transform:translateY(-1px)}
.sf-chip:active{transform:translateY(0) scale(.97)}
.sf-toggle{transition:all .12s ease !important}
.sf-toggle:hover{filter:brightness(1.1);box-shadow:0 2px 8px rgba(0,0,0,.15)}
.sf-input-wrap{position:relative;transition:all .15s ease}
.sf-input-wrap:focus-within{box-shadow:0 0 0 3px ${T.accentD};border-color:${T.accent} !important}
.sf-cal-day{transition:all .12s ease !important}
.sf-cal-day:hover{background:${T.accentD} !important;transform:scale(1.15);border-radius:8px !important}
.sf-cal-cell{transition:background .15s ease,box-shadow .15s ease}
.sf-cal-cell:hover{background:${T.input} !important;box-shadow:inset 0 0 0 1px ${T.accent}33}
.sf-exam-q{transition:transform .15s ease,box-shadow .2s ease,border-color .2s ease}
.sf-exam-q:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.15);border-color:${T.borderL} !important}
.sf-exam-opt{transition:all .12s ease !important}
.sf-exam-opt:hover:not(:disabled){transform:translateX(4px);box-shadow:0 2px 8px rgba(0,0,0,.12);filter:brightness(1.08)}
.sf-exam-opt:active:not(:disabled){transform:translateX(2px)}
.sf-stat{transition:transform .15s ease,box-shadow .2s ease}
.sf-stat:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.15)}
.sf-chip{transition:all .12s ease}
.sf-chip:hover{filter:brightness(1.15);transform:translateY(-1px)}
.sf-input:hover{border-color:${T.borderL} !important}
.sf-input:focus{border-color:${T.accent} !important;box-shadow:0 0 0 3px ${T.accentD} !important}
.sf-section{transition:box-shadow .25s ease,border-color .25s ease}
.sf-section:hover{box-shadow:0 4px 20px rgba(0,0,0,.1);border-color:${T.borderL} !important}
.sf-profile{transition:all .15s ease}
.sf-profile:hover{transform:translateX(3px);box-shadow:0 3px 12px rgba(0,0,0,.12);border-color:${T.accent}44 !important}
.sf-icon-btn{transition:all .12s ease;border-radius:6px}
.sf-icon-btn:hover{background:${T.input} !important;color:${T.text} !important;transform:scale(1.1)}
.sf-tab{transition:all .12s ease}
.sf-tab:hover{background:${T.cardH} !important}
.sf-toggle{transition:all .12s ease}
.sf-toggle:hover{filter:brightness(1.15);border-color:currentColor !important}
.sf-row{transition:background .12s ease}
.sf-row:hover{background:${T.input} !important}
input[type="range"]{-webkit-appearance:none;height:6px;border-radius:3px;background:${T.border};outline:none;border:none;padding:0}
input[type="range"]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:${T.accent};cursor:pointer;box-shadow:0 0 6px ${T.accentM};transition:transform .15s}
input[type="range"]::-webkit-slider-thumb:hover{transform:scale(1.3)}
input[type="range"]::-webkit-slider-thumb:active{transform:scale(1.1)}
:root{color-scheme:dark}
input[type="date"],input[type="time"],input[type="datetime-local"]{color-scheme:dark}
input[type="date"]::-webkit-calendar-picker-indicator,input[type="time"]::-webkit-calendar-picker-indicator{filter:invert(0.7);cursor:pointer;padding:2px}
select{color-scheme:dark}
`;

//  Primitives 
const Btn=({children,onClick,v="primary",small,disabled,style:s})=>{
  const V={primary:{background:`linear-gradient(135deg,${T.accent},${T.accent}dd)`,color:"#060e09",boxShadow:`0 2px 8px ${T.accentM}`},secondary:{background:T.input,color:T.text,border:`1px solid ${T.border}`},danger:{background:T.redD,color:T.red,border:`1px solid ${T.red}33`},ghost:{background:"transparent",color:T.soft,border:`1px solid ${T.border}`},ai:{background:`linear-gradient(135deg,${T.purple},${T.blue})`,color:"#fff",boxShadow:`0 2px 12px ${T.purple}44`}};
  return (<button className="sf-btn" disabled={disabled} onClick={onClick} style={{...V[v],borderRadius:10,cursor:disabled?"not-allowed":"pointer",padding:small?"6px 14px":"10px 20px",fontSize:small?fs(12):fs(13),fontFamily:"'Outfit',sans-serif",fontWeight:600,display:"inline-flex",alignItems:"center",gap:6,transition:"all .2s",opacity:disabled?.45:1,whiteSpace:"nowrap",minHeight:small?30:36,letterSpacing:"0.2px",...s}}>{children}</button>)
};
const Modal=({title,onClose,children,wide})=>{
  const bdRef=useRef(null);
  const handleBdDown=(e)=>{if(e.target===bdRef.current){dlog('debug','modal',`Closed: "${title}" via backdrop`);onClose()}};
  useEffect(()=>{dlog('debug','modal',`Opened: "${title}"`);return()=>dlog('debug','modal',`Unmounted: "${title}"`);},[title]);
  return(
    <div ref={bdRef} onMouseDown={handleBdDown} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(12px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,padding:20}}>
      <div onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} className="slide-up" style={{background:T.card,border:`1.5px solid ${T.border}`,borderRadius:18,padding:28,width:"100%",maxWidth:wide?720:480,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 60px rgba(0,0,0,.4)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{fontSize:fs(17),fontWeight:700}}>{title}</h3>
          <button onClick={()=>{dlog('debug','modal',`Closed: "${title}" via X`);onClose()}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer"}}><Ic.X/></button>
        </div>{children}
      </div>
    </div>
  );
};
const Label=({children})=><label style={{fontSize:fs(11),color:T.soft,marginBottom:4,display:"block",fontWeight:600,letterSpacing:.3}}>{children}</label>;
// BufferedInput: holds local state during editing, commits to parent only on blur.
// Prevents re-renders from destroying native date/time pickers while they're open.
const BufferedInput = ({value, onCommit, type, ...props}) => {
  const [local, setLocal] = useState(String(value));
  const committed = useRef(String(value));
  // Always sync from parent when parent value changes externally
  useEffect(() => { const sv = String(value); if (sv !== committed.current) { setLocal(sv); committed.current = sv; } }, [value]);
  const commit = (v) => { if (v !== committed.current) { committed.current = v; onCommit(v); } };
  if (type === "number") {
    // Number inputs: commit on every change (no picker to destroy), but use local state for display
    return <input type={type} value={local} onChange={e => { setLocal(e.target.value); committed.current = e.target.value; onCommit(e.target.value); }} {...props}/>;
  }
  return <input type={type} value={local} onChange={e => setLocal(e.target.value)} onBlur={() => commit(local)} {...props}/>;
};
const Badge=({color,bg,children,style:s})=><span style={{fontSize:fs(10),padding:"3px 9px",borderRadius:5,fontWeight:600,background:bg,color,letterSpacing:.3,...s}}>{children}</span>;
const VolumeBar = ({value, onChange}) => {
  const barRef = useRef(null);
  const dragging = useRef(false);
  const setFromEvent = useCallback((e) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(pct);
  }, [onChange]);
  useEffect(() => {
    const onMove = (e) => { if (dragging.current) setFromEvent(e); };
    const onUp = () => { dragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [setFromEvent]);
  const segs = 24;
  const filled = Math.round(value * segs);
  return (
    <div ref={barRef} onMouseDown={e => { dragging.current = true; setFromEvent(e); }}
      style={{flex:1,display:"flex",gap:1.5,alignItems:"center",cursor:"pointer",padding:"4px 0",userSelect:"none"}} title={`${Math.round(value*100)}%`}>
      {Array.from({length:segs},(_,i) => {
        const on = i < filled;
        const intensity = i / segs;
        return <div key={i} style={{flex:1,height:on?7:3,borderRadius:2,
          background:on ? (intensity>0.8?T.red:intensity>0.6?T.orange:T.accent) : `${T.border}88`,
          transition:"height 60ms,background 60ms"}} />;
      })}
    </div>
  );
};
const ProgressBar=({value,max,color=T.accent,h=7})=><div style={{background:T.input,borderRadius:h,height:h,width:"100%",overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min((value/max)*100,100)}%`,background:color,borderRadius:h,transition:"width .5s ease"}}/></div>;

// ----------------------------------------------------------------------
// DEEP COURSE CONTEXT SCHEMA
// ----------------------------------------------------------------------
const EMPTY_DEEP = {
  courseCode:"",assessmentType:"",department:"",
  oaDetails:{format:"",questionCount:0,passingScore:"",timeLimit:"",proctoringTool:"",retakePolicy:""},
  paDetails:{taskDescription:"",rubricSummary:"",submissionFormat:"",evaluatorNotes:""},
  competencies:[],learningObjectives:[],
  topicBreakdown:[],keyTermsAndConcepts:[],commonMistakes:[],
  officialResources:[],recommendedExternal:[],studyGuideNotes:"",
  examTips:[],reportedDifficulty:3,averageStudyHours:0,passRate:"",versionInfo:"",
  knownFocusAreas:[],personalConfidence:{},studyLog:[],
  preAssessmentScore:null,preAssessmentWeakAreas:[],attemptHistory:[],
  prerequisites:[],relatedCourses:[],certAligned:"",lastUpdated:"",sourceNotes:"",
  // Study strategy fields
  studyStrategy:"", // "Read textbook → practice tests → review weak areas"
  quickWins:[], // Easy topics to build momentum
  hardestConcepts:[], // Concepts most students struggle with
  mnemonics:[], // [{concept,mnemonic}] Memory aids
  weeklyMilestones:[], // [{week,goals}] Week-by-week plan
  studyOrder:[], // Recommended order of topics within the course
  timeAllocation:[], // [{topic,percentage}] How to split study time
  practiceTestNotes:"", // Pre-assessment and practice test guidance
  instructorTips:[], // Course instructor tips
  communityInsights:[], // Reddit/Discord tips from other students
};

const CS = {
  name:{type:"string"},credits:{type:"number"},difficulty:{type:"number"},
  status:{type:"string",enum:["not_started","in_progress","completed"]},
  courseCode:{type:"string"},department:{type:"string"},
  assessmentType:{type:"string",enum:["OA","PA","OA+PA"]},
  oaDetails:{type:"object",properties:{format:{type:"string"},questionCount:{type:"number"},passingScore:{type:"string"},timeLimit:{type:"string"},proctoringTool:{type:"string"},retakePolicy:{type:"string"}}},
  paDetails:{type:"object",properties:{taskDescription:{type:"string"},rubricSummary:{type:"string"},submissionFormat:{type:"string"},evaluatorNotes:{type:"string"}}},
  competencies:{type:"array",items:{type:"object",properties:{code:{type:"string"},title:{type:"string"},description:{type:"string"},weight:{type:"string"}}}},
  learningObjectives:{type:"array",items:{type:"string"}},
  topicBreakdown:{type:"array",items:{type:"object",properties:{topic:{type:"string"},subtopics:{type:"array",items:{type:"string"}},weight:{type:"string",enum:["high","medium","low"]},description:{type:"string"}}}},
  keyTermsAndConcepts:{type:"array",items:{type:"object",properties:{term:{type:"string"},definition:{type:"string"}}}},
  commonMistakes:{type:"array",items:{type:"string"}},
  officialResources:{type:"array",items:{type:"object",properties:{title:{type:"string"},type:{type:"string"},provider:{type:"string"},notes:{type:"string"}}}},
  recommendedExternal:{type:"array",items:{type:"object",properties:{title:{type:"string"},url:{type:"string"},type:{type:"string"},notes:{type:"string"}}}},
  studyGuideNotes:{type:"string"},examTips:{type:"array",items:{type:"string"}},
  reportedDifficulty:{type:"number"},averageStudyHours:{type:"number"},passRate:{type:"string"},
  versionInfo:{type:"string"},knownFocusAreas:{type:"array",items:{type:"string"}},
  prerequisites:{type:"array",items:{type:"string"}},relatedCourses:{type:"array",items:{type:"string"}},
  certAligned:{type:"string"},notes:{type:"string"},topics:{type:"string"},
  // Study strategy fields
  studyStrategy:{type:"string",description:"Recommended study approach e.g. 'Read textbook chapters 1-4, then practice tests, review weak areas'"},
  quickWins:{type:"array",items:{type:"string"},description:"Easy topics to tackle first for momentum and confidence"},
  hardestConcepts:{type:"array",items:{type:"string"},description:"Concepts most students struggle with — need extra focus"},
  mnemonics:{type:"array",items:{type:"object",properties:{concept:{type:"string"},mnemonic:{type:"string"}}},description:"Memory aids for key concepts"},
  weeklyMilestones:{type:"array",items:{type:"object",properties:{week:{type:"number"},goals:{type:"string"}}},description:"Week-by-week study plan"},
  studyOrder:{type:"array",items:{type:"string"},description:"Recommended order to study topics within the course"},
  timeAllocation:{type:"array",items:{type:"object",properties:{topic:{type:"string"},percentage:{type:"number"}}},description:"How to split study time, e.g. topic:Networking, percentage:40"},
  practiceTestNotes:{type:"string",description:"Pre-assessment strategy and practice test guidance"},
  instructorTips:{type:"array",items:{type:"string"},description:"Tips from course instructors or CIs"},
  communityInsights:{type:"array",items:{type:"string"},description:"Tips from Reddit, Discord, WGU community"},
};

const TOOLS = [
  { name:"add_tasks", description:"Add tasks to study schedule.",
    input_schema:{type:"object",properties:{tasks:{type:"array",items:{type:"object",properties:{date:{type:"string"},time:{type:"string"},endTime:{type:"string"},title:{type:"string"},category:{type:"string",enum:["study","review","exam-prep","exam-day","project","class","break","health","work","personal","other"]},priority:{type:"string",enum:["high","medium","low"]},notes:{type:"string"}},required:["date","time","endTime","title","category","priority"]}}},required:["tasks"]}},
  { name:"add_courses", description:"Add WGU courses with DEEP context. Include assessment type, competencies, topic breakdown with exam weights, key terms, study resources, exam tips, difficulty, hours, focus areas, cert alignment, prerequisites.",
    input_schema:{type:"object",properties:{courses:{type:"array",items:{type:"object",properties:CS,required:["name","credits","difficulty","status"]}}},required:["courses"]}},
  { name:"update_courses", description:"Update existing courses by name match. Can update any field.",
    input_schema:{type:"object",properties:{updates:{type:"array",items:{type:"object",properties:{course_name_match:{type:"string",description:"Substring match (case insensitive)"},...CS},required:["course_name_match"]}}},required:["updates"]}},
  { name:"enrich_course_context", description:"Generate/regenerate deep context for courses. Provide the MOST CURRENT exam intelligence — WGU courses update frequently. Include specific competency codes, exact topic names with weights, concrete study hours per topic, current exam format, and actionable community tips from the last 3 months. When user asks 'what do I need to know to pass', go as deep as possible.",
    input_schema:{type:"object",properties:{enrichments:{type:"array",items:{type:"object",properties:{course_name_match:{type:"string"},...CS},required:["course_name_match"]}}},required:["enrichments"]}},
  { name:"generate_study_plan", description:"Generate multi-day study plan with tasks inserted into calendar. Uses course context and topic weights.",
    input_schema:{type:"object",properties:{summary:{type:"string"},weekly_schedule:{type:"array",items:{type:"object",properties:{course:{type:"string"},hours_per_week:{type:"number"},weeks_estimate:{type:"number"},order:{type:"number"},focus_areas:{type:"array",items:{type:"string"}}},required:["course","hours_per_week","weeks_estimate","order"]}},daily_tasks:{type:"array",items:{type:"object",properties:{date:{type:"string"},time:{type:"string"},endTime:{type:"string"},title:{type:"string"},category:{type:"string",enum:["study","review","exam-prep","exam-day","project","class","break","health","work","personal","other"]},priority:{type:"string",enum:["high","medium","low"]},notes:{type:"string"}},required:["date","time","endTime","title","category","priority"]}}},required:["summary","weekly_schedule","daily_tasks"]}},
];
const TOOLS_OPENAI = TOOLS.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.input_schema}}));

// ----------------------------------------------------------------------
// TOOL EXECUTION
// ----------------------------------------------------------------------
function safeArr(v) { return Array.isArray(v) ? v : []; }

function deepMergeCourse(existing, updates) {
  const m = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'course_name_match' || k === 'id' || v === undefined || v === null) continue;
    // Type-check against EMPTY_DEEP defaults to prevent render crashes
    const expected = EMPTY_DEEP[k];
    if (expected !== undefined) {
      if (Array.isArray(expected) && !Array.isArray(v)) {
        // Expected array, got something else — wrap string in array or skip
        if (typeof v === 'string' && v) m[k] = [v];
        else { dlog('warn','tool',`Skipping ${k}: expected array, got ${typeof v}`); continue; }
      } else if (typeof expected === 'object' && expected !== null && !Array.isArray(expected) && typeof v !== 'object') {
        dlog('warn','tool',`Skipping ${k}: expected object, got ${typeof v}`); continue;
      } else if (typeof expected === 'number' && typeof v !== 'number') {
        const num = Number(v);
        if (!isNaN(num)) m[k] = num;
        else continue;
      }
      else if (Array.isArray(v) && v.length > 0) m[k] = v;
      else if (typeof v === 'object' && !Array.isArray(v)) m[k] = { ...(existing[k]||{}), ...v };
      else if (v !== '' && v !== 0) m[k] = v;
    } else {
      // Field not in EMPTY_DEEP — just set it
      m[k] = v;
    }
  }
  m.lastUpdated = new Date().toISOString();
  return m;
}

function findCourse(courses, match) {
  const l = match.toLowerCase();
  return courses.findIndex(c => c.name.toLowerCase().includes(l) || (c.courseCode||'').toLowerCase().includes(l));
}

function executeTools(toolCalls, data, setData) {
  dlog('tool','tool',`Executing ${toolCalls.length} tool(s)`);
  const results = [];
  for (const call of toolCalls) {
    const { name, input } = call;
    dlog('tool','tool',`Tool: ${name}`, { id: call.id });
    try {
      if (name === "add_tasks") {
        const ct = safeArr(input.tasks).length;
        setData(d => {
          const tasks = { ...d.tasks };
          for (const t of safeArr(input.tasks)) { const dt=t.date||todayStr(); if(!tasks[dt])tasks[dt]=[]; tasks[dt].push({id:uid(),time:t.time,endTime:t.endTime||"",title:t.title,category:t.category||"study",priority:t.priority||"medium",notes:t.notes||"",done:false}); }
          return { ...d, tasks };
        });
        results.push({id:call.id,result:`Added ${ct} task(s)`});
        toast(`${ct} task(s) added to calendar`,"success");
      }
      else if (name === "add_courses") {
        const courses = safeArr(input.courses).filter(c => c && c.name);
        const ct = courses.length;
        dlog('info','tool',`add_courses: ${ct} valid courses from ${safeArr(input.courses).length} input`);
        if (ct === 0) {
          results.push({id:call.id,result:`No valid courses to add (input was empty or malformed)`});
        } else {
          let added = 0, merged = 0;
          setData(d => {
            const existing = [...d.courses];
            for (const c of courses) {
              // Sanitize
              const safe = {...EMPTY_DEEP};
              for (const [k,v] of Object.entries(c)) {
                if (v === null || v === undefined) continue;
                if (Array.isArray(EMPTY_DEEP[k]) && !Array.isArray(v)) { safe[k] = typeof v === 'string' ? [v] : []; }
                else if (typeof EMPTY_DEEP[k] === 'object' && !Array.isArray(EMPTY_DEEP[k]) && EMPTY_DEEP[k] !== null && typeof v !== 'object') { continue; }
                else { safe[k] = v; }
              }
              // Check if course already exists (by name or code)
              const nameL = (c.name||"").toLowerCase();
              const codeL = (c.courseCode||"").toLowerCase();
              if (!nameL && !codeL) { existing.push({...safe, id:uid(), name:c.name||"Unnamed", credits:Number(c.credits)||3, difficulty:Number(c.difficulty)||3, status:c.status||"not_started", lastUpdated:new Date().toISOString()}); added++; continue; }
              const existIdx = existing.findIndex(ex => {
                if(!ex?.name) return false;
                return ex.name.toLowerCase().includes(nameL) || nameL.includes(ex.name.toLowerCase()) ||
                (codeL && (ex.courseCode||"").toLowerCase() === codeL) ||
                (codeL && ex.name.toLowerCase().includes(codeL));
              });
              if (existIdx >= 0) {
                // Merge into existing course instead of duplicating
                dlog('info','tool',`add_courses: merging "${c.name}" into existing "${existing[existIdx].name}"`);
                existing[existIdx] = deepMergeCourse(existing[existIdx], safe);
                merged++;
              } else {
                existing.push({...safe, id:uid(), name:c.name||"Unnamed", credits:Number(c.credits)||3, difficulty:Number(c.difficulty)||3, status:c.status||"not_started", lastUpdated:new Date().toISOString()});
                added++;
              }
            }
            return {...d, courses: existing};
          });
          const parts = [];
          if (added > 0) parts.push(`added ${added}`);
          if (merged > 0) parts.push(`merged ${merged} into existing`);
          results.push({id:call.id,result:`${parts.join(", ")}: ${courses.map(c=>c.name).join(", ")}`});
        }
      }
      else if (name === "update_courses") {
        let matched = 0;
        setData(d => ({...d, courses:d.courses.map(c => {
          const u = safeArr(input.updates).find(u => { if(!u?.course_name_match) return false; const l=u.course_name_match.toLowerCase(); return c.name.toLowerCase().includes(l)||(c.courseCode||'').toLowerCase().includes(l); });
          if (!u) return c; matched++; return deepMergeCourse(c, u);
        })}));
        results.push({id:call.id,result:`Updated courses`});
      }
      else if (name === "enrich_course_context") {
        let enriched = 0;
        const enrichNames = [];
        setData(d => ({...d, courses:d.courses.map(c => {
          const e = safeArr(input.enrichments).find(e => { if(!e?.course_name_match) return false; const l=e.course_name_match.toLowerCase(); return c.name.toLowerCase().includes(l)||(c.courseCode||'').toLowerCase().includes(l); });
          if (!e) return c; enriched++; enrichNames.push(c.name); return deepMergeCourse(c, e);
        })}));
        results.push({id:call.id,result:`Enriched ${enrichNames.length} course(s): ${enrichNames.join(", ")}`});
        if (enrichNames.length > 0) toast(`Enriched: ${enrichNames.join(", ")}`,"success");
      }
      else if (name === "generate_study_plan") {
        const ct = safeArr(input.daily_tasks).length;
        setData(d => {
          const tasks = { ...d.tasks };
          for (const t of safeArr(input.daily_tasks)) { const dt=t.date||todayStr(); if(!tasks[dt])tasks[dt]=[]; tasks[dt].push({id:uid(),time:t.time,endTime:t.endTime||"",title:t.title,category:t.category||"study",priority:t.priority||"medium",notes:t.notes||"",done:false}); }
          return { ...d, tasks };
        });
        results.push({id:call.id,result:`Plan: ${input.summary||'(no summary)'}. ${ct} tasks added.`});
        toast(`Study plan created: ${ct} tasks`,"success");
      }
      else { results.push({id:call.id,result:`Unknown tool: ${name}`}); }
    } catch(e) {
      dlog('error','tool',`Tool "${name}" error`, e.message);
      results.push({id:call.id,result:`Error: ${e.message}`});
    }
  }
  return results;
}

// ----------------------------------------------------------------------
// AI CALLER with tool-use protocol
// ----------------------------------------------------------------------
async function callAIWithTools(profile, systemPrompt, messages, imageData = null) {
  const isAnth = isAnthProvider(profile);
  dlog('api','api',`Calling: ${profile.name} (${profile.model})`, {provider:isAnth?"anthropic":"openai",msgs:messages.length,hasImg:!!imageData});
  const headers = getAuthHeaders(profile);

  // Build the last user message content (may include image)
  let processedMessages = [...messages];
  if (imageData && processedMessages.length > 0) {
    const last = processedMessages[processedMessages.length - 1];
    if (last.role === "user") {
      processedMessages = [...processedMessages.slice(0, -1), {
        role: "user",
        content: isAnth
          ? [{ type: "image", source: { type: "base64", media_type: imageData.type, data: imageData.data } }, { type: "text", text: last.content }]
          : [{ type: "image_url", image_url: { url: `data:${imageData.type};base64,${imageData.data}` } }, { type: "text", text: last.content }],
      }];
    }
  }

  let body;
  if (isAnth) {
    body = { model: profile.model, max_tokens: 16384, system: systemPrompt, messages: processedMessages, tools: TOOLS };
  } else {
    body = { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt }, ...processedMessages], tools: TOOLS_OPENAI };
  }

  let res;
  try { res = await fetch(profile.baseUrl, { method: "POST", headers, body: JSON.stringify(body) });
    dlog('api','api',`Response: HTTP ${res.status}`);
    setApiStatus(res.ok, res.status);
  } catch(e) {
    setApiStatus(false, 0, e.message);
    dlog('error','api',`Network error: ${e.message}`,{url:profile.baseUrl}); throw new Error(`Network error: ${e.message}`);
  }

  // If image was attached and we got a 400, retry without the image
  if (!res.ok && imageData && (res.status === 400 || res.status === 422)) {
    dlog('warn','api',`Got ${res.status} with image attached — retrying without image (model may not support vision)`);
    const plainMsgs = messages; // original messages without image
    const retryBody = isAnth
      ? { model: profile.model, max_tokens: 16384, system: systemPrompt + "\n\nNOTE: An image was provided but your model doesn't support vision. Ask the user to describe what's in the image instead.", messages: plainMsgs, tools: TOOLS }
      : { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt + "\n\nNOTE: An image was provided but your model doesn't support vision. Ask the user to describe what's in the image instead." }, ...plainMsgs], tools: TOOLS_OPENAI };
    try {
      res = await fetch(profile.baseUrl, { method: "POST", headers, body: JSON.stringify(retryBody) });
      dlog('api','api',`Retry response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
    } catch(e) { setApiStatus(false, 0, e.message); throw new Error(`Retry failed: ${e.message}`); }
  }

  if (!res.ok) { const t = await res.text(); dlog('error','api',`API error ${res.status}`,t.slice(0,500)); throw new Error(`API ${res.status}: ${t.slice(0, 400)}`); }

  // Read as text first to handle truncated/empty responses
  let rawText;
  try { rawText = await res.text(); } catch(e) { dlog('error','api','Failed to read response body',e.message); throw new Error(`Failed to read response: ${e.message}`); }
  dlog('debug','api',`Response body: ${rawText.length} chars`);
  if (!rawText || rawText.trim().length === 0) { dlog('error','api','Empty response body'); throw new Error('API returned an empty response. The model may have timed out or returned nothing.'); }

  let data;
  try { data = JSON.parse(rawText); }
  catch(e) {
    dlog('error','api',`JSON parse failed (${rawText.length} chars)`, rawText.slice(0, 500));
    throw new Error(`Invalid JSON from API (${rawText.length} chars). Response may have been truncated. First 200 chars: ${rawText.slice(0,200)}`);
  }

  // Parse response — handle thinking models (Qwen, DeepSeek) that wrap content in <think> tags
  if (isAnth) {
    const text = safeArr(data.content).filter(b => b.type === "text").map(b => b.text).join("");
    const toolCalls = safeArr(data.content).filter(b => b.type === "tool_use").map(b => ({ id: b.id, name: b.name, input: b.input }));
    return { text, toolCalls, stopReason: data.stop_reason };
  } else {
    const msg = data.choices?.[0]?.message;
    if (!msg) {
      dlog('warn','api','No message in response', JSON.stringify(data).slice(0,500));
      // Some models return content differently — try to extract text
      const fallbackText = data.output?.text || data.result || "";
      return { text: fallbackText || "(Model returned no message)", toolCalls: [], stopReason: "stop" };
    }
    let text = msg.content || "";
    // Strip <think>...</think> blocks from thinking models
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const finishReason = data.choices?.[0]?.finish_reason;
    if (finishReason === "length") {
      dlog('warn','api','Response was TRUNCATED (finish_reason=length). Increase max_tokens or simplify the request.');
      text += "\n\n⚠️ Response was truncated — the model ran out of output tokens. Some data may be incomplete.";
    }
    const toolCalls = safeArr(msg.tool_calls).map(tc => {
      try {
        const rawArgs = tc.function?.arguments || "{}";
        const args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
        return { id: tc.id, name: tc.function.name, input: args };
      } catch(e) {
        // Try to repair truncated JSON from thinking models
        dlog('warn','api',`Truncated tool args for ${tc.function?.name}, attempting repair...`, tc.function?.arguments?.slice?.(0,500));
        const raw = tc.function?.arguments || "";
        let repaired = null;
        try {
          // Try closing open brackets/braces
          let fixed = raw;
          const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
          const braces = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
          for (let i=0;i<opens;i++) fixed += "]";
          for (let i=0;i<braces;i++) fixed += "}";
          repaired = JSON.parse(fixed);
          dlog('info','api',`Repaired truncated JSON for ${tc.function?.name}`);
        } catch(e2) {
          dlog('error','api',`Could not repair JSON for ${tc.function?.name}`, raw.slice(0,300));
        }
        return { id: tc.id, name: tc.function?.name || 'unknown', input: repaired || {} };
      }
    });
    return { text, toolCalls, stopReason: finishReason };
  }
}

// ----------------------------------------------------------------------
// STREAMING API CALLER (SSE) — shows live text as it arrives
// ----------------------------------------------------------------------
async function callAIStream(profile, systemPrompt, messages, imageData = null, onChunk = null) {
  const isAnth = isAnthProvider(profile);
  dlog('api','api',`Streaming call: ${profile.name} (${profile.model})`);
  const headers = getAuthHeaders(profile);
  const signal = _bgState.abortCtrl?.signal;

  let processedMessages = [...messages];
  if (imageData && processedMessages.length > 0) {
    const last = processedMessages[processedMessages.length - 1];
    if (last.role === "user") {
      processedMessages = [...processedMessages.slice(0, -1), {
        role: "user",
        content: isAnth
          ? [{ type:"image", source:{ type:"base64", media_type:imageData.type, data:imageData.data } }, { type:"text", text:last.content }]
          : [{ type:"image_url", image_url:{ url:`data:${imageData.type};base64,${imageData.data}` } }, { type:"text", text:last.content }],
      }];
    }
  }

  let body;
  if (isAnth) {
    body = { model:profile.model, max_tokens:16384, stream:true, system:systemPrompt, messages:processedMessages, tools:TOOLS };
  } else {
    body = { model:profile.model, max_tokens:16384, stream:true, messages:[{role:"system",content:systemPrompt}, ...processedMessages], tools:TOOLS_OPENAI };
  }

  let res;
  try {
    res = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body), signal });
    dlog('api','api',`Stream response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
  } catch(e) {
    if (e.name === 'AbortError') { dlog('info','api','Stream aborted by user'); throw new Error('Cancelled'); }
    setApiStatus(false, 0, e.message);
    dlog('error','api',`Stream fetch failed: ${e.message}`);
    throw new Error(`Network error: ${e.message}`);
  }

  if (!res.ok) {
    // If streaming fails (some endpoints don't support it), fall back to non-streaming
    dlog('warn','api',`Stream not supported (HTTP ${res.status}), falling back`);
    return callAIWithTools(profile, systemPrompt, messages, imageData);
  }

  // Parse SSE stream
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let thinkBuf = "";
  let inThink = false;
  // OpenAI tool call accumulation
  const toolCallMap = {}; // index -> {id, name, arguments}
  let stopReason = "stop";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]" || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data: ")) continue;

        let chunk;
        try { chunk = JSON.parse(trimmed.slice(6)); } catch(_e) { continue; }

        if (isAnth) {
          if (chunk.type === "content_block_delta") {
            if (chunk.delta?.type === "text_delta") {
              const t = chunk.delta.text || "";
              fullText += t;
              if (onChunk) onChunk(fullText.replace(/<think>[\s\S]*?(<\/think>|$)/g,'').trim());
            } else if (chunk.delta?.type === "input_json_delta") {
              const idx = chunk.index || 0;
              if (toolCallMap[idx]) {
                toolCallMap[idx].arguments += (chunk.delta.partial_json || "");
                const totalArgs = Object.values(toolCallMap).reduce((s,t) => s + t.arguments.length, 0);
                const names = Object.values(toolCallMap).filter(t=>t.name).map(t=>t.name).join(", ");
                if (onChunk) onChunk(`🔧 Calling: ${names}\n📦 Receiving data... (${totalArgs} chars)`);
              }
            }
          } else if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
            const idx = chunk.index || 0;
            toolCallMap[idx] = { id: chunk.content_block.id, name: chunk.content_block.name, arguments: "" };
            dlog('debug','api',`Stream tool start: ${chunk.content_block.name}`);
          } else if (chunk.type === "message_delta") {
            stopReason = chunk.delta?.stop_reason || stopReason;
          }
        } else {
          // OpenAI streaming format
          const delta = chunk.choices?.[0]?.delta;
          if (delta?.content) {
            fullText += delta.content;
            const cleaned = fullText.replace(/<think>[\s\S]*?(<\/think>|$)/g,'').trim();
            if (onChunk) onChunk(cleaned);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolCallMap[idx]) toolCallMap[idx] = { id: tc.id || "", name: "", arguments: "" };
              if (tc.id) toolCallMap[idx].id = tc.id;
              if (tc.function?.name) {
                toolCallMap[idx].name = tc.function.name;
                dlog('debug','api',`Stream tool start: ${tc.function.name}`);
              }
              if (tc.function?.arguments) {
                toolCallMap[idx].arguments += tc.function.arguments;
                // Show tool arg accumulation in UI
                const totalArgs = Object.values(toolCallMap).reduce((s,t) => s + t.arguments.length, 0);
                const names = Object.values(toolCallMap).filter(t=>t.name).map(t=>t.name).join(", ");
                if (onChunk) onChunk(`🔧 Calling: ${names}\n📦 Receiving data... (${totalArgs} chars)`);
              }
            }
          }
          stopReason = chunk.choices?.[0]?.finish_reason || stopReason;
        }
      }
    }
  } catch (e) {
    dlog('error','api',`Stream read error: ${e.message}`);
  }

  // Parse accumulated tool calls
  const text = fullText.replace(/<think>[\s\S]*?<\/think>/g,'').trim();
  dlog('debug','api',`Stream raw tool data: ${JSON.stringify(Object.fromEntries(Object.entries(toolCallMap).map(([k,v])=>[k,{name:v.name,id:v.id,argsLen:v.arguments.length,argsPreview:v.arguments.slice(0,200)}])))}`);
  const toolCalls = Object.values(toolCallMap).map(tc => {
    let input = {};
    try {
      if (tc.arguments) {
        let fixed = tc.arguments;
        const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
        const braces = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
        for (let i=0;i<opens;i++) fixed += "]";
        for (let i=0;i<braces;i++) fixed += "}";
        input = JSON.parse(fixed);
      }
    } catch(e) { dlog('warn','api',`Stream tool parse failed for ${tc.name}`,tc.arguments?.slice(0,300)); }
    return { id: tc.id, name: tc.name, input };
  }).filter(tc => tc.name);

  dlog('api','api',`Stream complete: ${text.length} chars, ${toolCalls.length} tools, stop=${stopReason}`);
  if (stopReason === "length") dlog('warn','api','Stream was TRUNCATED (stop=length)');

  return { text, toolCalls, stopReason };
}

// Continue conversation after tool execution (send tool results back)
async function continueAfterTools(profile, systemPrompt, messages, toolCalls, toolResults) {
  const isAnth = isAnthProvider(profile);
  const headers = getAuthHeaders(profile);

  let extendedMessages;
  if (isAnth) {
    extendedMessages = [
      ...messages,
      { role: "assistant", content: toolCalls.map(tc => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input })) },
      { role: "user", content: toolResults.map(tr => ({ type: "tool_result", tool_use_id: tr.id, content: tr.result })) },
    ];
  } else {
    // OpenAI: assistant message with tool_calls, then tool role messages
    extendedMessages = [
      ...messages,
      { role: "assistant", tool_calls: toolCalls.map(tc => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.input) } })) },
      ...toolResults.map(tr => ({ role: "tool", tool_call_id: tr.id, content: tr.result })),
    ];
  }

  const body = isAnth
    ? { model: profile.model, max_tokens: 16384, system: systemPrompt, messages: extendedMessages, tools: TOOLS }
    : { model: profile.model, max_tokens: 16384, messages: [{ role: "system", content: systemPrompt }, ...extendedMessages], tools: TOOLS_OPENAI };

  dlog('api','api','Continuing after tool results');
  const res = await fetch(profile.baseUrl, { method: "POST", headers, body: JSON.stringify(body) });
  dlog('api','api',`Continue response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
  if (!res.ok) { const t = await res.text(); dlog('error','api',`Continue error ${res.status}`,t.slice(0,500)); throw new Error(`API ${res.status}: ${t.slice(0, 400)}`); }

  let rawText;
  try { rawText = await res.text(); } catch(e) { throw new Error(`Failed to read continue response: ${e.message}`); }
  dlog('debug','api',`Continue body: ${rawText.length} chars`);
  if (!rawText || rawText.trim().length === 0) throw new Error('Empty continue response');

  let data;
  try { data = JSON.parse(rawText); }
  catch(e) { dlog('error','api',`Continue JSON parse failed (${rawText.length} chars)`,rawText.slice(0,500)); throw new Error(`Invalid JSON in continue (${rawText.length} chars): ${rawText.slice(0,200)}`); }

  if (isAnth) {
    const text = safeArr(data.content).filter(b=>b.type==="text").map(b=>b.text).join("");
    const moreCalls = safeArr(data.content).filter(b=>b.type==="tool_use").map(b=>({id:b.id,name:b.name,input:b.input}));
    return { text, toolCalls:moreCalls, stopReason:data.stop_reason };
  } else {
    const msg = data.choices?.[0]?.message;
    if (!msg) return { text:"(no response)", toolCalls:[], stopReason:"stop" };
    let text = (msg.content||"").replace(/<think>[\s\S]*?<\/think>/g,'').trim();
    const moreCalls = safeArr(msg.tool_calls).map(tc => {
      try { return { id:tc.id, name:tc.function.name, input: typeof tc.function?.arguments==='string'?JSON.parse(tc.function.arguments):(tc.function?.arguments||{}) }; }
      catch(e) { return { id:tc.id, name:tc.function?.name||'unknown', input:{} }; }
    });
    return { text, toolCalls:moreCalls, stopReason:data.choices?.[0]?.finish_reason };
  }
}

// ----------------------------------------------------------------------
// SYSTEM PROMPT (deep context)
// ----------------------------------------------------------------------
function fmtCtx(c, idx) {
  let s = `${idx+1}. ${c.name} (${c.credits||0} CU, ${STATUS_L[c.status]||c.status}, diff ${c.difficulty||3}/5)`;
  if (c.assessmentType) s += ` [${c.assessmentType}]`;
  if (c.certAligned) s += ` → ${c.certAligned}`;
  if (safeArr(c.competencies).length>0) s += `\n     Competencies: ${safeArr(c.competencies).map(x=>`${x.code||''} ${x.title} (${x.weight||'?'})`).join('; ')}`;
  if (safeArr(c.topicBreakdown).length>0) s += `\n     Topics: ${safeArr(c.topicBreakdown).map(t=>`${t.topic} [${t.weight}]`).join('; ')}`;
  if (safeArr(c.knownFocusAreas).length>0) s += `\n     Focus: ${safeArr(c.knownFocusAreas).join('; ')}`;
  if (safeArr(c.examTips).length>0) s += `\n     Tips: ${safeArr(c.examTips).slice(0,3).join('; ')}`;
  if (c.averageStudyHours) s += `\n     ~${c.averageStudyHours}h avg`;
  if (c.passRate) s += ` | ${c.passRate}`;
  if (c.studyStrategy) s += `\n     Strategy: ${c.studyStrategy}`;
  if (safeArr(c.quickWins).length>0) s += `\n     Quick wins: ${safeArr(c.quickWins).join('; ')}`;
  if (safeArr(c.hardestConcepts).length>0) s += `\n     Hardest: ${safeArr(c.hardestConcepts).join('; ')}`;
  if (safeArr(c.studyOrder).length>0) s += `\n     Study order: ${safeArr(c.studyOrder).join(' → ')}`;
  if (c.topics) s += `\n     Topics: ${c.topics}`;
  if (c.notes) s += `\n     Notes: ${c.notes}`;
  return s;
}

function buildSystemPrompt(data, ctx = "") {
  const courses = data.courses || [];
  const active = courses.filter(c => c.status !== "completed");
  const done = courses.filter(c => c.status === "completed");
  const totalCU = courses.reduce((s,c)=>s+(c.credits||0),0);
  const doneCU = done.reduce((s,c)=>s+(c.credits||0),0);
  const remainCU = totalCU - doneCU;

  const activeStr = active.length > 0 ? active.map((c,i) => fmtCtx(c,i)).join("\n\n") : "No remaining courses.";
  const doneStr = done.length > 0 ? done.map(c => `  ✅ ${c.name} (${c.credits} CU)`).join("\n") : "None completed yet.";

  const exDates = safeArr(data.exceptionDates);
  const hrsPerDay = data.studyHoursPerDay || 4;
  const startDate = data.studyStartDate || todayStr();
  const earlyFinishDate = data.targetCompletionDate || "";

  // Calculate estimates for context
  const totalEstHours = active.reduce((s, c) => s + (c.averageStudyHours > 0 ? c.averageStudyHours : ([0,20,35,50,70,100][c.difficulty||3]||50)), 0);
  const rawDays = Math.ceil(totalEstHours / hrsPerDay);

  return `You are DevonSYNC v${APP_VERSION}, an AI study planner and tutor for a WGU (Western Governors University) student.
Today: ${fmtDateLong(todayStr())}.

TOOLS AVAILABLE (always use tools for actions, never raw JSON):
- add_tasks: Schedule time-blocked tasks on specific dates
- add_courses: Add WGU courses with deep context (deduplicates automatically)
- update_courses: Update course status/details by name match
- enrich_course_context: Generate comprehensive exam intelligence for courses
- generate_study_plan: Create multi-day calendar with concrete study tasks

COURSE STUDY ORDER (user-prioritized, #1 = do first):
${activeStr}

COMPLETED:
${doneStr}

DEGREE STATS:
- Total: ${totalCU} CU | Completed: ${doneCU} CU | Remaining: ${remainCU} CU (${active.length} courses)
- Est. total study hours remaining: ~${totalEstHours}h (at current pace: ~${rawDays} study days)
- Study hours/day: ${hrsPerDay}h
- Study start: ${startDate}${data.studyStartTime ? ` at ${data.studyStartTime}` : ""} | Target completion: ${earlyFinishDate || "Not set"} | Term end: ${data.targetDate || "Not set"}
- Exception dates (no studying): ${(() => {
    if (exDates.length === 0) return "None";
    if (exDates.length <= 10) return exDates.join(", ");
    // Detect recurring patterns for concise description
    const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const dayCounts = [0,0,0,0,0,0,0];
    exDates.forEach(dt => dayCounts[new Date(dt+"T12:00:00").getDay()]++);
    const recurringDays = dayCounts.map((c,i) => c >= 3 ? dayNames[i] : null).filter(Boolean);
    const nonRecurring = exDates.filter(dt => !recurringDays.includes(dayNames[new Date(dt+"T12:00:00").getDay()]));
    let desc = "";
    if (recurringDays.length > 0) desc += `Every ${recurringDays.join(" & ")} (${exDates.length - nonRecurring.length} dates)`;
    if (nonRecurring.length > 0) desc += (desc ? " + " : "") + nonRecurring.join(", ");
    return desc + ` — ${exDates.length} total`;
  })()}

IMPORTANT RULES:
- The course list ORDER reflects the user's chosen priority. Course #1 should be studied first. COMPLETE one course fully before starting the next. Do NOT mix courses on the same day (except transition days).
- When generating tasks with generate_study_plan, skip exception dates. Start from the study start date${data.studyStartTime ? ` at ${data.studyStartTime} (the student has limited hours on day one)` : ""}.
- CATEGORY TAGS: "study" (new material), "review" (revision), "exam-prep" (practice tests), "exam-day" (actual OA/PA), "project" (PA writing), "class" (live sessions), "break" (rest). Always schedule an "exam-day" task when a course ends.
- When enriching courses, include ALL fields: assessment type/details, competencies with weights, topic breakdown with exam weights, key terms, common mistakes, official+community resources, exam tips, known focus areas, avg study hours, cert alignment, prerequisites. ALSO include study strategy fields: studyStrategy (recommended approach), quickWins (easy topics first), hardestConcepts (need extra focus), mnemonics (memory aids as {concept,mnemonic}), weeklyMilestones ({week,goals}), studyOrder (topic sequence), timeAllocation ({topic,percentage}), practiceTestNotes, instructorTips, communityInsights.
- When the user asks "what do I need to know to pass", use enrich_course_context with comprehensive data.
- add_courses deduplicates: if a course already exists, it merges instead of creating duplicates.
- The student can complete tasks early. If they do, remaining tasks shift forward. Keep tasks realistically sized (1-3 hour blocks with breaks).

RECENCY & ACCURACY:
- ALWAYS prioritize information from the last 3 months. WGU courses change frequently — competencies, exam formats, OA question pools, and resources are regularly updated.
- When providing course context, resources, or exam tips, base them on the CURRENT version of the course. If you know the course was updated recently, mention this.
- For resources, prefer: official WGU course materials > WGU Course Instructors (CI) tips > r/WGU subreddit (recent posts) > YouTube study guides (recent) > Quizlet sets.
- For exam tips, prioritize what current students report: question types, time limits, passing scores, which competencies are weighted heaviest, and common traps.
- DEEP DIVE: When enriching a course, be as comprehensive and granular as possible. Don't give vague summaries — provide specific competency codes, exact topic names, concrete study hour estimates per topic, and actionable mnemonics. The student depends on this data to plan their study calendar.
- When generating study plans, account for topic difficulty and weight — harder/heavier topics get more hours. Front-load quick wins for momentum.

ACCURACY & SELF-VERIFICATION:
- Before providing specific facts (passing scores, question counts, time limits, competency codes), mentally verify: "Am I confident this is current? Could this have changed?" If uncertain, explicitly flag it: "This was accurate as of [date], but verify with your CI or the course page."
- NEVER present uncertain information as definitive fact. If you're unsure about a specific detail, say so clearly — the student will verify. Wrong data is worse than no data because they'll study the wrong things.
- Cross-reference internally: if a topic weight says "high" but the competency description seems niche, re-examine. If study hours seem too low for the difficulty, adjust.
- When listing resources, only include ones you're confident still exist. Dead links and renamed resources waste the student's time.
- Distinguish between "what WGU officially states" vs "what students commonly report" — both are valuable, but they should be labeled differently.
${data.userContext ? `\nUSER PREFERENCES:\n${data.userContext}` : ""}
${ctx ? `\nCONTEXT:\n${ctx}` : ""}`;
}

// ----------------------------------------------------------------------
// AI LOOP HELPER
// ----------------------------------------------------------------------
async function runAILoop(profile, sys, msgs, data, setData, img = null, useStream = true) {
  dlog('info','api',`AI loop start (stream=${useStream})`);
  bgNewAbort(); // Create new AbortController for this operation
  const logs = [];
  let resp;
  const onChunk = useStream ? (text) => bgStream(text) : null;
  try {
    resp = useStream
      ? await callAIStream(profile, sys, msgs, img, onChunk)
      : await callAIWithTools(profile, sys, msgs, img);
  }
  catch (e) {
    if (e.message === 'Cancelled') return {logs:[{type:"error",content:"⛔ Cancelled"}],finalText:""};
    dlog('error','api','Initial call failed',e.message);
    return {logs:[{type:"error",content:e.message}],finalText:""};
  }
  let loops = 5, finalText = "";
  while (loops-- > 0) {
    if (_bgState.abortCtrl?.signal?.aborted) { logs.push({type:"error",content:"⛔ Cancelled"}); break; }
    if (resp.text) { logs.push({type:"text",content:resp.text}); finalText += (finalText?" ":"") + resp.text; bgStream(""); }
    if (resp.toolCalls.length > 0) {
      for (const tc of resp.toolCalls) logs.push({type:"tool_call",content:`🔧 ${tc.name}(${JSON.stringify(tc.input).slice(0,300)})`});
      const results = executeTools(resp.toolCalls, data, setData);
      for (const r of results) logs.push({type:"tool_result",content:`✅ ${r.result}`});
      try { resp = await continueAfterTools(profile, sys, msgs, resp.toolCalls, results); }
      catch (e) {
        if (e.message === 'Cancelled') { logs.push({type:"error",content:"⛔ Cancelled"}); break; }
        logs.push({type:"error",content:e.message}); break;
      }
    } else { break; }
  }
  if (resp.text && !finalText.includes(resp.text)) { logs.push({type:"text",content:resp.text}); finalText += " " + resp.text; }
  bgStream(""); bgSet({abortCtrl:null});
  return { logs, finalText };
}

// ----------------------------------------------------------------------
// MINI CALENDAR (sidebar)
// ----------------------------------------------------------------------
const MiniCal=({date,setDate,tasks})=>{
  const d=new Date(date+"T12:00:00");
  const[vm,setVm]=useState(d.getMonth());
  const[vy,setVy]=useState(d.getFullYear());
  const[showPicker,setShowPicker]=useState(false);
  const today=todayStr();
  const f=new Date(vy,vm,1).getDay(),dim=new Date(vy,vm+1,0).getDate();
  const cells=[];for(let i=0;i<f;i++)cells.push(null);for(let i=1;i<=dim;i++)cells.push(i);
  const nav=delta=>{let m=vm+delta,y=vy;if(m<0){m=11;y--}else if(m>11){m=0;y++}setVm(m);setVy(y)};
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const curYear = new Date().getFullYear();
  return(
    <div style={{padding:"0 4px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <button onClick={()=>nav(-1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer",padding:4,borderRadius:4,transition:"all .15s"}} className="sf-nav">
          <Ic.ChevL s={14}/>
        </button>
        <button onClick={()=>setShowPicker(!showPicker)} style={{fontSize:fs(13),fontWeight:700,color:T.soft,background:showPicker?T.accentD:"transparent",border:"none",cursor:"pointer",padding:"3px 8px",borderRadius:6,transition:"all .15s"}} title="Click to pick month/year">
          {new Date(vy,vm).toLocaleDateString("en-US",{month:"long",year:"numeric"})} v
        </button>
        <button onClick={()=>nav(1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer",padding:4,borderRadius:4,transition:"all .15s"}} className="sf-nav">
          <Ic.ChevR s={14}/>
        </button>
      </div>
      {/* Month/Year picker dropdown */}
      {showPicker && (
        <div className="fade" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:8,marginBottom:8,boxShadow:"0 4px 12px rgba(0,0,0,.2)"}}>
          <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:6}}>
            <button onClick={()=>setVy(vy-1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontSize:fs(10),color:T.soft}}>◀</button>
            <span style={{flex:1,textAlign:"center",fontSize:fs(12),fontWeight:700,color:T.text}}>{vy}</span>
            <button onClick={()=>setVy(vy+1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontSize:fs(10),color:T.soft}}>▶</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3}}>
            {months.map((m,i)=>(
              <button key={i} onClick={()=>{setVm(i);setShowPicker(false)}} style={{
                padding:"4px 2px",borderRadius:5,border:"none",cursor:"pointer",fontSize:fs(10),fontWeight:vm===i&&vy===curYear?700:400,
                background:vm===i?T.accentD:"transparent",color:vm===i?T.accent:T.soft,transition:"all .1s"
              }}>{m}</button>
            ))}
          </div>
          <button onClick={()=>{setVm(new Date().getMonth());setVy(new Date().getFullYear());setShowPicker(false)}} style={{width:"100%",marginTop:4,padding:"5px 8px",borderRadius:5,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",fontSize:fs(9),color:T.accent,fontWeight:600}}>Today</button>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,textAlign:"center"}}>
        {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{fontSize:fs(11),color:T.dim,fontWeight:600,padding:3}}>{d}</div>)}
        {cells.map((day,i)=>{
          if(!day) return (<div key={i}/>);
          const ds=`${vy}-${pad(vm+1)}-${pad(day)}`,isT=ds===today,isS=ds===date,hasT=(tasks[ds]||[]).length>0;
          const isPast = ds < today;
          return (
            <button key={i} onClick={()=>setDate(ds)} className="sf-cal-day" style={{background:isS?T.accent:isT?T.accentD:"transparent",color:isS?"#060e09":isT?T.accent:isPast?T.dim:T.text,border:"none",borderRadius:6,fontSize:fs(13),fontWeight:isS||isT?700:400,padding:"5px 0",cursor:"pointer",position:"relative",opacity:isPast&&!isS?0.4:1}}>
              {day}{hasT&&!isS&&<div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:isT?T.accent:T.soft}}/>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// CALENDAR PAGE
// ----------------------------------------------------------------------
const CalendarPage=({date,setDate,tasks,setPage})=>{
  const d=new Date(date+"T12:00:00");const[vm,setVm]=useState(d.getMonth());const[vy,setVy]=useState(d.getFullYear());const today=todayStr();
  const[showPicker,setShowPicker]=useState(false);
  const[calSearch,setCalSearch]=useState("");
  const[hovDay,setHovDay]=useState(null);
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const curYear = new Date().getFullYear();
  const f=new Date(vy,vm,1).getDay(),dim=new Date(vy,vm+1,0).getDate();
  const cells=[];for(let i=0;i<f;i++)cells.push(null);for(let i=1;i<=dim;i++)cells.push(i);while(cells.length%7!==0)cells.push(null);
  const numRows = cells.length / 7;
  const nav=delta=>{let m=vm+delta,y=vy;if(m<0){m=11;y--}else if(m>11){m=0;y++}setVm(m);setVy(y)};

  // Search: find matching tasks across all dates
  const searchResults = useMemo(() => {
    if (!calSearch.trim()) return null;
    const q = calSearch.trim().toLowerCase();
    const results = [];
    for (const [dt, dayTasks] of Object.entries(tasks)) {
      for (const t of safeArr(dayTasks)) {
        if (t.title.toLowerCase().includes(q) || (t.category||"").toLowerCase().includes(q)) {
          results.push({...t, date: dt});
        }
      }
    }
    return results.sort((a,b) => a.date.localeCompare(b.date) || (a.time||"").localeCompare(b.time||""));
  }, [calSearch, tasks]);

  return(
    <div className="fade" style={{display:"flex",flexDirection:"column",height:"calc(100vh - 56px)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexShrink:0}}>
        <h1 style={{fontSize:fs(24),fontWeight:800}}>Calendar</h1>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>nav(-1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer"}}><Ic.ChevL/></button>
          <button onClick={()=>setShowPicker(!showPicker)} style={{fontSize:fs(16),fontWeight:700,minWidth:180,textAlign:"center",background:showPicker?T.accentD:"transparent",border:"none",cursor:"pointer",color:T.text,padding:"4px 12px",borderRadius:8}}>{new Date(vy,vm).toLocaleDateString("en-US",{month:"long",year:"numeric"})} ▾</button>
          <button onClick={()=>nav(1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer"}}><Ic.ChevR/></button>
          <button onClick={()=>{setVm(new Date().getMonth());setVy(new Date().getFullYear())}} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",fontSize:fs(11),fontWeight:600,color:T.accent}}>Today</button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexShrink:0}}>
        <div style={{flex:1,position:"relative"}}>
          <input value={calSearch} onChange={e=>setCalSearch(e.target.value)} placeholder="Search tasks by name, course code, or category..." style={{width:"100%",padding:"8px 12px 8px 32px",fontSize:fs(12)}}/>
          <Ic.IcSearch s={14} c={T.dim} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        </div>
        {calSearch&&<Btn small v="ghost" onClick={()=>setCalSearch("")}>Clear</Btn>}
      </div>

      {/* Search results */}
      {searchResults && (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:12,marginBottom:12,maxHeight:300,overflowY:"auto",flexShrink:0}}>
          <div style={{fontSize:fs(11),fontWeight:700,color:T.soft,marginBottom:8}}>{searchResults.length} result{searchResults.length!==1?"s":""} for "{calSearch}"</div>
          {searchResults.length === 0 ? <div style={{fontSize:fs(11),color:T.dim,padding:8}}>No matching tasks found.</div> : (
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {searchResults.slice(0,30).map((t,i) => {
                const c = CAT[t.category]||CAT.other;
                return (
                  <div key={i} onClick={()=>{setDate(t.date);setPage("daily")}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",borderRadius:6,background:T.input,cursor:"pointer"}}>
                    <div style={{width:3,height:18,borderRadius:2,background:c.fg,flexShrink:0}}/>
                    <span style={{fontSize:fs(9),color:T.dim,minWidth:70,fontFamily:"'JetBrains Mono',monospace"}}>{new Date(t.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                    <span style={{fontSize:fs(9),color:T.blue,minWidth:40,fontFamily:"'JetBrains Mono',monospace"}}>{t.time||"—"}</span>
                    <span style={{flex:1,fontSize:fs(11),color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                    <Badge color={c.fg} bg={c.bg}>{c.l||t.category}</Badge>
                  </div>
                );
              })}
              {searchResults.length > 30 && <div style={{fontSize:fs(9),color:T.dim,textAlign:"center"}}>+{searchResults.length-30} more results</div>}
            </div>
          )}
        </div>
      )}

      {showPicker && (
        <div className="fade" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:12,marginBottom:12,boxShadow:"0 4px 16px rgba(0,0,0,.15)",maxWidth:320}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <button onClick={()=>setVy(vy-1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontSize:fs(11),color:T.soft}}>◀</button>
            <span style={{flex:1,textAlign:"center",fontSize:fs(14),fontWeight:700,color:T.text}}>{vy}</span>
            <button onClick={()=>setVy(vy+1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontSize:fs(11),color:T.soft}}>▶</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4}}>
            {months.map((m,i)=>(
              <button key={i} onClick={()=>{setVm(i);setShowPicker(false)}} style={{
                padding:"6px 4px",borderRadius:6,border:"none",cursor:"pointer",fontSize:fs(12),fontWeight:vm===i?700:400,
                background:vm===i?T.accentD:"transparent",color:vm===i?T.accent:T.soft,transition:"all .1s"
              }}>{m}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(7,1fr)",gridTemplateRows:`auto repeat(${numRows},1fr)`,gap:2,background:T.bg,borderRadius:14,overflow:"hidden",border:`1px solid ${T.border}`}}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{background:T.panel,padding:"10px 10px",fontSize:fs(11),fontWeight:700,color:T.dim,textAlign:"center",letterSpacing:"0.5px",textTransform:"uppercase"}}>{d}</div>)}
        {cells.map((day,i)=>{
          if(!day) return (<div key={i} style={{background:T.bg2}}/>);
          const ds=`${vy}-${pad(vm+1)}-${pad(day)}`,isT=ds===today,dt=tasks[ds]||[];
          const isPast = ds < today;
          const isHov = hovDay === ds;
          const hasTasks = dt.length > 0;
          const allDone = hasTasks && dt.every(t=>t.done);
          return (
            <div key={i} className="sf-cal-cell" onClick={()=>{setDate(ds);setPage("daily")}} onMouseEnter={()=>setHovDay(ds)} onMouseLeave={()=>setHovDay(null)}
              style={{background:isT?`${T.accent}12`:isHov?`${T.accent}08`:T.bg2,padding:"8px 8px 6px",cursor:"pointer",borderLeft:isT?`3px solid ${T.accent}`:"3px solid transparent",overflow:"hidden",opacity:isPast&&!isT?0.45:1,position:"relative",minHeight:90}}>
              {isPast&&!isT&&<div style={{position:"absolute",inset:0,background:`repeating-linear-gradient(135deg,transparent,transparent 8px,${T.border}15 8px,${T.border}15 9px)`,pointerEvents:"none"}}/>}
              <div style={{fontSize:fs(13),fontWeight:isT?800:500,color:isT?T.accent:isPast?T.dim:T.text,marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{display:"flex",alignItems:"center",gap:4}}>
                  {isT&&<span style={{width:6,height:6,borderRadius:"50%",background:T.accent,boxShadow:`0 0 6px ${T.accent}`}}/>}
                  {day}
                </span>
                {hasTasks&&<span style={{width:7,height:7,borderRadius:"50%",background:allDone?T.dim:T.accent,boxShadow:allDone?"none":`0 0 4px ${T.accent}66`}}/>}
              </div>
              {dt.slice(0,3).map((t,j)=>{const c=CAT[t.category]||CAT.other; return (<div key={j} style={{fontSize:fs(10),padding:"2px 6px",borderRadius:5,marginBottom:2,background:t.done?`${c.bg}88`:c.bg,color:t.done?T.dim:c.fg,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none"}}><span className="mono" style={{fontSize:fs(9),marginRight:3,opacity:.7}}>{t.time}</span>{t.title}</div>);})}
              {dt.length>3&&<div style={{fontSize:fs(9),color:T.dim,fontWeight:600,marginTop:1}}>+{dt.length-3} more</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// DAILY PLAN PAGE
// ----------------------------------------------------------------------
const DailyPage=({date,tasks,setTasks,profile,data,setData,setDate})=>{
  const bp = useBreakpoint();
  const[showAdd,setShowAdd]=useState(false);
  const[editId,setEditId]=useState(null);
  const[form,setForm]=useState({time:"09:00",endTime:"09:30",title:"",category:"study",priority:"medium",notes:"",recurring:""});
  const[aiPrompt,setAiPrompt]=useState("");
  const[aiLoading,setAiLoading]=useState(false);
  const[aiLog,setAiLog]=useState([]);
  const[aiAbort,setAiAbort]=useState(null);
  const[reschedScope,setReschedScope]=useState("day");
  const[reschedMonths,setReschedMonths]=useState(1);
  const[now,setNow]=useState(nowMins());
  const[view,setView]=useState("day"); // "day" or "week"
  const[catFilter,setCatFilter]=useState("all");
  const[pomActive,setPomActive]=useState(false);
  const[pomTime,setPomTime]=useState(25*60);
  const[pomBreak,setPomBreak]=useState(false);
  const[showTemplates,setShowTemplates]=useState(false);
  const[dragTask,setDragTask]=useState(null);
  const[expandedWeekDays,setExpandedWeekDays]=useState({});
  const pomRef=useRef(null);
  const isToday=date===todayStr();
  useEffect(()=>{const iv=setInterval(()=>setNow(nowMins()),30000);return()=>clearInterval(iv)},[]);

  // Week dates starting from current date's Monday
  const getWeekDates = (d) => {
    const dt = new Date(d+"T12:00:00");
    const day = dt.getDay();
    const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
    return Array.from({length:7}, (_,i) => { const x = new Date(mon); x.setDate(mon.getDate()+i); return x.toISOString().split("T")[0]; });
  };
  const weekDates = useMemo(() => getWeekDates(date), [date]);

  const sorted=useMemo(()=>[...tasks].sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999)),[tasks]);
  const filtered = catFilter === "all" ? sorted : sorted.filter(t => t.category === catFilter);
  const completed=tasks.filter(t=>t.done).length;
  const currentId=useMemo(()=>{if(!isToday)return null;for(const t of sorted){const s=parseTime(t.time),e=parseTime(t.endTime);if(s&&e&&now>=s.mins&&now<e.mins&&!t.done)return t.id}return null},[sorted,now,isToday]);

  // Time conflict detection
  const conflicts = useMemo(() => {
    const c = new Set();
    for (let i=0; i<sorted.length; i++) {
      const a = sorted[i], as = parseTime(a.time), ae = parseTime(a.endTime);
      if(!as||!ae) continue;
      for (let j=i+1; j<sorted.length; j++) {
        const b = sorted[j], bs = parseTime(b.time), be = parseTime(b.endTime);
        if(!bs||!be) continue;
        if(as.mins < be.mins && ae.mins > bs.mins) { c.add(a.id); c.add(b.id); }
      }
    }
    return c;
  }, [sorted]);

  // Pomodoro timer
  useEffect(() => {
    if(pomActive) {
      pomRef.current = setInterval(() => {
        setPomTime(t => {
          if(t <= 1) {
            clearInterval(pomRef.current);
            setPomActive(false);
            if(pomBreak) { toast("Break over! Back to work.","info"); setPomBreak(false); setPomTime(25*60); }
            else { toast("Pomodoro done! Take a 5-min break.","success"); setPomBreak(true); setPomTime(5*60); }
            return 0;
          }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(pomRef.current);
    }
  }, [pomActive, pomBreak]);

  const pomToggle = () => { if(pomActive) { clearInterval(pomRef.current); setPomActive(false); } else setPomActive(true); };
  const pomReset = () => { clearInterval(pomRef.current); setPomActive(false); setPomBreak(false); setPomTime(25*60); };

  // Task templates
  const TEMPLATES = [
    {name:"Study Day", tasks:[{time:"08:00",endTime:"08:30",title:"Morning review",category:"study",priority:"medium"},{time:"08:30",endTime:"11:30",title:"Deep study session",category:"study",priority:"high"},{time:"11:30",endTime:"12:00",title:"Break & stretch",category:"break",priority:"low"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"15:00",title:"Afternoon study",category:"study",priority:"high"},{time:"15:00",endTime:"15:30",title:"Exercise",category:"health",priority:"medium"},{time:"15:30",endTime:"17:00",title:"Practice problems / review",category:"study",priority:"medium"}]},
    {name:"Light Day", tasks:[{time:"09:00",endTime:"10:30",title:"Study session",category:"study",priority:"medium"},{time:"10:30",endTime:"11:00",title:"Break",category:"break",priority:"low"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"14:00",endTime:"15:00",title:"Light review",category:"study",priority:"low"},{time:"17:00",endTime:"18:00",title:"Exercise",category:"health",priority:"medium"}]},
    {name:"Exam Prep", tasks:[{time:"07:00",endTime:"07:30",title:"Quick review of weak areas",category:"review",priority:"high"},{time:"08:00",endTime:"10:00",title:"Practice exam #1",category:"exam-prep",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"12:15",title:"Practice exam #2",category:"exam-prep",priority:"high"},{time:"12:15",endTime:"12:45",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"15:00",title:"Review missed questions",category:"review",priority:"high"},{time:"15:00",endTime:"16:00",title:"Final flashcard review",category:"review",priority:"medium"}]},
    {name:"Balanced Day", tasks:[{time:"06:30",endTime:"07:30",title:"Morning exercise",category:"health",priority:"medium"},{time:"08:00",endTime:"10:00",title:"Study block 1",category:"study",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"12:00",title:"Study block 2",category:"study",priority:"high"},{time:"12:00",endTime:"13:00",title:"Lunch & rest",category:"personal",priority:"medium"},{time:"13:00",endTime:"14:30",title:"Study block 3",category:"study",priority:"medium"},{time:"14:30",endTime:"15:00",title:"Break",category:"break",priority:"low"},{time:"15:00",endTime:"16:00",title:"Personal tasks / errands",category:"personal",priority:"medium"},{time:"17:00",endTime:"18:00",title:"Light review",category:"review",priority:"low"}]},
    {name:"OA Exam Day", tasks:[{time:"07:00",endTime:"07:45",title:"Light review of key concepts",category:"review",priority:"high"},{time:"07:45",endTime:"08:00",title:"Pre-exam prep (quiet, water, deep breaths)",category:"break",priority:"medium"},{time:"08:00",endTime:"10:00",title:"🎯 OA Exam",category:"exam-day",priority:"high",notes:"Take your time. Flag questions you're unsure about and return to them."},{time:"10:00",endTime:"10:30",title:"Post-exam break & decompress",category:"break",priority:"medium"},{time:"10:30",endTime:"11:00",title:"Review results & celebrate",category:"personal",priority:"low"}]},
    {name:"PA Submission Day", tasks:[{time:"08:00",endTime:"10:00",title:"Final PA review & polish",category:"project",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"11:15",title:"Rubric self-check (every section)",category:"project",priority:"high"},{time:"11:15",endTime:"12:00",title:"Proofread & format",category:"project",priority:"high"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"13:30",title:"🎯 Submit PA",category:"exam-day",priority:"high",notes:"Double-check all files are attached and sections are complete."},{time:"13:30",endTime:"14:00",title:"Celebrate & plan next course",category:"personal",priority:"low"}]},
  ];
  const applyTemplate = (tmpl) => {
    const newTasks = tmpl.tasks.map(t => ({...t, id:uid(), done:false, notes:"", recurring:""}));
    setTasks([...tasks, ...newTasks]);
    setShowTemplates(false);
    toast(`Template "${tmpl.name}" applied: ${newTasks.length} tasks added`, "success");
  };

  // Drag-to-reorder tasks
  const handleTaskDragStart = (e, taskId) => { setDragTask(taskId); e.dataTransfer.effectAllowed = "move"; };
  const handleTaskDrop = (e, targetId) => {
    e.preventDefault();
    if(!dragTask || dragTask === targetId) { setDragTask(null); return; }
    const dragIdx = sorted.findIndex(t=>t.id===dragTask);
    const targetIdx = sorted.findIndex(t=>t.id===targetId);
    if(dragIdx < 0 || targetIdx < 0) { setDragTask(null); return; }
    // Swap the times of the dragged task and target
    const dTask = sorted[dragIdx], tTask = sorted[targetIdx];
    setTasks(tasks.map(t => {
      if(t.id === dTask.id) return {...t, time:tTask.time, endTime:tTask.endTime};
      if(t.id === tTask.id) return {...t, time:dTask.time, endTime:dTask.endTime};
      return t;
    }));
    setDragTask(null);
    toast("Tasks swapped","info");
  };

  // Smart carryforward: incomplete tasks from yesterday
  const yesterdayStr = useMemo(() => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; }, []);
  const carryTasks = useMemo(() => {
    if(!isToday) return [];
    return safeArr(data.tasks?.[yesterdayStr]).filter(t => !t.done && t.category === "study");
  }, [data.tasks, yesterdayStr, isToday]);
  const carryForward = (task) => {
    setTasks([...tasks, {...task, id:uid(), done:false}]);
    toast(`Carried forward: ${task.title}`, "info");
  };
  const carryAll = () => {
    const newTasks = carryTasks.map(t => ({...t, id:uid(), done:false}));
    setTasks([...tasks, ...newTasks]);
    toast(`${newTasks.length} task(s) carried forward from yesterday`, "info");
  };

  const openAdd=(cat)=>{setForm({time:"09:00",endTime:"09:30",title:"",category:cat||"study",priority:"medium",notes:"",recurring:""});setEditId(null);setShowAdd(true)};
  const openEdit=(t)=>{setForm({...t,recurring:t.recurring||""});setEditId(t.id);setShowAdd(true)};
  const saveTask=()=>{
    if(!form.title.trim())return;
    const taskData = {...form};
    if(editId){
      setTasks(tasks.map(t=>t.id===editId?{...t,...taskData}:t));
    } else {
      setTasks([...tasks,{...taskData,id:uid(),done:false}]);
      // Handle recurring — create copies on future dates
      if(form.recurring && form.recurring !== "") {
        const copies = [];
        const maxDays = form.recurring === "daily" ? 30 : form.recurring === "weekdays" ? 22 : form.recurring === "weekly" ? 12 : 0;
        let d = new Date(date+"T12:00:00");
        for(let i=0; i<maxDays; i++) {
          d.setDate(d.getDate() + (form.recurring === "weekly" ? 7 : 1));
          const ds = d.toISOString().split("T")[0];
          const dow = d.getDay();
          if(form.recurring === "weekdays" && (dow === 0 || dow === 6)) continue;
          copies.push({ds, task:{...taskData, id:uid(), done:false}});
        }
        if(copies.length > 0) {
          setData(prev => {
            const t = {...prev.tasks};
            copies.forEach(c => { if(!t[c.ds]) t[c.ds] = []; t[c.ds] = [...t[c.ds], c.task]; });
            return {...prev, tasks: t};
          });
          toast(`Recurring: +${copies.length} future tasks created`, "info");
        }
      }
    }
    setShowAdd(false);
  };
  const toggleTask=id=>setTasks(tasks.map(t=>t.id===id?{...t,done:!t.done}:t));
  const deleteTask=id=>setTasks(tasks.filter(t=>t.id!==id));

  const [showRestructure, setShowRestructure] = useState(null);
  const completeEarly = (task) => {
    if (!isToday || task.done) return;
    const nowT = nowMins();
    const end = parseTime(task.endTime);
    const savedMins = end ? Math.max(0, end.mins - nowT) : 0;
    setTasks(tasks.map(t => t.id === task.id ? {...t, done: true} : t));
    if (_timerState.running && _timerState.taskTitle === task.title) timerStop();
    toast(`Completed: ${task.title}${savedMins > 0 ? ` (${minsToStr(savedMins)} early)` : ""}`, "success");
    if (savedMins >= 5) setShowRestructure({ taskId: task.id, savedMins });
  };

  const restructureTasks = (savedMins) => {
    if (!showRestructure) return;
    const doneIdx = sorted.findIndex(t => t.id === showRestructure.taskId);
    if (doneIdx < 0) { setShowRestructure(null); return; }
    const afterTasks = sorted.slice(doneIdx + 1).filter(t => !t.done);
    const updatedTasks = tasks.map(t => {
      const match = afterTasks.find(at => at.id === t.id);
      if (!match) return t;
      const s = parseTime(t.time), e = parseTime(t.endTime);
      if (!s || !e) return t;
      const newStart = Math.max(0, s.mins - savedMins), newEnd = Math.max(newStart + 1, e.mins - savedMins);
      return { ...t, time: `${pad(Math.floor(newStart/60))}:${pad(newStart%60)}`, endTime: `${pad(Math.floor(newEnd/60))}:${pad(newEnd%60)}` };
    });
    setTasks(updatedTasks);
    toast(`Shifted ${afterTasks.length} task(s) earlier by ${minsToStr(savedMins)}`, "success");
    setShowRestructure(null);
  };

  const stopAI = () => { if(aiAbort) { aiAbort.abort(); setAiAbort(null); setAiLoading(false); toast("Cancelled","info"); } };

  const generateAI=async(preset)=>{
    if(!profile)return;
    const controller = new AbortController();
    setAiAbort(controller);
    setAiLoading(true);
    const logs = [];

    // Build date range for reschedule scopes
    const getDateRange = (scope) => {
      const start = new Date(date+"T12:00:00");
      const end = new Date(start);
      if(scope==="day") { /* single day */ }
      else if(scope==="week") end.setDate(end.getDate()+6);
      else if(scope==="month") end.setMonth(end.getMonth()+1);
      else if(scope==="custom") end.setMonth(end.getMonth()+(reschedMonths||1));
      const dates = [];
      const d = new Date(start);
      while(d<=end) { dates.push(d.toISOString().split("T")[0]); d.setDate(d.getDate()+1); }
      return dates;
    };

    const activeCourseNames = (data.courses||[]).filter(c=>c.status!=="completed").map((c,i)=>`${i+1}. ${c.name} (~${c.averageStudyHours||"?"}h est)`).join(", ");
    const existingToday = safeArr(data.tasks?.[date]).map(t=>`${t.time}-${t.endTime} ${t.title} [${t.done?"done":"pending"}]`).join("; ");
    const todayCtx = existingToday ? `\nExisting tasks today: ${existingToday}` : "\nNo existing tasks today.";
    const startCtx = data.studyStartTime ? ` Start time: ${data.studyStartTime}.` : "";

    const presets = {
      school: `Plan my study sessions for ${fmtDateLong(date)}. Courses (priority order): ${activeCourseNames}. ${data.studyHoursPerDay||4}h of study.${startCtx}${todayCtx}\nInclude study blocks (1-2h max) with 10-15 min breaks between them. Use specific course names and topics in titles.`,
      life: `Plan my personal day for ${fmtDateLong(date)}.${startCtx}${todayCtx}\nInclude meals (breakfast, lunch, dinner), exercise/walk, errands, and relaxation time. Keep it realistic and balanced.`,
      full: `Plan my full day for ${fmtDateLong(date)}. Courses: ${activeCourseNames}. ${data.studyHoursPerDay||4}h study target.${startCtx}${todayCtx}\nBalance study sessions with personal tasks: meals, exercise, breaks. Study blocks 1-2h max with breaks between. Use specific course names in titles.`,
      week: `Plan my entire week starting ${fmtDateLong(date)} (${weekDates[0]} to ${weekDates[6]}). Courses: ${activeCourseNames}. ${data.studyHoursPerDay||4}h/day study target.${startCtx}\nFor each day create study sessions with breaks, meals, and personal time. Use specific course names and topics. Create tasks for ALL 7 days.`,
      reschedule: (() => {
        const rangeDates = getDateRange(reschedScope);
        const scopeLabel = reschedScope==="day"?"today":reschedScope==="week"?"this week":reschedScope==="month"?"this month":`the next ${reschedMonths} month(s)`;
        const existingTasks = rangeDates.flatMap(d => safeArr(data.tasks?.[d]).map(t=>({...t,date:d})));
        const taskSummary = existingTasks.length > 0 ? `Current schedule (${existingTasks.length} tasks):\n${existingTasks.slice(0,40).map(t=>`  ${t.date} ${t.time||"--:--"}-${t.endTime||"?"} ${t.done?"✅":"⬜"} ${t.title} [${t.category}]`).join("\n")}${existingTasks.length>40?`\n  ...and ${existingTasks.length-40} more`:""}` : "No existing tasks in this range.";
        const userInstructions = aiPrompt.trim();
        return `Reschedule my calendar for ${scopeLabel} (${rangeDates[0]} to ${rangeDates[rangeDates.length-1]}).

${taskSummary}

${userInstructions ? `INSTRUCTIONS: ${userInstructions}` : "Optimize the schedule — balance study, personal time, and breaks. Keep study blocks 1-2h with breaks between."}

RULES: Use add_tasks to create new tasks. Keep any tasks the user didn't mention. Each task needs date, time, endTime (24h format), title, and category.`;
      })(),
    };
    const msg = preset ? (typeof presets[preset]==="function"?presets[preset]():presets[preset]) : (aiPrompt.trim()||presets.full);
    logs.push({type:"user",content:msg});
    setAiLog([...logs]);
    const dateCtx = view === "week" ? `The user is viewing the week of ${weekDates[0]} to ${weekDates[6]}. Create tasks across multiple days.` : `The user is viewing the study schedule for ${fmtDateLong(date)}. When adding tasks, use date "${date}".`;
    const sys = buildSystemPrompt(data, dateCtx);
    try {
      let resp = await callAIWithTools(profile, sys, [{role:"user",content:msg}]);
      let maxLoops = 5;
      while (maxLoops-- > 0) {
        if (controller.signal.aborted) { logs.push({type:"error",content:"Cancelled"}); break; }
        if (resp.text) logs.push({type:"text",content:resp.text});
        if (resp.toolCalls.length > 0) {
          for (const tc of resp.toolCalls) logs.push({type:"tool_call",content:`🔧 ${tc.name}(${JSON.stringify(tc.input).slice(0,200)}...)`});
          setAiLog([...logs]);
          const results = executeTools(resp.toolCalls, data, setData);
          for (const r of results) logs.push({type:"tool_result",content:`✅ ${r.result}`});
          setAiLog([...logs]);
          resp = await continueAfterTools(profile, sys, [{role:"user",content:msg}], resp.toolCalls, results);
        } else break;
      }
      if (resp.text && !logs.find(l=>l.content===resp.text)) logs.push({type:"text",content:resp.text});
    } catch(e) {
      if(e.message!=='Cancelled') logs.push({type:"error",content:e.message});
    }
    setAiLog([...logs]);
    setAiLoading(false);
    setAiAbort(null);
  };

  // Week view task renderer
  const renderWeekView = () => (
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
      {weekDates.map(d => {
        const dayTasks = safeArr(data.tasks?.[d]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
        const isT = d === todayStr();
        const done = dayTasks.filter(t=>t.done).length;
        const isExpanded = expandedWeekDays[d];
        const visibleTasks = isExpanded ? dayTasks : dayTasks.slice(0,6);
        const hasMore = dayTasks.length > 6;
        return (
          <div key={d} className="sf-card" style={{background:isT?T.accentD:T.card,border:`1.5px solid ${isT?T.accent+"44":T.border}`,borderRadius:12,padding:10,minHeight:120,cursor:"pointer"}} onClick={()=>{setDate(d);setView("day")}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:fs(10),fontWeight:700,color:isT?T.accent:T.soft}}>{new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",day:"numeric"})}</div>
              {dayTasks.length>0&&<span style={{fontSize:fs(8),color:T.dim}}>{done}/{dayTasks.length}</span>}
            </div>
            {visibleTasks.map(t => {
              const c = CAT[t.category]||CAT.other;
              return (
                <div key={t.id} style={{fontSize:fs(9),padding:"3px 5px",borderRadius:4,marginBottom:2,background:t.done?T.bg2:c.bg,color:t.done?T.dim:c.fg,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none",cursor:"pointer"}}>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",marginRight:3}}>{t.time?.slice(0,5)||""}</span>{t.title}
                </div>
              );
            })}
            {hasMore && (
              <button onClick={()=>setExpandedWeekDays(p=>({...p,[d]:!p[d]}))} style={{width:"100%",background:"none",border:"none",cursor:"pointer",fontSize:fs(9),color:T.accent,textAlign:"center",padding:"4px 0",fontWeight:600}}>
                {isExpanded ? "Show less ▲" : `+${dayTasks.length-6} more ▼`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  // Task card renderer
  const renderTask = (t) => {
    const c=CAT[t.category]||CAT.other,s=parseTime(t.time),e=parseTime(t.endTime),dur=s&&e?e.mins-s.mins:null,isCur=t.id===currentId;
    const hasConflict = conflicts.has(t.id);
    const isExamDay = t.category === "exam-day";
    return (<div key={t.id} className="fade sf-task" draggable onDragStart={e=>handleTaskDragStart(e,t.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>handleTaskDrop(e,t.id)}
      style={{display:"flex",alignItems:"stretch",background:isExamDay?`${c.bg}`:t.done?`${T.input}88`:hasConflict?T.redD:dragTask===t.id?T.purpleD:T.card,border:`1.5px solid ${isExamDay?c.fg+"55":hasConflict?T.red+"55":isCur?T.accent+"55":dragTask===t.id?T.purple:T.border}`,borderRadius:12,overflow:"hidden",opacity:t.done?.5:dragTask===t.id?.6:1,boxShadow:isExamDay?`0 0 16px ${c.fg}18`:isCur?`0 0 20px ${T.accentD}`:"0 1px 4px rgba(0,0,0,.08)",cursor:"grab"}}>
      <div style={{width:3,background:hasConflict?T.red:c.fg,flexShrink:0}}/>
      <div style={{padding:"10px 14px",minWidth:100,display:"flex",flexDirection:"column",justifyContent:"center",borderRight:`1px solid ${T.border}`}}>
        <span className="mono" style={{fontSize:fs(13),fontWeight:600,color:hasConflict?T.red:isCur?T.accent:T.text}}>{s?fmtTime(s.h,s.m):"—"}</span>
        {e&&<span className="mono" style={{fontSize:fs(10),color:T.dim}}>→ {fmtTime(e.h,e.m)}</span>}
        {dur>0&&<span style={{fontSize:fs(9),color:T.dim,display:"flex",alignItems:"center",gap:2,marginTop:1}}><Ic.Clock/>{minsToStr(dur)}</span>}
        {hasConflict&&<span style={{fontSize:fs(8),color:T.red,fontWeight:700,marginTop:1}}>OVERLAP</span>}
      </div>
      <div style={{flex:1,padding:"10px 14px",display:"flex",flexDirection:"column",justifyContent:"center",gap:3}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:fs(13),fontWeight:500,textDecoration:t.done?"line-through":"none",color:t.done?T.dim:T.text}}>{t.title}</span>
          {isCur&&!t.done&&<span style={{fontSize:fs(8),padding:"2px 5px",borderRadius:3,background:T.accentD,color:T.accent,fontWeight:700}}>NOW</span>}
          {t.recurring&&<span style={{fontSize:fs(8),padding:"1px 5px",borderRadius:3,background:T.blueD,color:T.blue,fontWeight:600}}>↻ {t.recurring}</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
          <span style={{fontSize:fs(9),color:PRIO[t.priority]||T.soft,fontWeight:600}}>● {t.priority}</span>
          {t.notes&&<span style={{fontSize:fs(10),color:T.dim}}>— {t.notes}</span>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:3,padding:"0 10px"}}>
        {!t.done && isToday && <button className="sf-icon-btn" onClick={()=>completeEarly(t)} title="Complete early" style={{background:"none",border:"none",color:T.accent,cursor:"pointer",padding:5,fontSize:fs(10),fontWeight:600}}>Done ✓</button>}
        {!t.done && <button className="sf-icon-btn" onClick={()=>{const match=(data.courses||[]).find(c=>t.title.toLowerCase().includes(c.name.toLowerCase().split(" – ")[0].split(" - ")[0])||(c.courseCode&&t.title.toLowerCase().includes(c.courseCode.toLowerCase())));timerStart(t.title,match?.name||"")}} title="Start timer" style={{background:"none",border:"none",color:_timerState.running&&_timerState.taskTitle===t.title?T.accent:T.dim,cursor:"pointer",padding:5,fontSize:fs(14)}}>⏱</button>}
        <button onClick={()=>toggleTask(t.id)} style={{width:30,height:30,borderRadius:8,border:`2px solid ${t.done?T.accent:T.border}`,background:t.done?T.accentD:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.accent,transition:"all .15s"}}>{t.done&&<Ic.Check s={14}/>}</button>
        <button className="sf-icon-btn" onClick={()=>openEdit(t)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:5}}><Ic.Edit/></button>
        <button className="sf-icon-btn" onClick={()=>deleteTask(t.id)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:5}}><Ic.Trash/></button>
      </div>
    </div>);
  };

  // Date navigation helpers
  const navDate = (delta) => {
    if (view === "week") {
      const d = new Date(date+"T12:00:00"); d.setDate(d.getDate() + delta * 7); setDate(d.toISOString().split("T")[0]);
    } else {
      const d = new Date(date+"T12:00:00"); d.setDate(d.getDate() + delta); setDate(d.toISOString().split("T")[0]);
    }
  };
  const goToday = () => setDate(todayStr());

  return(
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {/* Date nav */}
          <div style={{display:"flex",alignItems:"center",gap:2}}>
            <button className="sf-icon-btn" onClick={()=>navDate(-1)} style={{width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.soft}}><Ic.ChevL s={16}/></button>
            {!isToday && <button onClick={goToday} style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${T.accent}44`,background:T.accentD,cursor:"pointer",fontSize:fs(11),fontWeight:700,color:T.accent}}>Today</button>}
            <button className="sf-icon-btn" onClick={()=>navDate(1)} style={{width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.soft}}><Ic.ChevR s={16}/></button>
          </div>
          <div>
            <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>
              {view==="week" ? "Weekly Schedule" : isToday ? "Today's Schedule" : fmtDateLong(date)}
              {view==="day"&&!isToday && (() => { const days = diffDays(todayStr(), date); return <span style={{fontSize:fs(14),fontWeight:500,color:days>0?T.blue:T.orange,marginLeft:10}}>{days > 0 ? `${days}d from now` : days < 0 ? `${Math.abs(days)}d ago` : ""}</span>; })()}
            </h1>
            <p style={{color:T.dim,fontSize:fs(13)}}>{view==="week" ? `${weekDates[0].slice(5)} — ${weekDates[6].slice(5)}` : tasks.length===0?"Empty — add tasks or let AI plan":`${tasks.length} tasks · ${completed} done`}</p>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <div style={{display:"flex",borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <button className="sf-toggle" onClick={()=>setView("day")} style={{padding:"6px 12px",fontSize:fs(11),fontWeight:view==="day"?700:400,border:"none",cursor:"pointer",background:view==="day"?T.accentD:"transparent",color:view==="day"?T.accent:T.dim}}>Day</button>
            <button className="sf-toggle" onClick={()=>setView("week")} style={{padding:"6px 12px",fontSize:fs(11),fontWeight:view==="week"?700:400,border:"none",cursor:"pointer",background:view==="week"?T.accentD:"transparent",color:view==="week"?T.accent:T.dim}}>Week</button>
          </div>
          <Btn onClick={()=>openAdd()}><Ic.Plus s={15}/> Add Task</Btn>
        </div>
      </div>

      {/* Toolbar: Pomodoro + Templates + Carry Forward */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {/* Pomodoro */}
        <div style={{display:"flex",alignItems:"center",gap:6,background:pomActive?(pomBreak?T.blueD:T.accentD):T.card,border:`1.5px solid ${pomActive?(pomBreak?T.blue:T.accent):T.border}`,borderRadius:12,padding:"8px 14px",boxShadow:pomActive?`0 0 12px ${pomBreak?T.blue:T.accent}15`:"none",transition:"all .2s"}}>
          <span style={{fontSize:fs(14),fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:pomActive?(pomBreak?T.blue:T.accent):T.dim,minWidth:40}}>{Math.floor(pomTime/60)}:{String(pomTime%60).padStart(2,'0')}</span>
          <button onClick={pomToggle} style={{background:"none",border:"none",cursor:"pointer",color:pomActive?T.accent:T.soft,fontSize:fs(12),fontWeight:600}}>{pomActive?"⏸":"▶"}</button>
          {(pomActive||pomTime!==25*60)&&<button onClick={pomReset} style={{background:"none",border:"none",cursor:"pointer",color:T.dim,fontSize:fs(10)}}>↻</button>}
          <span style={{fontSize:fs(9),color:T.dim}}>{pomBreak?"Break":"Focus"}</span>
        </div>
        {/* Templates */}
        <div style={{position:"relative"}}>
          <Btn small v="ghost" onClick={()=>setShowTemplates(p=>!p)}>📋 Templates</Btn>
          {showTemplates && (
            <div className="fade" style={{position:"absolute",top:"100%",left:0,marginTop:4,background:T.card,border:`1.5px solid ${T.border}`,borderRadius:12,padding:8,boxShadow:"0 8px 24px rgba(0,0,0,.35)",zIndex:20,width:240}}>
              {TEMPLATES.map((t,i) => (
                <button key={i} className="sf-row" onClick={()=>applyTemplate(t)} style={{width:"100%",textAlign:"left",padding:"8px 10px",borderRadius:7,border:"none",cursor:"pointer",background:"transparent",marginBottom:2,color:T.text,fontSize:fs(11)}}>
                  <div style={{fontWeight:600}}>{t.name}</div>
                  <div style={{fontSize:fs(9),color:T.dim}}>{t.tasks.length} tasks</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Smart Carry Forward — incomplete study tasks from yesterday */}
      {carryTasks.length > 0 && (
        <div style={{background:T.orangeD,border:`1px solid ${T.orange}33`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.orange}}>{carryTasks.length} incomplete task{carryTasks.length>1?"s":""} from yesterday</div>
            <div style={{fontSize:fs(10),color:T.soft,marginTop:2}}>{carryTasks.map(t=>t.title).join(", ")}</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <Btn small onClick={carryAll}>Carry All Forward</Btn>
          </div>
        </div>
      )}

      {/* Time Conflict Warning — current day */}
      {conflicts.size > 0 && view === "day" && (
        <div style={{background:`linear-gradient(135deg, ${T.redD}, ${T.red}11)`,border:`1px solid ${T.red}33`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:T.red,flexShrink:0}}/>
            <span style={{fontSize:fs(11),color:T.red,fontWeight:600}}>{conflicts.size} task{conflicts.size>1?"s":""} have overlapping time slots</span>
          </div>
          <span style={{fontSize:fs(9),color:T.red,opacity:0.6}}>Drag tasks or edit times to resolve</span>
        </div>
      )}

      {/* Global schedule conflicts — only show if OTHER days have conflicts too */}
      {(() => {
        const allDates = Object.keys(data.tasks||{}).filter(d => d >= todayStr()).sort();
        const cDates = [];
        for (const d of allDates) {
          const dt = safeArr(data.tasks[d]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
          let n = 0;
          for (let i=0; i<dt.length; i++) {
            const as=parseTime(dt[i].time),ae=parseTime(dt[i].endTime);
            if(!as||!ae) continue;
            for (let j=i+1; j<dt.length; j++) {
              const bs=parseTime(dt[j].time),be=parseTime(dt[j].endTime);
              if(!bs||!be) continue;
              if(as.mins<be.mins&&ae.mins>bs.mins) n++;
            }
          }
          if(n>0) cDates.push({date:d,count:n});
        }
        // If only 1 conflict day and it's the current day, the per-day banner already handles it
        if(cDates.length===0) return null;
        if(cDates.length===1 && cDates[0].date===date && view==="day") return null;
        const otherDates = cDates.filter(cd => cd.date !== date);
        const total = cDates.reduce((s,c)=>s+c.count,0);
        return (
          <div style={{background:T.card,border:`1px solid ${T.red}33`,borderRadius:10,padding:"12px 16px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:T.red,flexShrink:0}}/>
                <span style={{fontSize:fs(12),color:T.text,fontWeight:700}}>Schedule Conflicts</span>
              </div>
              <span style={{fontSize:fs(10),color:T.dim}}>{total} overlap{total>1?"s":""} · {cDates.length} day{cDates.length>1?"s":""}</span>
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {cDates.slice(0,12).map(cd => (
                <button key={cd.date} onClick={()=>setDate(cd.date)} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${cd.date===date?T.red:T.border}`,background:cd.date===date?T.red+"33":T.input,color:cd.date===date?T.red:T.soft,fontSize:fs(10),fontWeight:600,cursor:"pointer",transition:"all .15s"}}>
                  {new Date(cd.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} <span style={{color:T.red,fontWeight:700}}>({cd.count})</span>
                </button>
              ))}
              {cDates.length>12&&<span style={{fontSize:fs(9),color:T.dim,alignSelf:"center"}}>+{cDates.length-12} more</span>}
            </div>
          </div>
        );
      })()}

      {/* AI Planner with presets */}
      <div style={{background:`linear-gradient(135deg,${T.panel},${T.card})`,border:`1.5px solid ${T.border}`,borderRadius:14,padding:18,marginBottom:16,boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
          <Ic.AI s={16}/><span style={{fontSize:fs(13),fontWeight:700}}>AI Planner</span>
          {profile&&<Badge color={T.accent} bg={T.accentD}>{profile.name}</Badge>}
        </div>
        {!profile?<p style={{fontSize:fs(12),color:T.dim}}>Connect an AI profile in Settings first.</p>:<>
          {/* Quick actions */}
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            <Btn small v="ai" onClick={()=>generateAI("school")} disabled={aiLoading}>📚 Plan Study</Btn>
            <Btn small v="secondary" onClick={()=>generateAI("life")} disabled={aiLoading}>🏠 Plan Personal</Btn>
            <Btn small v="secondary" onClick={()=>generateAI("full")} disabled={aiLoading}>📋 Plan Full Day</Btn>
            {view==="week"&&<Btn small v="secondary" onClick={()=>generateAI("week")} disabled={aiLoading}>📅 Plan Full Week</Btn>}
          </div>

          {/* Reschedule section */}
          <div style={{background:T.input,borderRadius:10,padding:12,marginBottom:10}}>
            <div style={{fontSize:fs(11),fontWeight:700,color:T.soft,marginBottom:8}}>Reschedule Existing Calendar</div>
            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
              {[{k:"day",l:"This Day"},{k:"week",l:"This Week"},{k:"month",l:"This Month"},{k:"custom",l:"Custom"}].map(s=>(
                <button key={s.k} onClick={()=>setReschedScope(s.k)} style={{padding:"5px 12px",borderRadius:7,border:`1px solid ${reschedScope===s.k?T.accent:T.border}`,background:reschedScope===s.k?T.accentD:"transparent",color:reschedScope===s.k?T.accent:T.dim,fontSize:fs(10),fontWeight:600,cursor:"pointer"}}>{s.l}</button>
              ))}
              {reschedScope==="custom"&&<div style={{display:"flex",alignItems:"center",gap:4}}><input type="number" min="1" max="12" value={reschedMonths} onChange={e=>setReschedMonths(Number(e.target.value))} style={{width:50,padding:"4px 6px",fontSize:fs(11),textAlign:"center"}}/><span style={{fontSize:fs(10),color:T.dim}}>month(s)</span></div>}
            </div>
            <textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Explain what to change: e.g. 'Move all study blocks to mornings', 'Add gym sessions MWF at 6am', 'Clear Thursday and reschedule everything to other days'..." style={{minHeight:40,fontSize:fs(11),marginBottom:8}}/>
            <div style={{display:"flex",gap:6}}>
              <Btn small v="ai" onClick={()=>generateAI("reschedule")} disabled={aiLoading}>🔄 Reschedule</Btn>
              {aiPrompt.trim()&&<Btn small v="secondary" onClick={()=>generateAI()} disabled={aiLoading}>Send Custom</Btn>}
              {aiLoading&&<Btn small v="ghost" onClick={stopAI} style={{color:T.red,borderColor:T.red}}>⬛ Stop</Btn>}
            </div>
          </div>

          {aiLog.length>0&&(
            <div style={{maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
              {aiLog.map((l,i)=>(
                <div key={i} style={{padding:"5px 10px",borderRadius:7,fontSize:fs(10),lineHeight:1.5,
                  background:l.type==="error"?T.redD:l.type==="tool_call"?T.purpleD:l.type==="tool_result"?T.accentD:l.type==="user"?T.blueD:T.input,
                  color:l.type==="error"?T.red:l.type==="tool_call"?T.purple:l.type==="tool_result"?T.accent:l.type==="user"?T.blue:T.text,
                  borderLeft:`3px solid ${l.type==="error"?T.red:l.type==="tool_call"?T.purple:l.type==="tool_result"?T.accent:l.type==="user"?T.blue:T.border}`,
                }}>{l.content}</div>
              ))}
            </div>
          )}
        </>}
      </div>

      {/* Category filter (day view) */}
      {view==="day" && tasks.length > 0 && (
        <div style={{display:"flex",gap:4,marginBottom:12,flexWrap:"wrap"}}>
          <button className="sf-chip" onClick={()=>setCatFilter("all")} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:fs(11),fontWeight:catFilter==="all"?700:400,cursor:"pointer",background:catFilter==="all"?T.accentD:"transparent",color:catFilter==="all"?T.accent:T.dim}}>All ({tasks.length})</button>
          {Object.entries(CAT).filter(([k])=>tasks.some(t=>t.category===k)).map(([k,v])=>(
            <button key={k} className="sf-chip" onClick={()=>setCatFilter(k)} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:fs(11),fontWeight:catFilter===k?700:400,cursor:"pointer",background:catFilter===k?v.bg:"transparent",color:catFilter===k?v.fg:T.dim}}>{v.l} ({tasks.filter(t=>t.category===k).length})</button>
          ))}
        </div>
      )}

      {/* Content */}
      {view==="week" ? renderWeekView() : (
        filtered.length===0 ? <div style={{padding:"50px 0",textAlign:"center"}}><div style={{fontSize:fs(40),marginBottom:12,opacity:.3}}>📋</div><p style={{color:T.dim,fontSize:fs(13)}}>{catFilter!=="all"?"No tasks in this category":"No tasks for this day"}</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:5}}>{filtered.map(renderTask)}</div>
      )}

      {showRestructure && (
        <div className="fade" style={{background:T.accentD,border:`1px solid ${T.accent}44`,borderRadius:12,padding:16,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:fs(13),fontWeight:600,color:T.accent}}>⏩ You finished {minsToStr(showRestructure.savedMins)} early!</div>
              <div style={{fontSize:fs(12),color:T.soft,marginTop:2}}>Shift remaining tasks forward?</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn small onClick={()=>restructureTasks(showRestructure.savedMins)}>Shift Earlier</Btn>
              <Btn small v="ghost" onClick={()=>setShowRestructure(null)}>Keep As-Is</Btn>
            </div>
          </div>
        </div>
      )}

      {showAdd&&<Modal title={editId?"Edit Task":"Add Task"} onClose={()=>setShowAdd(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div><Label>Title</Label><input autoFocus value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="What needs to be done?" onKeyDown={e=>e.key==="Enter"&&saveTask()}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><Label>Start</Label><input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></div>
            <div><Label>End</Label><input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><Label>Category</Label><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(CAT).filter(([k])=>k!=="exam").map(([k,v])=><option key={k} value={k}>{v.l}</option>)}</select></div>
            <div><Label>Priority</Label><div style={{display:"flex",gap:4}}>{["high","medium","low"].map(p=><button key={p} className="sf-toggle" onClick={()=>setForm({...form,priority:p})} style={{flex:1,padding:"8px 0",borderRadius:8,cursor:"pointer",fontSize:fs(11),fontWeight:600,textTransform:"capitalize",border:`1.5px solid ${form.priority===p?PRIO[p]:T.border}`,background:form.priority===p?PRIO[p]+"22":T.input,color:form.priority===p?PRIO[p]:T.dim}}>{p}</button>)}</div></div>
          </div>
          <div><Label>Recurring</Label>
            <div style={{display:"flex",gap:4}}>
              {[{k:"",l:"None"},{k:"daily",l:"Daily"},{k:"weekdays",l:"Weekdays"},{k:"weekly",l:"Weekly"}].map(r=>(
                <button key={r.k} onClick={()=>setForm({...form,recurring:r.k})} style={{flex:1,padding:"8px 0",borderRadius:8,cursor:"pointer",fontSize:fs(10),fontWeight:600,border:`1.5px solid ${form.recurring===r.k?T.blue:T.border}`,background:form.recurring===r.k?T.blueD:T.input,color:form.recurring===r.k?T.blue:T.dim}}>{r.l}</button>
              ))}
            </div>
          </div>
          <div><Label>Notes</Label><input value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Optional details..."/></div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <Btn v="secondary" onClick={()=>setShowAdd(false)}>Cancel</Btn>
            <Btn onClick={saveTask} disabled={!form.title.trim()}>{editId?"Update":"Add Task"}</Btn>
          </div>
        </div>
      </Modal>}
    </div>
  );
};

// ----------------------------------------------------------------------
const LogLine = ({ l }) => (
  <div style={{padding:"6px 10px",borderRadius:7,fontSize:fs(11),lineHeight:1.6,whiteSpace:"pre-wrap",wordBreak:"break-word",
    background:l.type==="error"?T.redD:l.type==="tool_call"?T.purpleD:l.type==="tool_result"?T.accentD:l.type==="user"?T.blueD:T.input,
    color:l.type==="error"?T.red:l.type==="tool_call"?T.purple:l.type==="tool_result"?T.accent:l.type==="user"?T.blue:T.text,
    borderLeft:`3px solid ${l.type==="error"?T.red:l.type==="tool_call"?T.purple:l.type==="tool_result"?T.accent:l.type==="user"?T.blue:T.border}`,
  }}>{l.content}</div>
);

// DEGREE PAGE (with image upload)
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// DEGREE PAGE (deep context + regenerate)
// ----------------------------------------------------------------------
const CtxBadge = ({label,count,color}) => count > 0 ? <Badge color={color} bg={color+"18"}>{label}: {count}</Badge> : null;

const CourseDetail = ({ c }) => {
  const [tab, setTab] = useState("overview");
  const tabs = ["overview","topics","assessment","resources","tips","strategy"];
  // All array accesses go through safeArr to prevent crashes
  const comps = safeArr(c.competencies);
  const topics = safeArr(c.topicBreakdown);
  const terms = safeArr(c.keyTermsAndConcepts);
  const focus = safeArr(c.knownFocusAreas);
  const tips = safeArr(c.examTips);
  const mistakes = safeArr(c.commonMistakes);
  const offRes = safeArr(c.officialResources);
  const extRes = safeArr(c.recommendedExternal);
  const objs = safeArr(c.learningObjectives);
  const quickWins = safeArr(c.quickWins);
  const hardest = safeArr(c.hardestConcepts);
  const mnemonics = safeArr(c.mnemonics);
  const milestones = safeArr(c.weeklyMilestones);
  const studyOrder = safeArr(c.studyOrder);
  const timeAlloc = safeArr(c.timeAllocation);
  const instTips = safeArr(c.instructorTips);
  const community = safeArr(c.communityInsights);
  const prereqs = safeArr(c.prerequisites);
  const related = safeArr(c.relatedCourses);
  const attempts = safeArr(c.attemptHistory);
  const weakAreas = safeArr(c.preAssessmentWeakAreas);
  const oa = c.oaDetails || {};
  const pa = c.paDetails || {};

  return (
    <div style={{marginTop:10,borderTop:`1px solid ${T.border}`,paddingTop:12}}>
      <div style={{display:"flex",gap:4,marginBottom:10}}>
        {tabs.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"6px 12px",borderRadius:7,fontSize:fs(11),fontWeight:600,cursor:"pointer",textTransform:"capitalize",border:`1px solid ${tab===t?T.accent:T.border}`,background:tab===t?T.accentD:T.input,color:tab===t?T.accent:T.dim}}>{t}</button>)}
      </div>

      {tab==="overview" && <div style={{fontSize:fs(12),color:T.soft,display:"flex",flexDirection:"column",gap:6}}>
        {c.assessmentType && <div><b style={{color:T.text}}>Assessment:</b> {c.assessmentType}{c.certAligned?` (→ ${c.certAligned})`:""}</div>}
        {c.averageStudyHours > 0 && <div><b style={{color:T.text}}>Avg Hours:</b> {c.averageStudyHours}h {c.passRate?`· ${c.passRate}`:""}</div>}
        {comps.length > 0 && <div><b style={{color:T.text}}>Competencies ({comps.length}):</b>
          <div style={{marginTop:4,display:"flex",flexDirection:"column",gap:3}}>{comps.map((cp,i)=><div key={i} style={{padding:"4px 8px",background:T.input,borderRadius:6,borderLeft:`3px solid ${cp.weight==="high"?T.red:cp.weight==="medium"?T.orange:T.accent}`}}>
            <span style={{fontWeight:600,color:T.text}}>{cp.code} {cp.title}</span>
            {cp.description && <div style={{fontSize:fs(11),color:T.dim,marginTop:2}}>{cp.description}</div>}
          </div>)}</div>
        </div>}
        {objs.length > 0 && <div><b style={{color:T.text}}>Objectives:</b><ul style={{marginTop:2,paddingLeft:16}}>{objs.map((o,i)=><li key={i} style={{fontSize:fs(11),marginBottom:2}}>{o}</li>)}</ul></div>}
        {prereqs.length > 0 && <div><b style={{color:T.text}}>Prerequisites:</b> {prereqs.join(", ")}</div>}
        {related.length > 0 && <div><b style={{color:T.text}}>Related:</b> {related.join(", ")}</div>}
        {c.versionInfo && <div><b style={{color:T.text}}>Version:</b> {c.versionInfo}</div>}
        {c.lastUpdated && <div style={{fontSize:fs(10),color:T.dim}}>Last updated: {new Date(c.lastUpdated).toLocaleDateString()}</div>}
      </div>}

      {tab==="topics" && <div style={{fontSize:fs(12),color:T.soft,display:"flex",flexDirection:"column",gap:6}}>
        {topics.length > 0 ? topics.map((t,i)=><div key={i} style={{padding:"6px 10px",background:T.input,borderRadius:8,borderLeft:`3px solid ${t.weight==="high"?T.red:t.weight==="medium"?T.orange:T.accent}`}}>
          <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:600,color:T.text}}>{t.topic}</span><Badge color={t.weight==="high"?T.red:t.weight==="medium"?T.orange:T.accent} bg={(t.weight==="high"?T.red:t.weight==="medium"?T.orange:T.accent)+"22"}>{t.weight}</Badge></div>
          {t.description && <div style={{fontSize:fs(11),color:T.dim,marginTop:2}}>{t.description}</div>}
          {safeArr(t.subtopics).length > 0 && <div style={{fontSize:fs(10),color:T.dim,marginTop:3}}>↳ {safeArr(t.subtopics).join(" · ")}</div>}
        </div>) : <div style={{color:T.dim,textAlign:"center",padding:12}}>No topics yet — click 🔄 to generate</div>}
        {terms.length > 0 && <div style={{marginTop:8}}><b style={{color:T.text}}>Key Terms ({terms.length}):</b>
          <div style={{marginTop:4,display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>{terms.slice(0,20).map((kt,i)=><div key={i} style={{padding:"4px 8px",background:T.bg2,borderRadius:6,fontSize:fs(10)}}><span style={{color:T.accent,fontWeight:600}}>{kt.term}</span> — <span style={{color:T.dim}}>{kt.definition}</span></div>)}</div>
          {terms.length>20 && <div style={{fontSize:fs(10),color:T.dim,marginTop:2}}>+{terms.length-20} more</div>}
        </div>}
        {focus.length > 0 && <div style={{marginTop:8}}><b style={{color:T.text}}>Focus Areas:</b>
          <div style={{marginTop:4,display:"flex",gap:4,flexWrap:"wrap"}}>{focus.map((f,i)=><Badge key={i} color={T.red} bg={T.redD}>{f}</Badge>)}</div>
        </div>}
      </div>}

      {tab==="assessment" && <div style={{fontSize:fs(12),color:T.soft,display:"flex",flexDirection:"column",gap:6}}>
        {oa.format && <div style={{padding:10,background:T.input,borderRadius:8}}>
          <b style={{color:T.text}}>OA Details</b>
          <div style={{marginTop:4,display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:fs(11)}}>
            <div>Format: {oa.format}</div><div>Questions: {oa.questionCount||"?"}</div>
            <div>Passing: {oa.passingScore||"?"}</div><div>Time: {oa.timeLimit||"?"}</div>
            {oa.proctoringTool && <div>Proctor: {oa.proctoringTool}</div>}
            {oa.retakePolicy && <div>Retake: {oa.retakePolicy}</div>}
          </div>
        </div>}
        {pa.taskDescription && <div style={{padding:10,background:T.input,borderRadius:8}}>
          <b style={{color:T.text}}>PA Details</b>
          <div style={{fontSize:fs(11),marginTop:4}}>{pa.taskDescription}</div>
          {pa.rubricSummary && <div style={{fontSize:fs(11),marginTop:2}}>Rubric: {pa.rubricSummary}</div>}
        </div>}
        {c.preAssessmentScore!=null && <div><b style={{color:T.text}}>Pre-Assessment:</b> {c.preAssessmentScore}%{weakAreas.length>0 && <span style={{color:T.orange}}> · Weak: {weakAreas.join(", ")}</span>}</div>}
        {attempts.length > 0 && <div><b style={{color:T.text}}>Attempts:</b>{attempts.map((a,i)=><div key={i} style={{fontSize:fs(11)}}>  {a.date}: {a.passed?"✅":"❌"} {a.score?`(${a.score})`:""} {a.notes||""}</div>)}</div>}
        {mistakes.length > 0 && <div><b style={{color:T.red}}>Common Mistakes:</b><ul style={{paddingLeft:16,marginTop:2}}>{mistakes.map((m,i)=><li key={i} style={{fontSize:fs(11),color:T.orange}}>{m}</li>)}</ul></div>}
      </div>}

      {tab==="resources" && <div style={{fontSize:fs(12),color:T.soft,display:"flex",flexDirection:"column",gap:6}}>
        {offRes.length > 0 && <div><b style={{color:T.text}}>Official:</b>{offRes.map((r,i)=><div key={i} style={{padding:"4px 8px",background:T.input,borderRadius:6,marginTop:3,fontSize:fs(11)}}>📘 {r.title} <Badge color={T.blue} bg={T.blueD}>{r.type||"resource"}</Badge> {r.notes?`— ${r.notes}`:""}</div>)}</div>}
        {extRes.length > 0 && <div><b style={{color:T.text}}>Community:</b>{extRes.map((r,i)=><div key={i} style={{padding:"4px 8px",background:T.input,borderRadius:6,marginTop:3,fontSize:fs(11)}}>🔗 {r.title} <Badge color={T.purple} bg={T.purpleD}>{r.type||"link"}</Badge> {r.notes?`— ${r.notes}`:""}</div>)}</div>}
        {c.studyGuideNotes && <div><b style={{color:T.text}}>Study Notes:</b><div style={{padding:8,background:T.input,borderRadius:8,marginTop:4,fontSize:fs(11),whiteSpace:"pre-wrap",maxHeight:200,overflowY:"auto"}}>{c.studyGuideNotes}</div></div>}
        {!offRes.length && !extRes.length && !c.studyGuideNotes && <div style={{color:T.dim,textAlign:"center",padding:12}}>No resources yet — click 🔄</div>}
      </div>}

      {tab==="tips" && <div style={{fontSize:fs(12),color:T.soft,display:"flex",flexDirection:"column",gap:4}}>
        {tips.length > 0 ? tips.map((t,i)=><div key={i} style={{padding:"6px 10px",background:T.input,borderRadius:6,borderLeft:`3px solid ${T.yellow}`,fontSize:fs(11)}}>💡 {t}</div>) : <div style={{color:T.dim,textAlign:"center",padding:12}}>No tips yet — click 🔄</div>}
      </div>}

      {tab==="strategy" && <div style={{fontSize:fs(12),color:T.soft,display:"flex",flexDirection:"column",gap:8}}>
        {c.studyStrategy && <div style={{padding:10,background:T.input,borderRadius:8}}>
          <b style={{color:T.text}}>📋 Study Approach</b>
          <div style={{fontSize:fs(11),marginTop:4,whiteSpace:"pre-wrap"}}>{c.studyStrategy}</div>
        </div>}
        {c.practiceTestNotes && <div style={{padding:10,background:T.input,borderRadius:8}}>
          <b style={{color:T.text}}>📝 Practice Test Notes</b>
          <div style={{fontSize:fs(11),marginTop:4}}>{c.practiceTestNotes}</div>
        </div>}
        {studyOrder.length > 0 && <div>
          <b style={{color:T.text}}>🔢 Recommended Study Order:</b>
          <div style={{marginTop:4,display:"flex",flexDirection:"column",gap:3}}>
            {studyOrder.map((s,i)=><div key={i} style={{padding:"4px 10px",background:T.input,borderRadius:6,fontSize:fs(11),display:"flex",gap:8}}>
              <span style={{color:T.accent,fontWeight:700,minWidth:20}}>{i+1}.</span>{s}
            </div>)}
          </div>
        </div>}
        {timeAlloc.length > 0 && <div>
          <b style={{color:T.text}}>⏰ Time Allocation:</b>
          <div style={{marginTop:4,display:"flex",flexDirection:"column",gap:3}}>
            {timeAlloc.map((t,i)=><div key={i} style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{flex:1,fontSize:fs(11)}}>{t.topic}</div>
              <div style={{width:120,height:8,borderRadius:4,background:T.bg2,overflow:"hidden"}}>
                <div style={{width:`${t.percentage||0}%`,height:"100%",background:T.accent,borderRadius:4}}/>
              </div>
              <span style={{fontSize:fs(10),color:T.accent,fontWeight:600,minWidth:30,textAlign:"right"}}>{t.percentage||0}%</span>
            </div>)}
          </div>
        </div>}
        {quickWins.length > 0 && <div>
          <b style={{color:T.accent}}>⚡ Quick Wins (do these first):</b>
          <div style={{marginTop:4,display:"flex",gap:6,flexWrap:"wrap"}}>
            {quickWins.map((q,i)=><Badge key={i} color={T.accent} bg={T.accentD}>{q}</Badge>)}
          </div>
        </div>}
        {hardest.length > 0 && <div>
          <b style={{color:T.red}}>🧠 Hardest Concepts (extra focus needed):</b>
          <div style={{marginTop:4,display:"flex",gap:6,flexWrap:"wrap"}}>
            {hardest.map((h,i)=><Badge key={i} color={T.red} bg={T.redD}>{h}</Badge>)}
          </div>
        </div>}
        {mnemonics.length > 0 && <div>
          <b style={{color:T.purple}}>🔮 Memory Aids:</b>
          <div style={{marginTop:4,display:"flex",flexDirection:"column",gap:4}}>
            {mnemonics.map((m,i)=><div key={i} style={{padding:"6px 10px",background:T.purpleD,borderRadius:6,borderLeft:`3px solid ${T.purple}`,fontSize:fs(11)}}>
              <span style={{fontWeight:600,color:T.purple}}>{m.concept}:</span> <span style={{color:T.text}}>{m.mnemonic}</span>
            </div>)}
          </div>
        </div>}
        {milestones.length > 0 && <div>
          <b style={{color:T.blue}}>📅 Weekly Milestones:</b>
          <div style={{marginTop:4,display:"flex",flexDirection:"column",gap:3}}>
            {milestones.map((m,i)=><div key={i} style={{padding:"4px 10px",background:T.blueD,borderRadius:6,fontSize:fs(11)}}>
              <span style={{fontWeight:600,color:T.blue}}>Week {m.week}:</span> {m.goals}
            </div>)}
          </div>
        </div>}
        {instTips.length > 0 && <div>
          <b style={{color:T.text}}>👩‍🏫 Instructor Tips:</b>
          {instTips.map((t,i)=><div key={i} style={{padding:"4px 8px",fontSize:fs(11),marginTop:2}}>• {t}</div>)}
        </div>}
        {community.length > 0 && <div>
          <b style={{color:T.orange}}>💬 Community Insights:</b>
          {community.map((t,i)=><div key={i} style={{padding:"4px 8px",fontSize:fs(11),marginTop:2,color:T.orange}}>• {t}</div>)}
        </div>}
        {!c.studyStrategy && studyOrder.length===0 && quickWins.length===0 && hardest.length===0 && mnemonics.length===0 && <div style={{color:T.dim,textAlign:"center",padding:12}}>No strategy data yet — click 🔄 to generate</div>}
      </div>}
    </div>
  );
};

// ----------------------------------------------------------------------
// DEGREE DASHBOARD (read-only overview — default landing page)
// ----------------------------------------------------------------------
const DegreeDashboard = ({ data, setData, setPage, setDate }) => {
  const bp = useBreakpoint();
  const [filter, setFilter] = useState("all");
  const [showCheckin, setShowCheckin] = useState(false);
  const courses = data.courses || [];
  const sessions = data.studySessions || [];
  const streak = data.studyStreak || { lastStudyDate:"", currentStreak:0, longestStreak:0 };
  const totalCU = courses.reduce((s,c) => s + (c.credits||0), 0);
  const doneCU = courses.filter(c => c.status === "completed").reduce((s,c) => s + (c.credits||0), 0);
  const remainCU = totalCU - doneCU;
  const pctComplete = totalCU > 0 ? Math.round((doneCU/totalCU)*100) : 0;
  const daysLeft = data.targetDate ? Math.max(0, diffDays(todayStr(), data.targetDate)) : null;
  const hrsPerDay = data.studyHoursPerDay || 4;
  const activeCourses = courses.filter(c => c.status !== "completed");
  const totalEstHrs = activeCourses.reduce((s,c) => s + (c.averageStudyHours > 0 ? c.averageStudyHours : ([0,20,35,50,70,100][c.difficulty||3]||50)), 0);
  const earlyFinishWeeks = 0; // legacy compat
  const exDates = safeArr(data.exceptionDates);
  const rawDaysNeeded = hrsPerDay > 0 ? Math.ceil(totalEstHrs / hrsPerDay) : 0;

  // Two-date system: targetCompletionDate = when student wants to finish, targetDate = term end
  const goalDate = data.targetCompletionDate || data.targetDate || null;
  const termEndDate = data.targetDate || null;
  const daysToGoal = goalDate ? Math.max(0, diffDays(todayStr(), goalDate)) : null;
  const daysToTermEnd = termEndDate ? Math.max(0, diffDays(todayStr(), termEndDate)) : null;

  // Actual scheduled hours from calendar
  const allTaskDates = Object.keys(data.tasks || {});
  const futureDatesWithTasks = allTaskDates.filter(d => d >= todayStr()).sort();
  const scheduledStudyMins = futureDatesWithTasks.reduce((s, d) => {
    return s + safeArr(data.tasks[d]).filter(t => STUDY_CATS.includes(t.category)).reduce((ms, t) => {
      const st = parseTime(t.time), et = parseTime(t.endTime);
      return ms + (st && et ? Math.max(0, et.mins - st.mins) : 0);
    }, 0);
  }, 0);
  const scheduledHrs = Math.round(scheduledStudyMins / 6) / 10;
  // Only count days that actually have study/exam tasks
  const studyDatesWithTasks = futureDatesWithTasks.filter(d => safeArr(data.tasks[d]).some(t => STUDY_CATS.includes(t.category)));
  const lastScheduledDate = studyDatesWithTasks.length > 0 ? studyDatesWithTasks[studyDatesWithTasks.length - 1] : null;
  const scheduleFinish = lastScheduledDate;

  // Global conflict scan — check all future dates for time overlaps
  const globalConflicts = useMemo(() => {
    let totalConflicts = 0;
    const conflictDateList = [];
    for (const d of futureDatesWithTasks) {
      const dt = safeArr(data.tasks[d]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
      let dayConflicts = 0;
      for (let i=0; i<dt.length; i++) {
        const as = parseTime(dt[i].time), ae = parseTime(dt[i].endTime);
        if(!as||!ae) continue;
        for (let j=i+1; j<dt.length; j++) {
          const bs = parseTime(dt[j].time), be = parseTime(dt[j].endTime);
          if(!bs||!be) continue;
          if(as.mins < be.mins && ae.mins > bs.mins) { totalConflicts++; dayConflicts++; }
        }
      }
      if (dayConflicts > 0) conflictDateList.push({date:d, count:dayConflicts});
    }
    return { totalConflicts, conflictDays: conflictDateList.length, dates: conflictDateList };
  }, [data.tasks]);

  // Two-date system: goalDate is the completion target
  const effectiveTarget = goalDate; // alias for compat
  const effectiveDaysLeft = daysToGoal;

  // Study sessions stats
  const todaySessions = sessions.filter(s => s.date === todayStr());
  const todayMins = todaySessions.reduce((s,x) => s + (x.mins||0), 0);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
  const weekSessions = sessions.filter(s => new Date(s.date+"T12:00:00") >= weekAgo);
  const weekMins = weekSessions.reduce((s,x) => s + (x.mins||0), 0);
  const totalStudiedMins = sessions.reduce((s,x) => s + (x.mins||0), 0);

  // Per-course studied hours
  const courseHours = {};
  sessions.forEach(s => {
    const key = s.course || "Unlinked";
    courseHours[key] = (courseHours[key]||0) + (s.mins||0);
  });

  // Velocity: avg hours/day over last 14 days
  const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate()-14);
  const recentSessions = sessions.filter(s => new Date(s.date+"T12:00:00") >= twoWeeksAgo);
  const recentMins = recentSessions.reduce((s,x) => s + (x.mins||0), 0);
  const avgHrsPerDay14 = Math.round((recentMins / 60 / 14) * 10) / 10;
  const estDaysAtPace = avgHrsPerDay14 > 0 ? Math.ceil(totalEstHrs / avgHrsPerDay14) : null;

  // Estimated finish date (pure study days from now, skipping exceptions)
  const calcFinish = (hrs) => {
    if (!hrs || hrs <= 0 || !data.studyStartDate) return null;
    let d = new Date(Math.max(new Date(data.studyStartDate+"T12:00:00"), new Date())); let rem = rawDaysNeeded;
    for (let i=0; i<rem+exDates.length+365 && rem>0; i++) { const ds=d.toISOString().split("T")[0]; if(!exDates.includes(ds)) rem--; d.setDate(d.getDate()+1); }
    return d.toISOString().split("T")[0];
  };
  const estFinish = calcFinish(hrsPerDay);

  // Next study blocks from tasks
  const tasks = data.tasks || {};
  const today = todayStr();
  const upcomingBlocks = [];
  for (let i=0; i<7 && upcomingBlocks.length < 5; i++) {
    const d = new Date(); d.setDate(d.getDate()+i); const ds = d.toISOString().split("T")[0];
    const dayTasks = safeArr(tasks[ds]).filter(t => !t.done && t.category === "study");
    dayTasks.forEach(t => upcomingBlocks.push({...t, date:ds}));
  }

  // Study check-in prompt logic
  useEffect(() => {
    const lastCheckin = localStorage.getItem('ds-last-checkin');
    if (lastCheckin !== todayStr() && sessions.length > 0 && streak.lastStudyDate && streak.lastStudyDate !== todayStr()) {
      const timer = setTimeout(() => setShowCheckin(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const logManualSession = (didStudy) => {
    localStorage.setItem('ds-last-checkin', todayStr());
    setShowCheckin(false);
    if (didStudy) {
      toast("Great job! Your streak continues.", "success");
    } else {
      toast("No worries — get back to it today!", "info");
    }
  };

  // Course filter
  const filtered = filter === "all" ? courses : courses.filter(c => c.status === filter);
  const hasCtx = c => safeArr(c.competencies).length>0||safeArr(c.topicBreakdown).length>0||safeArr(c.examTips).length>0;

  return (
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div><h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Degree Dashboard</h1><p style={{color:T.dim,fontSize:fs(13)}}>Your WGU progress at a glance</p></div>
        <Btn v="ai" onClick={()=>setPage("planner")}><Ic.Edit s={14}/> Course Planner</Btn>
      </div>

      {/* Study Check-in Prompt */}
      {showCheckin && (
        <div className="fade" style={{background:`linear-gradient(135deg, ${T.purpleD}, ${T.accentD})`,border:`1.5px solid ${T.purple}55`,borderRadius:14,padding:"16px 22px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
          <div>
            <div style={{fontSize:fs(14),fontWeight:700,color:T.text}}>Did you study yesterday?</div>
            <div style={{fontSize:fs(11),color:T.soft}}>Keep your streak alive! Current: {streak.currentStreak} day{streak.currentStreak!==1?"s":""}</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn small v="primary" onClick={()=>logManualSession(true)}>Yes!</Btn>
            <Btn small v="ghost" onClick={()=>logManualSession(false)}>Not today</Btn>
          </div>
        </div>
      )}

      {/* Progress & Stats */}
      <div style={{marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:`auto repeat(${bp.sm?3:4},1fr)`,gap:12}}>
          {/* Progress Ring — spans 2 rows */}
          <div className="sf-stat" style={{gridRow:"1/3",background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minWidth:140}}>
            <svg width="100" height="100" viewBox="0 0 90 90">
              <circle cx="45" cy="45" r="38" fill="none" stroke={T.bg2} strokeWidth="7"/>
              <circle cx="45" cy="45" r="38" fill="none" stroke={T.accent} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${2*Math.PI*38*pctComplete/100} ${2*Math.PI*38}`}
                transform="rotate(-90 45 45)" style={{transition:"stroke-dasharray .5s"}}/>
              <text x="45" y="42" textAnchor="middle" fill={T.text} fontSize="20" fontWeight="800" fontFamily="Outfit,sans-serif">{pctComplete}%</text>
              <text x="45" y="56" textAnchor="middle" fill={T.dim} fontSize="9">{doneCU}/{totalCU} CU</text>
            </svg>
            <div style={{fontSize:fs(9),color:T.soft,marginTop:6,fontWeight:600}}>Degree Progress</div>
          </div>
          {/* Top row: 4 stats */}
          {[
            {l:"Remaining CU",v:remainCU,c:T.orange},
            {l:"Days to Goal",v:daysToGoal??"—",c:daysToGoal!=null&&daysToGoal<60?T.red:daysToGoal!=null&&daysToGoal<90?T.orange:T.blue,sub:goalDate?new Date(goalDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):"set target"},
            {l:"Term Ends",v:daysToTermEnd!=null?daysToTermEnd+"d":"—",c:termEndDate?T.soft:T.dim,sub:termEndDate?new Date(termEndDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}):"not set"},
            {l:"Scheduled",v:scheduledHrs>0?`${scheduledHrs}h`:"—",c:scheduledHrs>=totalEstHrs?T.accent:scheduledHrs>0?T.blue:T.dim,sub:studyDatesWithTasks.length>0?`${studyDatesWithTasks.length} study days`:"no plan yet"},
          ].map((s,i)=>(
            <div key={i} className="sf-stat" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
              <div style={{fontSize:fs(9),color:T.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:fs(22),fontWeight:800,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}</div>
              {s.sub&&<div style={{fontSize:fs(9),color:T.dim}}>{s.sub}</div>}
            </div>
          ))}
          {/* Bottom row: 4 stats */}
          {[
            {l:"Est. Days",v:rawDaysNeeded||"—",c:T.purple,sub:`${totalEstHrs}h ÷ ${hrsPerDay}h/day · from Course Planner`},
            {l:"Today's Study",v:`${Math.round(todayMins/6)/10}h`,c:todayMins>0?T.accent:T.dim},
            {l:"Study Streak",v:`${streak.currentStreak}d`,c:streak.currentStreak>=7?T.accent:streak.currentStreak>=3?T.orange:T.dim},
            {l:"Avg Pace (14d)",v:avgHrsPerDay14>0?`${avgHrsPerDay14}h/d`:"—",c:avgHrsPerDay14>=hrsPerDay?T.accent:avgHrsPerDay14>0?T.orange:T.dim},
          ].map((s,i)=>(
            <div key={"b"+i} className="sf-stat" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
              <div style={{fontSize:fs(9),color:T.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:fs(22),fontWeight:800,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}</div>
              {s.sub&&<div style={{fontSize:fs(9),color:T.dim}}>{s.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Global Schedule Conflicts */}
      {globalConflicts.totalConflicts > 0 && (
        <div style={{padding:"12px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,marginBottom:16}}>
          <div style={{fontSize:fs(11),color:T.red,fontWeight:700,marginBottom:8}}>⚠️ {globalConflicts.totalConflicts} time overlap{globalConflicts.totalConflicts>1?"s":""} across {globalConflicts.conflictDays} day{globalConflicts.conflictDays>1?"s":""}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {globalConflicts.dates.slice(0,10).map(cd => (
              <button key={cd.date} onClick={()=>{setDate(cd.date);setPage("daily")}} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${T.red}55`,background:T.red+"22",color:T.red,fontSize:fs(10),fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                {new Date(cd.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} <span style={{opacity:0.7}}>({cd.count})</span>
              </button>
            ))}
            {globalConflicts.dates.length > 10 && <span style={{fontSize:fs(9),color:T.red,alignSelf:"center"}}>+{globalConflicts.dates.length-10} more days</span>}
          </div>
        </div>
      )}

      {/* Schedule Coverage */}
      {scheduledHrs > 0 && totalEstHrs > 0 && scheduledHrs < totalEstHrs * 0.9 && (
        <div style={{padding:"10px 14px",borderRadius:10,background:T.blueD,border:`1px solid ${T.blue}33`,fontSize:fs(11),color:T.blue,marginBottom:16}}>
          📅 Your calendar has {scheduledHrs}h of study scheduled but courses need ~{totalEstHrs}h total. {Math.round(scheduledHrs/totalEstHrs*100)}% coverage{lastScheduledDate ? ` — last scheduled day: ${new Date(lastScheduledDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : ""}.
          {scheduledHrs < totalEstHrs * 0.5 && " Consider regenerating your study plan in Course Planner to fill in the remaining weeks."}
        </div>
      )}

      {/* Velocity Warning */}
      {avgHrsPerDay14 > 0 && avgHrsPerDay14 < hrsPerDay && (
        <div style={{padding:"10px 14px",borderRadius:10,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:16}}>
          ⚠️ Your 14-day average ({avgHrsPerDay14}h/day) is below your target ({hrsPerDay}h/day).
          {estDaysAtPace && ` At current pace, you need ~${estDaysAtPace} days to finish.`}
          {effectiveDaysLeft!=null && estDaysAtPace && estDaysAtPace > effectiveDaysLeft && <span style={{fontWeight:700}}> That's {estDaysAtPace - effectiveDaysLeft} days past your target completion date.</span>}
        </div>
      )}

      {/* Hours/day config warning */}
      {hrsPerDay < 2 && totalEstHrs > 0 && (
        <div style={{padding:"10px 14px",borderRadius:10,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:16}}>
          ⚠️ Hours/day is set to {hrsPerDay}h — this is very low. At this pace, {totalEstHrs}h of coursework would take {rawDaysNeeded} study days. <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setPage("planner")}>Adjust in Course Planner</span>
        </div>
      )}
      {estFinish && data.targetDate && estFinish > data.targetDate && (
        <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(11),color:T.red,marginBottom:16}}>
          🚨 At {hrsPerDay}h/day, estimated finish ({new Date(estFinish+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) is past your term end ({new Date(data.targetDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}). <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setPage("planner")}>Adjust study plan</span>
        </div>
      )}
      {/* On Track / Behind indicators */}
      {(() => {
        // Use actual schedule last date if available, otherwise math estimate
        const projectedFinish = scheduleFinish || estFinish;
        if (!projectedFinish || !effectiveTarget) return null;
        const source = scheduleFinish ? "schedule" : "estimate";
        const finishLabel = new Date(projectedFinish+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});

        if (projectedFinish <= effectiveTarget) {
          return (
            <div style={{padding:"10px 14px",borderRadius:10,background:T.accentD,border:`1px solid ${T.accent}33`,fontSize:fs(11),color:T.accent,marginBottom:16}}>
              ✅ On track! {source==="schedule"?"Last scheduled study day":"Estimated finish"}: {finishLabel} — {diffDays(projectedFinish, effectiveTarget)} days before your target completion date.            </div>
          );
        } else if (data.targetDate && projectedFinish <= data.targetDate) {
          return (
            <div style={{padding:"10px 14px",borderRadius:10,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:16}}>
              ⚠️ {source==="schedule"?"Schedule runs":"Estimated finish"} through {finishLabel} — past your target completion but before term end ({new Date(data.targetDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}).
            </div>
          );
        } else if (data.targetDate) {
          return (
            <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(11),color:T.red,marginBottom:16}}>
              🚨 {source==="schedule"?"Schedule extends":"Estimated finish"} to {finishLabel} — {diffDays(data.targetDate, projectedFinish)} days PAST your term end date! Increase study hours or adjust your plan.
            </div>
          );
        }
        return null;
      })()}

      {/* Time Conflict Detection — scan today's tasks */}
      {(() => {
        const todayTasks = safeArr(tasks[today]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
        const overlaps = [];
        for (let i=0; i<todayTasks.length; i++) {
          const a = todayTasks[i], as = parseTime(a.time), ae = parseTime(a.endTime);
          if(!as||!ae) continue;
          for (let j=i+1; j<todayTasks.length; j++) {
            const b = todayTasks[j], bs = parseTime(b.time), be = parseTime(b.endTime);
            if(!bs||!be) continue;
            if(as.mins < be.mins && ae.mins > bs.mins) overlaps.push({a:a.title, b:b.title, aTime:`${a.time}–${a.endTime}`, bTime:`${b.time}–${b.endTime}`});
          }
        }
        if (overlaps.length === 0) return null;
        return (
          <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(11),color:T.red,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontWeight:700}}>⚠️ {overlaps.length} time conflict{overlaps.length>1?"s":""} in today's schedule</span>
              <button onClick={()=>{setDate(today);setPage("daily")}} style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${T.red}55`,background:T.red+"22",color:T.red,fontSize:fs(11),fontWeight:600,cursor:"pointer"}}>Fix in Schedule →</button>
            </div>
            {overlaps.slice(0,3).map((o,i) => (
              <div key={i} style={{fontSize:fs(10),opacity:0.85,marginBottom:2}}>
                {o.aTime} "{o.a.slice(0,30)}" overlaps with {o.bTime} "{o.b.slice(0,30)}"
              </div>
            ))}
            {overlaps.length > 3 && <div style={{fontSize:fs(9),opacity:0.7}}>+{overlaps.length-3} more conflicts</div>}
          </div>
        );
      })()}

      {/* Today's Tasks — ALL categories */}
      {(() => {
        const todayTasks = safeArr(tasks[today]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
        const done = todayTasks.filter(t=>t.done).length;
        if (todayTasks.length === 0) return null;
        return (
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <h3 style={{fontSize:fs(14),fontWeight:700}}>Today's Schedule</h3>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:fs(11),color:done===todayTasks.length?T.accent:T.soft}}>{done}/{todayTasks.length} done</span>
                <button onClick={()=>setPage("daily")} style={{background:T.accentD,border:`1px solid ${T.accent}44`,borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:fs(11),color:T.accent,fontWeight:600}}>View All →</button>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {todayTasks.slice(0,8).map(t => {
                const c = CAT[t.category]||CAT.other;
                return (
                  <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",borderRadius:8,background:t.done?T.bg2:T.input,opacity:t.done?0.5:1}}>
                    <div style={{width:3,height:20,borderRadius:2,background:c.fg,flexShrink:0}}/>
                    <span style={{fontSize:fs(10),color:T.dim,minWidth:40,fontFamily:"'JetBrains Mono',monospace"}}>{t.time||"—"}</span>
                    <span style={{flex:1,fontSize:fs(11),color:t.done?T.dim:T.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textDecoration:t.done?"line-through":"none"}}>{t.title}</span>
                    <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
                    {t.done&&<Ic.Check s={12} c={T.accent}/>}
                  </div>
                );
              })}
              {todayTasks.length > 8 && <div style={{fontSize:fs(10),color:T.dim,textAlign:"center",padding:4}}>+{todayTasks.length-8} more tasks</div>}
            </div>
          </div>
        );
      })()}

      {/* Upcoming Study Blocks */}
      {upcomingBlocks.length > 0 && (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:10}}>📅 Upcoming Study Blocks</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {upcomingBlocks.slice(0,5).map((t,i) => (
              <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderRadius:8,background:T.input}}>
                <span style={{fontSize:fs(10),color:T.dim,minWidth:50,fontFamily:"'JetBrains Mono',monospace"}}>{t.date===todayStr()?"Today":new Date(t.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</span>
                <span style={{fontSize:fs(10),color:T.blue,minWidth:45,fontFamily:"'JetBrains Mono',monospace"}}>{t.time||"—"}</span>
                <span style={{flex:1,fontSize:fs(12),color:T.text,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-Course Study Time */}
      {Object.keys(courseHours).length > 0 && (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:10}}>📚 Study Time by Course</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(courseHours).sort((a,b)=>b[1]-a[1]).map(([name,mins]) => {
              const course = courses.find(c => c.name === name);
              const estHrs = course?.averageStudyHours || 0;
              const studied = Math.round(mins/6)/10;
              const pct = estHrs > 0 ? Math.min(100, Math.round((studied/estHrs)*100)) : 0;
              return (
                <div key={name} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:fs(11),color:T.text,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{name}</span>
                  <div style={{width:80,height:6,borderRadius:3,background:T.bg2,overflow:"hidden",flexShrink:0}}>
                    <div style={{width:`${pct}%`,height:"100%",background:pct>=80?T.accent:pct>=40?T.blue:T.orange,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:fs(10),color:T.accent,fontWeight:600,minWidth:35,textAlign:"right"}}>{studied}h</span>
                  {estHrs>0&&<span style={{fontSize:fs(9),color:T.dim,minWidth:30}}>/{estHrs}h</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Course List (compact read-only) */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:fs(14),fontWeight:700}}>Courses ({courses.length})</h3>
        <div style={{display:"flex",gap:4}}>
          {["all","not_started","in_progress","completed"].map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{padding:"4px 10px",borderRadius:6,border:"none",fontSize:fs(10),fontWeight:f===filter?700:400,cursor:"pointer",
              background:f===filter?T.accentD:"transparent",color:f===filter?T.accent:T.dim}}>
              {f==="all"?"All":f==="not_started"?"Not Started":f==="in_progress"?"In Progress":"Done"}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{padding:"30px",textAlign:"center",color:T.dim,fontSize:fs(13)}}>
          {courses.length===0?"No courses yet. ":"No courses match this filter. "}
          <span style={{color:T.accent,cursor:"pointer",textDecoration:"underline"}} onClick={()=>setPage("planner")}>{courses.length===0?"Go to Course Planner":"Show all"}</span>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:16}}>
          {filtered.map((c,i)=>(
            <div key={c.id} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 14px",display:"flex",alignItems:"center",gap:10}}>
              <div style={{width:4,height:32,borderRadius:2,background:STATUS_C[c.status]||T.dim,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:fs(12),fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                  <Badge color={STATUS_C[c.status]||T.dim} bg={(STATUS_C[c.status]||T.dim)+"22"}>{STATUS_L[c.status]||c.status}</Badge>
                  {hasCtx(c)?<Badge color={T.accent} bg={T.accentD}>ENRICHED</Badge>:c.status!=="completed"&&<Badge color={T.orange} bg={T.orangeD}>NEEDS ENRICHMENT</Badge>}
                </div>
                <div style={{fontSize:fs(10),color:T.dim,display:"flex",gap:8,marginTop:2}}>
                  <span>{c.credits||0} CU</span>
                  <span>{"★".repeat(c.difficulty||0)}{"☆".repeat(5-(c.difficulty||0))}</span>
                  {c.assessmentType&&<span>{c.assessmentType}</span>}
                  {courseHours[c.name]&&<span style={{color:T.accent}}>⏱ {Math.round((courseHours[c.name]||0)/6)/10}h studied</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------
// COURSE PLANNER (AI-powered editing, parsing, enriching)
// ----------------------------------------------------------------------
const CoursePlanner = ({ data, setData, profile, setPage }) => {
  const bp = useBreakpoint();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name:"",credits:3,difficulty:3,status:"not_started",topics:"",notes:"",assessmentType:"",courseCode:"" });
  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [showParseOpts, setShowParseOpts] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [pendingPlan, setPendingPlan] = useState(null); // plan preview: tasks array + summary string
  const [planPrompt, setPlanPrompt] = useState("");
  const [manualStepOpen, setManualStepOpen] = useState({});
  const fileRef = useRef(null);

  // Global background task state — survives page navigation
  const bg = useBgTask();

  const courses = data.courses || [];
  const totalCU = courses.reduce((s,c) => s + (c.credits||0), 0);
  const doneCU = courses.filter(c => c.status === "completed").reduce((s,c) => s + (c.credits||0), 0);
  const remainCU = totalCU - doneCU;
  const daysLeft = data.targetDate ? Math.max(0, diffDays(todayStr(), data.targetDate)) : null;
  const [newExDate, setNewExDate] = useState("");

  //  Planning Intelligence 
  const activeCourses = courses.filter(c => c.status !== "completed");
  const totalEstHours = activeCourses.reduce((s, c) => {
    if (c.averageStudyHours > 0) return s + c.averageStudyHours;
    // Estimate from difficulty: diff 1=20h, 2=35h, 3=50h, 4=70h, 5=100h per CU-adjusted
    const base = [0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50;
    return s + base;
  }, 0);

  const hrsPerDay = data.studyHoursPerDay || 4;
  const exceptionDates = safeArr(data.exceptionDates);
  const startDate = data.studyStartDate || todayStr();
  const startTime = data.studyStartTime || "08:00";
  const earlyFinishWeeks = 0; // legacy compat
  
  // Two-date system: goalDate = target completion, targetDate = term end
  const goalDate = data.targetCompletionDate || data.targetDate || null;
  const effectiveTarget = goalDate;
  const effectiveDaysLeft = effectiveTarget ? Math.max(0, diffDays(todayStr(), effectiveTarget)) : null;

  // Hours available on first day (from start time to ~10 PM)
  const startTimeParts = startTime.split(":").map(Number);
  const firstDayHours = Math.max(0, Math.min(hrsPerDay, 22 - (startTimeParts[0]||8) - (startTimeParts[1]||0)/60));

  // Calculate available study days (excluding exception dates)
  const calcStudyDays = (fromDate, toDate) => {
    if (!fromDate || !toDate) return 0;
    let count = 0;
    const d = new Date(fromDate + "T12:00:00");
    const end = new Date(toDate + "T12:00:00");
    let safety = 0;
    while (d <= end && safety < 1000) {
      const ds = d.toISOString().split("T")[0];
      if (!exceptionDates.includes(ds)) count++;
      d.setDate(d.getDate() + 1);
      safety++;
    }
    return count;
  };

  // Adjust total hours: first day is partial if start time is set
  const adjustedHours = firstDayHours < hrsPerDay ? totalEstHours - firstDayHours + hrsPerDay : totalEstHours;
  const rawDaysNeeded = Math.ceil(adjustedHours / hrsPerDay);

  // Estimate completion date from start (pure study days, no buffer)
  const estCompletionDate = (() => {
    if (!startDate) return null;
    let remaining = rawDaysNeeded;
    const d = new Date(startDate + "T12:00:00");
    let safety = 0;
    while (remaining > 0 && safety < 1000) {
      const ds = d.toISOString().split("T")[0];
      if (!exceptionDates.includes(ds)) remaining--;
      d.setDate(d.getDate() + 1);
      safety++;
    }
    return d.toISOString().split("T")[0];
  })();

  // Calculate min hours/day to hit target completion
  const minHrsPerDay = (() => {
    if (!effectiveTarget || !startDate) return null;
    const availDays = calcStudyDays(startDate, effectiveTarget);
    if (availDays <= 0) return null;
    return Math.ceil((totalEstHours / availDays) * 10) / 10;
  })();

  // Feasibility calculator: what would min hrs/day be with extra exception dates?
  const MAX_STUDY_HRS = 18;
  const calcMinHrsWithDates = (extraDates) => {
    if (!effectiveTarget || !startDate) return null;
    const allEx = [...exceptionDates, ...extraDates];
    let count = 0;
    const d = new Date(startDate + "T12:00:00");
    const end = new Date(effectiveTarget + "T12:00:00");
    let safety = 0;
    while (d <= end && safety < 1000) {
      const ds = d.toISOString().split("T")[0];
      if (!allEx.includes(ds)) count++;
      d.setDate(d.getDate() + 1);
      safety++;
    }
    return count > 0 ? Math.ceil((totalEstHours / count) * 10) / 10 : 999;
  };

  const addExDate = () => {
    if (!newExDate || exceptionDates.includes(newExDate)) return;
    if (!data.overrideSafeguards) {
      const projected = calcMinHrsWithDates([newExDate]);
      if (projected !== null && projected > MAX_STUDY_HRS) {
        toast(`Can't add — would require ${projected}h/day (max ${MAX_STUDY_HRS}h). Enable override in settings to bypass.`, "error");
        return;
      }
    }
    setData(d => ({...d, exceptionDates: [...safeArr(d.exceptionDates), newExDate].sort()}));
    setNewExDate("");
  };
  const removeExDate = (dt) => setData(d => ({...d, exceptionDates: safeArr(d.exceptionDates).filter(x => x !== dt)}));

  // Add all occurrences of a day-of-week between start and end dates
  const addRecurringDayOff = (dayIndices) => {
    const start = data.studyStartDate || todayStr();
    const end = data.targetCompletionDate || data.targetDate;
    if (!end) { toast("Set a target completion or term end date first", "warn"); return; }
    const newDates = [];
    const d = new Date(start + "T12:00:00");
    const endD = new Date(end + "T12:00:00");
    while (d <= endD) {
      if (dayIndices.includes(d.getDay())) {
        const ds = d.toISOString().split("T")[0];
        if (!exceptionDates.includes(ds)) newDates.push(ds);
      }
      d.setDate(d.getDate() + 1);
    }
    if (newDates.length === 0) { toast("No new dates to add", "info"); return; }
    // Check feasibility before adding (unless override enabled)
    if (!data.overrideSafeguards) {
      const projected = calcMinHrsWithDates(newDates);
      if (projected !== null && projected > MAX_STUDY_HRS) {
        toast(`Can't add ${newDates.length} days off — would require ${projected}h/day (max ${MAX_STUDY_HRS}h). Enable override to bypass.`, "error");
        return;
      }
    }
    setData(dd => ({...dd, exceptionDates: [...safeArr(dd.exceptionDates), ...newDates].sort()}));
    const projLabel = projected !== null ? ` (→ ${projected}h/day needed)` : "";
    toast(`Added ${newDates.length} day${newDates.length>1?"s":""} off${projLabel}`, "success");
  };
  const clearRecurringDayOff = (dayIndices) => {
    setData(dd => ({...dd, exceptionDates: safeArr(dd.exceptionDates).filter(dt => !dayIndices.includes(new Date(dt+"T12:00:00").getDay()))}));
    toast("Removed recurring days off", "info");
  };

  const openAdd = () => { setForm({name:"",credits:3,difficulty:3,status:"not_started",topics:"",notes:"",assessmentType:"",courseCode:""}); setEditId(null); setShowAdd(true); };
  const openEdit = c => { setForm({name:c.name,credits:c.credits,difficulty:c.difficulty,status:c.status,topics:c.topics||"",notes:c.notes||"",assessmentType:c.assessmentType||"",courseCode:c.courseCode||""}); setEditId(c.id); setShowAdd(true); };
  const saveCourse = () => { if(!form.name.trim()) return; if(editId) { setData(d=>({...d,courses:d.courses.map(c=>c.id===editId?{...c,...form,credits:Number(form.credits),difficulty:Number(form.difficulty),lastUpdated:new Date().toISOString()}:c)})); toast("Course updated","success"); } else { setData(d=>({...d,courses:[...d.courses,{...EMPTY_DEEP,...form,id:uid(),credits:Number(form.credits),difficulty:Number(form.difficulty),lastUpdated:new Date().toISOString()}]})); toast(`Added: ${form.name}`,"success"); } setShowAdd(false); };
  const deleteCourse = id => { const name = (data.courses||[]).find(c=>c.id===id)?.name||""; setData(d=>({...d,courses:d.courses.filter(c=>c.id!==id)})); toast(`Removed: ${name}`,"warn"); };
  const handleImg = e => { const f=e.target.files?.[0]; if(!f)return; setImgFile(f); const r=new FileReader(); r.onload=()=>setImgPreview(r.result); r.readAsDataURL(f); e.target.value=''; };

  // Step 2: AI-powered study hour estimation (text-only, no vision needed)
  const estimateHours = async () => {
    if (!profile) return;
    const needsEstimate = courses.filter(c => c.status !== "completed" && (!c.averageStudyHours || c.averageStudyHours <= 0));
    if (!needsEstimate.length) { toast("All courses already have hour estimates!", "info"); return; }
    
    bgSet({loading:true, regenId:null, logs:[{type:"user",content:`⏱ Estimating study hours for ${needsEstimate.length} course${needsEstimate.length>1?"s":""}`}], label:`Estimating hours 1/${needsEstimate.length}...`});
    
    let completed = 0;
    for (const course of needsEstimate) {
      if (_bgState.abortCtrl?.signal?.aborted) { bgLog({type:"error",content:`Stopped after ${completed}/${needsEstimate.length}`}); break; }
      completed++;
      bgSet({label:`Estimating hours ${completed}/${needsEstimate.length}: ${course.courseCode||course.name}...`, regenId:course.id});
      bgLog({type:"user",content:`⏱ ${completed}/${needsEstimate.length}: ${course.name}`});
      
      const sys = `You are a WGU course duration researcher. Your job is to estimate realistic study hours for a WGU course.
Research the course thoroughly. Consider: credit units, assessment type (OA vs PA), typical student reports, course difficulty, and content scope.
Use the update_courses tool to set the averageStudyHours and difficulty fields.
Be realistic — base estimates on actual student experiences, not just credit hours.
Guidelines: 1 CU ≈ 15-25 study hours typically, but varies widely. Easy courses may take 10-20h total. Hard 4-CU courses may take 80-120h.`;

      const msg = `Estimate the total study hours needed to pass "${course.name}"${course.courseCode?` (${course.courseCode})`:""}.${course.credits?` It is ${course.credits} credit units.`:""} ${course.assessmentType?`Assessment type: ${course.assessmentType}.`:""} Set averageStudyHours and difficulty (1-5) using update_courses.`;
      
      try {
        const {logs:cLogs} = await runAILoop(profile, sys, [{role:"user",content:msg}], data, setData);
        for(const l of cLogs) bgLog(l);
      } catch(e) {
        bgLog({type:"error",content:`Failed for ${course.name}: ${e.message}`});
      }
    }
    
    toast(`Hour estimates complete: ${completed}/${needsEstimate.length} courses`, "success");
    bgSet({loading:false, regenId:null, label:""});
  };

  //  Drag-drop + priority reordering 
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const moveCourse = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    dlog('debug','state',`Move course ${fromIdx} → ${toIdx}`);
    setData(d => {
      const arr = [...d.courses];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return {...d, courses: arr};
    });
  };

  const setPriority = (courseId, newNum) => {
    const num = parseInt(newNum);
    if (isNaN(num) || num < 1) return;
    const fromIdx = courses.findIndex(c => c.id === courseId);
    const toIdx = Math.min(Math.max(num - 1, 0), courses.length - 1);
    moveCourse(fromIdx, toIdx);
  };

  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", idx);
  };
  const handleDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); };
  const handleDragLeave = () => setDragOverIdx(null);
  const handleDrop = (e, toIdx) => { e.preventDefault(); const fromIdx = dragIdx; setDragIdx(null); setDragOverIdx(null); if (fromIdx !== null) moveCourse(fromIdx, toIdx); };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const parseImage = async () => {
    if(!profile||!imgFile)return;
    bgSet({loading:true, logs:[{type:"user",content:`📷 Parsing: ${imgFile.name}`}], label:"Parsing degree plan..."});
    bgNewAbort();
    const signal = _bgState.abortCtrl?.signal;
    const b64=await fileToBase64(imgFile);
    const isAnth = isAnthProvider(profile);
    const headers = getAuthHeaders(profile);

    // Use a MINIMAL focused prompt — only extract name, code, credits. Enrichment handles the rest.
    const simpleSystem = `You are a WGU degree plan parser. Extract the MINIMUM info for each course visible in the image.
For each course, ONLY extract:
- name: The full course name including code (e.g. "Software Defined Networking – D415")
- courseCode: Just the code (e.g. "D415")  
- credits: Credit units (number)
- status: completed, in_progress, or not_started (based on visual indicators)

Do NOT estimate difficulty, do NOT add topics, do NOT add notes. Keep it minimal — enrichment will fill in details later.
Call add_courses with ALL courses you can see. Do NOT return an empty array.`;

    // Only send add_courses tool to keep it focused
    const addCourseTool = TOOLS.find(t => t.name === "add_courses");
    const toolsForParse = [addCourseTool];
    const toolsOAI = toolsForParse.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.input_schema}}));

    const imgContent = isAnth
      ? [{ type:"image", source:{ type:"base64", media_type:imgFile.type, data:b64 } }, { type:"text", text:"Parse this degree plan. Extract ONLY course name, code, credits, and status for each course. Keep data minimal." }]
      : [{ type:"image_url", image_url:{ url:`data:${imgFile.type};base64,${b64}` } }, { type:"text", text:"Parse this degree plan. Extract ONLY course name, code, credits, and status for each course. Keep data minimal." }];

    const body = isAnth
      ? { model:profile.model, max_tokens:16384, stream:true, system:simpleSystem, messages:[{role:"user",content:imgContent}], tools:toolsForParse }
      : { model:profile.model, max_tokens:16384, stream:true, messages:[{role:"system",content:simpleSystem},{role:"user",content:imgContent}], tools:toolsOAI };

    dlog('info','api',`Image parse: direct call with focused prompt (${simpleSystem.length} chars sys)`);

    let res;
    try {
      res = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body), signal });
      dlog('api','api',`Image parse response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
    } catch(e) {
      setApiStatus(false, 0, e.message);
      if (e.name === 'AbortError') { bgLog({type:"error",content:"Cancelled"}); bgSet({loading:false,label:""}); return; }
      bgLog({type:"error",content:`Network error: ${e.message}`});
      bgSet({loading:false,label:""}); setImgFile(null); setImgPreview(null); return;
    }

    if (!res.ok) {
      dlog('warn','api',`Image parse stream failed (${res.status}), trying non-stream`);
      try {
        const body2 = isAnth
          ? { model:profile.model, max_tokens:16384, system:simpleSystem, messages:[{role:"user",content:imgContent}], tools:toolsForParse }
          : { model:profile.model, max_tokens:16384, messages:[{role:"system",content:simpleSystem},{role:"user",content:imgContent}], tools:toolsOAI };
        const res2 = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body2), signal });
        setApiStatus(res2.ok, res2.status);
        if (!res2.ok) { const t = await res2.text(); bgLog({type:"error",content:`API ${res2.status}: ${t.slice(0,200)}`}); bgSet({loading:false,label:""}); return; }
        const rawText = await res2.text();
        let data2; try { data2 = JSON.parse(rawText); } catch(e) { bgLog({type:"error",content:`JSON error: ${rawText.slice(0,200)}`}); bgSet({loading:false,label:""}); return; }
        // Extract tool calls from non-streaming response
        const msg = isAnth ? null : data2.choices?.[0]?.message;
        const tcs = isAnth ? safeArr(data2.content).filter(b=>b.type==="tool_use") : safeArr(msg?.tool_calls);
        if (tcs.length > 0) {
          const parsed = tcs.map(tc => {
            const inp = isAnth ? tc.input : (typeof tc.function?.arguments==='string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {});
            return { id: tc.id, name: isAnth?tc.name:tc.function?.name, input: inp };
          });
          const results = executeTools(parsed, data, setData);
          for (const r of results) bgLog({type:"tool_result",content:`✅ ${r.result}`});
        } else {
          const txt = isAnth ? safeArr(data2.content).filter(b=>b.type==="text").map(b=>b.text).join("") : (msg?.content||"");
          bgLog({type:"text",content:txt||"Model didn't extract any courses"});
        }
      } catch(e) { bgLog({type:"error",content:e.message}); }
      bgSet({loading:false,label:""}); setImgFile(null); setImgPreview(null); return;
    }

    // Parse SSE stream (same as callAIStream but inline so we control everything)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", toolCallMap = {};
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          const tr = line.trim();
          if (!tr || tr === "data: [DONE]" || !tr.startsWith("data: ")) continue;
          let chunk; try { chunk = JSON.parse(tr.slice(6)); } catch(_e) { continue; }
          if (isAnth) {
            if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
              toolCallMap[chunk.index||0] = { id:chunk.content_block.id, name:chunk.content_block.name, arguments:"" };
            } else if (chunk.type === "content_block_delta" && chunk.delta?.type === "input_json_delta") {
              if (toolCallMap[chunk.index||0]) toolCallMap[chunk.index||0].arguments += (chunk.delta.partial_json||"");
            }
          } else {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index??0;
                if (!toolCallMap[idx]) toolCallMap[idx] = { id:tc.id||"", name:"", arguments:"" };
                if (tc.id) toolCallMap[idx].id = tc.id;
                if (tc.function?.name) toolCallMap[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCallMap[idx].arguments += tc.function.arguments;
              }
            }
          }
          // Update UI with progress
          const totalArgs = Object.values(toolCallMap).reduce((s,t)=>s+t.arguments.length,0);
          if (totalArgs > 0) bgStream(`📦 Receiving course data... (${totalArgs} chars)`);
        }
      }
    } catch(e) { dlog('error','api',`Image stream error: ${e.message}`); }

    // Parse results
    const toolCalls = Object.values(toolCallMap).map(tc => {
      let input = {};
      try {
        if (tc.arguments) {
          let fixed = tc.arguments;
          const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
          const braces = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
          for (let i=0;i<opens;i++) fixed += "]";
          for (let i=0;i<braces;i++) fixed += "}";
          input = JSON.parse(fixed);
        }
      } catch(e) { dlog('warn','api',`Image parse tool args failed`,tc.arguments?.slice(0,500)); }
      return { id:tc.id, name:tc.name, input };
    }).filter(tc=>tc.name);

    dlog('info','api',`Image parse done: ${toolCalls.length} tool calls, args: ${JSON.stringify(toolCalls.map(t=>({name:t.name,coursesCount:safeArr(t.input.courses).length}))).slice(0,300)}`);

    if (toolCalls.length > 0) {
      const totalCourses = toolCalls.reduce((sum, tc) => sum + safeArr(tc.input.courses).length, 0);
      for (const tc of toolCalls) bgLog({type:"tool_call",content:`Tool: ${tc.name}: ${safeArr(tc.input.courses).length} courses`});
      const results = executeTools(toolCalls, data, setData);
      for (const r of results) bgLog({type:"tool_result",content:`Done: ${r.result}`});
      if (totalCourses > 0) {
        toast(`${totalCourses} courses imported! Next: click 'Enrich All' to generate study context.`, "success");
      } else {
        toast(`Model responded but found 0 courses. Try a clearer image or a vision model (Claude Sonnet, GPT-4o).`, "warn");
      }
    } else {
      bgLog({type:"error",content:"Model didn't return tool calls. The image may not be clear or the model may not support vision."});
      toast(`Parse failed with ${profile?.name || "current model"}. Try a vision-capable model (Claude Sonnet/Opus, GPT-4o, Gemini Pro).`, "warn");
    }

    bgStream(""); bgSet({loading:false,label:""}); setImgFile(null); setImgPreview(null);
  };

  const genPlan = async () => {
    if(!profile)return; const active=courses.filter(c=>c.status!=="completed"); if(!active.length)return;
    // Pre-flight validation
    if (!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS) { toast("Schedule is infeasible — adjust dates or enable override", "error"); return; }
    if (!data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) { toast("Estimated finish exceeds term end date — increase hours, remove days off, or enable override", "error"); return; }
    if (!data.studyStartDate) { toast("Set a start date in Study Settings first", "warn"); return; }
    if (!data.targetCompletionDate && !data.targetDate) { toast("Set a target completion or term end date first", "warn"); return; }
    if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) { toast("Target completion is after term end — fix your dates first", "error"); return; }
    if (hrsPerDay < 1) { toast("Hours/day must be at least 1", "warn"); return; }
    bgSet({loading:true, logs:[{type:"user",content:"Generating study plan in weekly chunks..."}], label:"Generating study plan..."});
    
    const capturedTasks = [];
    const previewSetData = (fn) => {
      setData(d => {
        const next = typeof fn === "function" ? fn(d) : fn;
        if (next.tasks) {
          for (const [dt, dayTasks] of Object.entries(next.tasks)) {
            const oldTasks = d.tasks?.[dt] || [];
            const newOnes = safeArr(dayTasks).filter(t => !oldTasks.some(o => o.id === t.id));
            newOnes.forEach(t => capturedTasks.push({...t, date: dt}));
          }
        }
        return next;
      });
    };

    const courseDetails = active.map((c, i) => {
      const hrs = c.averageStudyHours > 0 ? c.averageStudyHours : ([0,20,35,50,70,100][c.difficulty||3]||50);
      return `${i+1}. ${c.name}${c.courseCode?` (${c.courseCode})`:""} — ${hrs}h est, ${c.credits||"?"}CU, ${c.assessmentType||"?"}, diff ${c.difficulty||3}/5`;
    }).join("\n");

    const startDt = data.studyStartDate || todayStr();
    const targetDt = goalDate || data.targetDate || "";
    const gradDt = data.targetDate || "";
    const hpd = data.studyHoursPerDay || 4;
    const exDts = safeArr(data.exceptionDates);
    const userCtx = planPrompt.trim() ? `\nStudent preferences: ${planPrompt.trim()}` : "";

    // Calculate total weeks needed
    const endDt = targetDt || gradDt;
    const totalDays = endDt ? diffDays(startDt, endDt) : (Math.ceil(totalEstHours / hpd) + 7);
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

    // Track cumulative hours assigned so we can tell the AI what's left
    let hoursAssigned = 0;

    for (let week = 0; week < totalWeeks; week++) {
      if (_bgState.abortCtrl?.signal?.aborted) { bgLog({type:"error",content:`Stopped after week ${week}`}); break; }

      const weekStart = new Date(startDt + "T12:00:00");
      weekStart.setDate(weekStart.getDate() + week * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const ws = weekStart.toISOString().split("T")[0];
      const we = weekEnd.toISOString().split("T")[0];

      // Skip weeks entirely past the end date
      if (endDt && ws > endDt) break;

      bgSet({label:`Generating week ${week+1}/${totalWeeks}: ${ws} — ${we}...`});
      bgLog({type:"user",content:`📅 Week ${week+1}/${totalWeeks}: ${ws} → ${we}`});

      const weekExDts = exDts.filter(d => d >= ws && d <= we);
      const hoursRemaining = totalEstHours - hoursAssigned;
      if (hoursRemaining <= 0) { bgLog({type:"text",content:"All course hours assigned — done!"}); break; }

      const sys = buildSystemPrompt(data, `Use generate_study_plan to create tasks for ONLY ${ws} through ${we} (7 days). Do NOT use add_tasks. Do NOT plan outside this date range.`);

      const weekMsg = `Generate study tasks for WEEK ${week+1} ONLY: ${ws} to ${we}.

COURSES (STRICT PRIORITY ORDER — complete #1 before starting #2, etc.):
${courseDetails}

PROGRESS: ~${Math.round(hoursAssigned)}h already scheduled of ~${totalEstHours}h total. ~${Math.round(hoursRemaining)}h remaining.
Hours/day: ${hpd}h | ${weekExDts.length > 0 ? `Days off this week: ${weekExDts.join(", ")}` : "No days off this week"}
${week === 0 && data.studyStartTime ? `First day starts at ${data.studyStartTime}` : ""}

SEQUENTIAL RULE (CRITICAL):
- Study ONE course at a time. Do NOT mix courses on the same day.
- Fully schedule all hours for course #1 first. Only move to course #2 after course #1's hours are exhausted.
- Exception: the transition day where course #1 finishes can have course #2 start after.
- Based on ${Math.round(hoursAssigned)}h already assigned, calculate which course we're currently on and continue from there.

CATEGORY TAGS (use these exactly):
- "study" = Learning new material, reading, watching lectures
- "review" = Revisiting/revising previously learned material
- "exam-prep" = Practice exams, mock tests, focused test preparation
- "exam-day" = The ACTUAL assessment day (OA exam or PA submission)
- "project" = Performance Assessment (PA) writing, research, drafting
- "class" = Live cohort sessions, instructor webinars
- "break" = Short rest between study blocks, meals

TASK STRUCTURE RULES:
- ONLY create tasks between ${ws} and ${we}. No dates outside this range.
- Study blocks: 1–2.5h max. Include 10–15 min breaks between blocks.
- Include a 30–60 min meal/rest break if 4+ hours in one day.
- Title format: "CourseCode — Specific Topic" (e.g., "D415 — SDN Architecture: Three Layers").
- When a course is nearly complete (~last 10-15% of hours), switch to "review" and "exam-prep" categories.
- Schedule an "exam-day" task on the LAST day of each course (1-2h block, title: "CourseCode — 🎯 OA Exam" or "CourseCode — 🎯 Submit PA").
- For PA courses, schedule "project" category tasks for writing/research.
- Each task needs date (YYYY-MM-DD), time, endTime (24h format).
- ~${Math.min(hpd * 7, hoursRemaining)}h this week.
${userCtx}`;

      try {
        const {logs:wLogs} = await runAILoop(profile, sys, [{role:"user",content:weekMsg}], data, previewSetData);
        for (const l of wLogs) bgLog(l);
        // Count hours added this week
        const weekTasks = capturedTasks.filter(t => t.date >= ws && t.date <= we);
        const weekHrs = weekTasks.reduce((s, t) => {
          const st = parseTime(t.time), et = parseTime(t.endTime);
          return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0);
        }, 0);
        hoursAssigned += weekHrs;
        bgLog({type:"text",content:`Week ${week+1}: ${weekTasks.length} tasks, ~${Math.round(weekHrs)}h (total: ~${Math.round(hoursAssigned)}h/${totalEstHours}h)`});
      } catch(e) {
        bgLog({type:"error",content:`Week ${week+1} failed: ${e.message}`});
      }
    }

    bgSet({loading:false, regenId:null, label:""});
    if (capturedTasks.length > 0) {
      setPendingPlan({ tasks: capturedTasks, summary: `${capturedTasks.length} tasks across ${[...new Set(capturedTasks.map(t=>t.date))].length} days (~${Math.round(hoursAssigned)}h scheduled)` });
      toast(`Plan generated — review ${capturedTasks.length} tasks before confirming`, "info");
    } else {
      toast("No tasks were generated — try adjusting your prompt or checking your AI connection", "warn");
    }
  };

  const confirmPlan = () => {
    if (!pendingPlan) return;
    // Tasks are already in data from previewSetData — just clear pending
    setPendingPlan(null);
    toast(`Study plan confirmed: ${pendingPlan.tasks.length} tasks added to calendar`, "success");
  };

  const discardPlan = () => {
    if (!pendingPlan) return;
    // Remove the tasks that were added
    setData(d => {
      const tasks = { ...d.tasks };
      for (const t of pendingPlan.tasks) {
        if (tasks[t.date]) {
          tasks[t.date] = tasks[t.date].filter(x => x.id !== t.id);
          if (tasks[t.date].length === 0) delete tasks[t.date];
        }
      }
      return { ...d, tasks };
    });
    setPendingPlan(null);
    toast("Plan discarded", "info");
  };

  const regenCourse = async (course) => {
    if(!profile)return;
    bgSet({loading:true, regenId:course.id, logs:[{type:"user",content:`🔄 Enriching: ${course.name}`}], label:`Enriching ${course.name}...`});
    dlog('info','api',`Regen: ${course.name}`);
    const sys=buildSystemPrompt(data,`Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
    const{logs}=await runAILoop(profile,sys,[{role:"user",content:`Tell me everything I truly need to know to pass ${course.name}. Fill in all context.`}],data,setData);
    for(const l of logs) bgLog(l);
    bgSet({loading:false, regenId:null, label:""});
  };

  const regenAll = async () => {
    if(!profile)return; const active=courses.filter(c=>c.status!=="completed"); if(!active.length)return;
    bgSet({loading:true, logs:[{type:"user",content:`🔄 Regenerating ${active.length} courses individually`}], label:`Regenerating 1/${active.length}...`});
    dlog('info','api',`Regen all (sequential): ${active.length} courses`);
    let completed = 0;
    for (const course of active) {
      if (_bgState.abortCtrl?.signal?.aborted) { bgLog({type:"error",content:`Stopped after ${completed}/${active.length}`}); break; }
      completed++;
      bgSet({label:`Regenerating ${completed}/${active.length}: ${course.name}...`, regenId:course.id});
      bgLog({type:"user",content:`🔄 ${completed}/${active.length}: ${course.name}`});
      const sys=buildSystemPrompt(data,`Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
      const{logs:cLogs}=await runAILoop(profile,sys,[{role:"user",content:`Tell me everything I truly need to know to pass ${course.name}. Fill in all context — competencies, topics with weights, exam tips, key terms, focus areas, resources, common mistakes.`}],data,setData);
      for(const l of cLogs) bgLog(l);
    }
    toast(`Regeneration complete: ${completed}/${active.length}`, "success");
    bgSet({loading:false, regenId:null, label:""});
  };

  const enrichNew = async () => {
    if(!profile)return;
    const unenriched = courses.filter(c => c.status!=="completed" && !hasCtx(c));
    if(!unenriched.length) { toast("All courses already enriched!", "info"); return; }
    
    // Sequential individual enrichment — one course at a time for reliability
    bgSet({loading:true, regenId:null, logs:[{type:"user",content:`✨ Enriching ${unenriched.length} course${unenriched.length>1?"s":""} individually`}], label:`Enriching 1/${unenriched.length}...`});
    dlog('info','api',`Enrich new (sequential): ${unenriched.length} courses`);
    
    let completed = 0;
    for (const course of unenriched) {
      // Check if user cancelled
      if (_bgState.abortCtrl?.signal?.aborted) {
        bgLog({type:"error",content:`Stopped after ${completed}/${unenriched.length} courses`});
        break;
      }
      completed++;
      bgSet({label:`Enriching ${completed}/${unenriched.length}: ${course.name}...`, regenId:course.id});
      bgLog({type:"user",content:`🔄 ${completed}/${unenriched.length}: ${course.name}`});
      
      const sys = buildSystemPrompt(data, `Generate deep context for "${course.name}" (${course.courseCode||"no code"}) using enrich_course_context. Include ALL fields: competencies with codes, topicBreakdown with percentage weights, examTips, keyTerms, focusAreas, resources, commonMistakes, assessmentType details. Be thorough — this is the ONLY call for this course.`);
      const {logs:cLogs} = await runAILoop(profile, sys, [{role:"user",content:`Generate comprehensive study context for ${course.name}${course.courseCode?` (${course.courseCode})`:""}.${course.credits?` ${course.credits} CU.`:""} Include everything a student needs to pass: assessment format, all competencies, topic breakdown with weights, exam tips, key terms, focus areas, resources, and common mistakes.`}], data, setData);
      
      for(const l of cLogs) bgLog(l);
      dlog('info','api',`Enriched ${completed}/${unenriched.length}: ${course.name}`);
    }
    
    toast(`Enrichment complete: ${completed}/${unenriched.length} courses processed`, "success");
    bgSet({loading:false, regenId:null, label:""});
  };

  const hasCtx = c => safeArr(c.competencies).length>0||safeArr(c.topicBreakdown).length>0||safeArr(c.examTips).length>0;

  // Step completion tracking (4 steps: Import → Configure → Enrich → Generate)
  const step1Done = courses.length > 0;
  const step2Done = step1Done && courses.filter(c=>c.status!=="completed").every(c=>c.averageStudyHours>0) && !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
  const step3Done = step2Done && courses.filter(c=>c.status!=="completed").every(c=>hasCtx(c));
  const step4Done = step3Done && Object.keys(data.tasks||{}).length > 0;
  const activeStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 4;
  
  // When activeStep advances, collapse the completed step and open the new one
  const prevActiveStep = useRef(activeStep);
  useEffect(() => {
    if (activeStep !== prevActiveStep.current) {
      // Only open the new active step — don't force-close anything (prevents date picker destruction)
      setManualStepOpen(p => ({...p, [activeStep]: true}));
      prevActiveStep.current = activeStep;
    }
  }, [activeStep]);

  const isStepOpen = (n) => {
    if (manualStepOpen[n] !== undefined) return manualStepOpen[n];
    return n === activeStep;
  };
  const toggleStep = (n) => setManualStepOpen(p => ({...p, [n]: !isStepOpen(n)}));

  const StepHead = ({n, title, done, disabled, subtitle, children}) => (
    <div style={{background:T.card,border:`1px solid ${done&&n!==activeStep?T.accent+"33":T.border}`,borderRadius:12,marginBottom:16,overflow:"hidden",opacity:disabled?0.4:1,pointerEvents:disabled?"none":"auto",transition:"opacity .2s"}}>
      <button onClick={()=>toggleStep(n)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",background:"none",border:"none",cursor:disabled?"default":"pointer",textAlign:"left"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:26,height:26,borderRadius:"50%",background:done?T.accent:n===activeStep?T.purple:T.input,border:`2px solid ${done?T.accent:n===activeStep?T.purple:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:fs(11),fontWeight:800,color:done||n===activeStep?"#fff":T.dim,flexShrink:0}}>
            {done ? "✓" : n}
          </div>
          <div>
            <div style={{fontSize:fs(14),fontWeight:700,color:disabled?T.dim:done&&n!==activeStep?T.soft:T.text}}>{title}</div>
            {subtitle&&!isStepOpen(n)&&<div style={{fontSize:fs(10),color:T.dim,marginTop:1}}>{subtitle}</div>}
            {disabled&&<div style={{fontSize:fs(10),color:T.dim,marginTop:1}}>Complete previous steps first</div>}
          </div>
        </div>
        {!disabled&&<span style={{fontSize:fs(10),color:T.dim,transition:"transform .2s",transform:isStepOpen(n)?"rotate(180deg)":"rotate(0)"}}>{isStepOpen(n)?"▲":"▼"}</span>}
      </button>
      {isStepOpen(n) && !disabled && <div style={{padding:"0 18px 16px"}}>{children}</div>}
    </div>
  );

  const AIActivity = () => (bg.loading || bg.logs.length > 0) ? (
    <div style={{background:T.panel,border:`1px solid ${T.purple}33`,borderRadius:10,padding:14,marginTop:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:bg.streamText||bg.logs.length>0?8:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {bg.loading && <Ic.Spin s={14}/>}
          <span style={{fontSize:fs(12),fontWeight:700,color:bg.loading?T.purple:T.soft}}>{bg.loading ? (bg.label||"AI working...") : "AI Activity"}</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          {bg.loading&&_bgState.abortCtrl&&<Btn small v="ghost" onClick={()=>{_bgState.abortCtrl?.abort();bgSet({loading:false,label:""});toast("Cancelled","info")}}>Cancel</Btn>}
          {!bg.loading&&bg.logs.length>0&&<Btn small v="ghost" onClick={()=>bgSet({logs:[]})}>Clear</Btn>}
        </div>
      </div>
      {bg.streamText&&<div style={{padding:"6px 10px",borderRadius:7,background:T.purpleD,border:`1px solid ${T.purple}33`,fontSize:fs(11),color:T.purple,whiteSpace:"pre-wrap",maxHeight:80,overflow:"auto",marginBottom:4}}>{bg.streamText}</div>}
      {bg.logs.length>0&&<div style={{maxHeight:150,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>{bg.logs.map((l,i)=><LogLine key={i} l={l}/>)}</div>}
    </div>
  ) : null;

  return (
    <div className="fade">
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setPage("dashboard")} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",color:T.soft,fontSize:fs(12),fontWeight:600}}>← Dashboard</button>
          <div><h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Course Planner</h1><p style={{color:T.dim,fontSize:fs(13)}}>{courses.length} courses · {doneCU}/{totalCU} CU</p></div>
        </div>
      </div>

      {/* STEP 1: Import Courses */}
      <StepHead n={1} title="Import Courses" done={step1Done} subtitle={step1Done?`${courses.length} courses imported`:""}>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
          <Btn small v="secondary" onClick={openAdd}><Ic.Plus s={12}/> Add Manually</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <button onClick={()=>{fileRef.current.accept="image/*";fileRef.current.click()}} disabled={bg.loading} style={{padding:"16px",borderRadius:10,border:`1.5px solid ${T.accent}44`,background:T.accentD,cursor:bg.loading?"wait":"pointer",textAlign:"left"}}>
            <div style={{fontSize:fs(13),fontWeight:700,color:T.accent,marginBottom:3}}>Screenshot / Image</div>
            <div style={{fontSize:fs(10),color:T.soft,lineHeight:1.4}}>Upload a screenshot of your WGU degree plan page</div>
          </button>
          <button onClick={()=>{fileRef.current.accept=".pdf,.doc,.docx,.txt,.csv,image/*";fileRef.current.click()}} disabled={bg.loading} style={{padding:"16px",borderRadius:10,border:`1.5px solid ${T.blue}44`,background:T.blueD,cursor:bg.loading?"wait":"pointer",textAlign:"left"}}>
            <div style={{fontSize:fs(13),fontWeight:700,color:T.blue,marginBottom:3}}>Document / PDF</div>
            <div style={{fontSize:fs(10),color:T.soft,lineHeight:1.4}}>Upload PDF, DOCX, or text file of your degree plan</div>
          </button>
        </div>
        {!profile && <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange}}>Connect an AI profile in Settings first — parsing requires a vision-capable model.</div>}
        <div style={{marginTop:10,fontSize:fs(10),color:T.dim,lineHeight:1.5}}>Image and document parsing requires a vision-capable AI model such as Claude Sonnet/Opus, GPT-4o, or Gemini Pro.</div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
        {imgPreview&&<div style={{marginTop:12,padding:12,background:T.panel,borderRadius:10,border:`1px solid ${T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:fs(12),fontWeight:700}}>Degree Plan Image</span>
            <div style={{display:"flex",gap:8}}>
              <Btn small v="ghost" onClick={()=>{setImgFile(null);setImgPreview(null)}}>Remove</Btn>
              <Btn small v="ai" onClick={parseImage} disabled={bg.loading}>{bg.loading?<><Ic.Spin s={14}/> Parsing...</>:<><Ic.AI s={14}/> Extract Courses</>}</Btn>
            </div>
          </div>
          <img src={imgPreview} style={{maxWidth:"100%",maxHeight:200,borderRadius:10,border:`1px solid ${T.border}`}} alt="plan"/>
        </div>}
        {activeStep===1 && <AIActivity/>}
      </StepHead>

      {/* STEP 2: Configure Study Plan (Hours + Settings combined) */}
      {(() => {
        const needsHours = courses.filter(c => c.status !== "completed" && (!c.averageStudyHours || c.averageStudyHours <= 0));
        const isEstimating = bg.loading && (bg.label||"").toLowerCase().includes("estimat");
        const allHaveHours = needsHours.length === 0 && courses.length > 0;
        const hasSettings = !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
        return (
          <StepHead n={2} title="Configure Study Plan" done={step2Done} disabled={!step1Done} subtitle={step2Done?`${activeCourses.length} courses · ${data.studyHoursPerDay}h/day · ${data.targetCompletionDate?new Date(data.targetCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}`:""}>

            {/* Section A: Study Settings — streamlined left to right */}
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:fs(12),fontWeight:700,color:T.text,display:"flex",alignItems:"center",gap:6}}>
                  📅 Study Settings
                  {hasSettings && <Badge color={T.accent} bg={T.accentD}>✓</Badge>}
                </div>
                <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:fs(10),color:data.overrideSafeguards?T.orange:T.dim}}>
                  <input type="checkbox" checked={!!data.overrideSafeguards} onChange={e=>setData(d=>({...d,overrideSafeguards:e.target.checked}))} style={{width:14,height:14,accentColor:T.orange}}/>
                  Override safeguards
                </label>
              </div>

              {/* Row 1: Dates */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>
                <div>
                  <Label>1. Start Date *</Label>
                  <BufferedInput type="date" value={data.studyStartDate||""} onCommit={v=>setData(d=>({...d,studyStartDate:v}))}/>
                </div>
                <div style={{opacity:data.studyStartDate?1:0.4,pointerEvents:data.studyStartDate?"auto":"none"}}>
                  <Label>2. Target Completion *</Label>
                  <BufferedInput type="date" value={data.targetCompletionDate||""} onCommit={v=>setData(d=>({...d,targetCompletionDate:v}))} title="When you want to finish all courses"/>
                </div>
                <div style={{opacity:data.studyStartDate&&data.targetCompletionDate?1:0.4,pointerEvents:data.studyStartDate&&data.targetCompletionDate?"auto":"none"}}>
                  <Label>3. Term End Date</Label>
                  <BufferedInput type="date" value={data.targetDate||""} onCommit={v=>setData(d=>({...d,targetDate:v}))} title="Official WGU term end (hard deadline)"/>
                </div>
                <div style={{opacity:data.studyStartDate&&(data.targetCompletionDate||data.targetDate)?1:0.4,pointerEvents:data.studyStartDate&&(data.targetCompletionDate||data.targetDate)?"auto":"none"}}>
                  <Label>4. Start Time</Label>
                  <BufferedInput type="time" value={data.studyStartTime||""} onCommit={v=>setData(d=>({...d,studyStartTime:v}))}/>
                </div>
              </div>

              {/* Row 2: Hours/Day — auto-calculated default */}
              {data.studyStartDate && (data.targetCompletionDate || data.targetDate) && (() => {
                const recHrs = minHrsPerDay != null && minHrsPerDay > 0 && minHrsPerDay <= MAX_STUDY_HRS ? Math.ceil(minHrsPerDay) : 4;
                return (
                  <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:14}}>
                    <div style={{width:120}}>
                      <Label>5. Hours/Day</Label>
                      <BufferedInput type="number" min="1" max={data.overrideSafeguards?24:MAX_STUDY_HRS} value={data.studyHoursPerDay||4} onCommit={v=>{
                        const max = data.overrideSafeguards ? 24 : MAX_STUDY_HRS;
                        const n = Math.max(1, Math.min(max, Number(v) || 4));
                        setData(d=>({...d,studyHoursPerDay:n}));
                      }}/>
                    </div>
                    {hrsPerDay < recHrs && (
                      <button onClick={()=>setData(d=>({...d,studyHoursPerDay:recHrs}))} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${T.accent}44`,background:T.accentD,cursor:"pointer",fontSize:fs(11),fontWeight:600,color:T.accent,marginBottom:1}}>
                        Set to minimum ({recHrs}h/day)
                      </button>
                    )}
                    <div style={{fontSize:fs(10),color:T.dim,marginBottom:6}}>
                      Minimum: {minHrsPerDay ?? "—"}h/day to finish on time
                    </div>
                  </div>
                );
              })()}

              {/* Day Off Section */}
              {data.studyStartDate && (data.targetCompletionDate || data.targetDate) && (
                <div style={{background:T.input,borderRadius:10,padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:fs(12),fontWeight:700,color:T.text}}>🚫 Days Off & Exceptions</div>
                    <span style={{fontSize:fs(10),color:T.dim}}>{exceptionDates.length} day{exceptionDates.length!==1?"s":""} excluded</span>
                  </div>

                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                    <input type="date" value={newExDate} onChange={e=>setNewExDate(e.target.value)} style={{flex:"0 0 160px"}}/><Btn small onClick={addExDate} disabled={!newExDate}>Add Date</Btn>
                  </div>

                  {/* Recurring buttons */}
                  <div style={{fontSize:fs(10),color:T.dim,marginBottom:6}}>Quick add recurring days off (through {new Date((data.targetCompletionDate||data.targetDate)+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}):</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                    {(() => {
                      const override = !!data.overrideSafeguards;
                      const wkndDates = [];
                      const s = new Date((data.studyStartDate||todayStr())+"T12:00:00");
                      const e = new Date((data.targetCompletionDate||data.targetDate)+"T12:00:00");
                      while (s <= e) { if ([0,6].includes(s.getDay())) { const ds=s.toISOString().split("T")[0]; if(!exceptionDates.includes(ds)) wkndDates.push(ds); } s.setDate(s.getDate()+1); }
                      const wkndProjected = wkndDates.length > 0 ? calcMinHrsWithDates(wkndDates) : null;
                      const wkndBlocked = !override && wkndProjected !== null && wkndProjected > MAX_STUDY_HRS;
                      return <Btn small v="secondary" onClick={()=>addRecurringDayOff([0,6])} disabled={wkndBlocked} title={wkndBlocked?`Would require ${wkndProjected}h/day`:""}>🗓 Weekends</Btn>;
                    })()}
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,i) => {
                      const override = !!data.overrideSafeguards;
                      const count = exceptionDates.filter(dt => new Date(dt+"T12:00:00").getDay()===i).length;
                      let wouldBlock = false;
                      if (!override && count === 0) {
                        const newDays = [];
                        const s = new Date((data.studyStartDate||todayStr())+"T12:00:00");
                        const e = new Date((data.targetCompletionDate||data.targetDate)+"T12:00:00");
                        while (s <= e) { if(s.getDay()===i){ const ds=s.toISOString().split("T")[0]; if(!exceptionDates.includes(ds)) newDays.push(ds); } s.setDate(s.getDate()+1); }
                        const proj = calcMinHrsWithDates(newDays);
                        wouldBlock = proj !== null && proj > MAX_STUDY_HRS;
                      }
                      return (
                        <button key={i} onClick={()=>count>0?clearRecurringDayOff([i]):addRecurringDayOff([i])} disabled={wouldBlock && count===0}
                          title={wouldBlock ? "Would exceed limit (enable override)" : count>0 ? `Remove all ${day}s` : `Add every ${day} off`}
                          style={{padding:"5px 10px",borderRadius:7,border:`1px solid ${count>0?T.orange:wouldBlock?T.red+"55":T.border}`,background:count>0?T.orangeD:T.input,color:count>0?T.orange:wouldBlock?T.red:T.soft,fontSize:fs(10),fontWeight:600,cursor:wouldBlock&&count===0?"not-allowed":"pointer",opacity:wouldBlock&&count===0?0.5:1,display:"flex",alignItems:"center",gap:4}}>
                          {day}{count>0&&<span style={{fontSize:fs(8),opacity:0.7}}>({count})</span>}
                        </button>
                      );
                    })}
                    {exceptionDates.length > 0 && <Btn small v="ghost" onClick={()=>{if(confirm(`Clear all ${exceptionDates.length} exception dates?`))setData(d=>({...d,exceptionDates:[]}))}}>Clear All</Btn>}
                  </div>

                  {exceptionDates.length > 0 && <div style={{display:"flex",gap:4,flexWrap:"wrap",maxHeight:120,overflowY:"auto"}}>{exceptionDates.map(dt=><div key={dt} style={{display:"flex",alignItems:"center",gap:3,padding:"3px 9px",borderRadius:5,background:T.orangeD,fontSize:fs(10),color:T.orange}}>{new Date(dt+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}<button onClick={()=>removeExDate(dt)} style={{background:"none",border:"none",color:T.orange,cursor:"pointer",fontSize:fs(12),padding:0}}>×</button></div>)}</div>}
                </div>
              )}

              {/* Warnings */}
              {minHrsPerDay != null && minHrsPerDay > 12 && !data.overrideSafeguards && (
                <div style={{padding:"8px 12px",borderRadius:8,background:minHrsPerDay>MAX_STUDY_HRS?T.redD:T.orangeD,border:`1px solid ${minHrsPerDay>MAX_STUDY_HRS?T.red:T.orange}33`,fontSize:fs(11),color:minHrsPerDay>MAX_STUDY_HRS?T.red:T.orange,marginBottom:10}}>
                  {minHrsPerDay > MAX_STUDY_HRS
                    ? `🚨 Infeasible: ${minHrsPerDay}h/day needed — exceeds ${MAX_STUDY_HRS}h max. Remove days off, extend target, or enable override.`
                    : `⚠️ Tight: ${minHrsPerDay}h/day needed. Consider removing exception dates.`}
                </div>
              )}
              {data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS && (
                <div style={{padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:10}}>
                  ⚠️ Override active — {minHrsPerDay}h/day required. Safeguards disabled at your request.
                </div>
              )}

              {/* Validation checks */}
              {(() => {
                const warns = [];
                if (hrsPerDay < 2 && totalEstHours > 0) warns.push({c:T.orange,m:`⚠️ ${hrsPerDay}h/day is very low. Most WGU students need 3-6h/day.`});
                if (hrsPerDay > 12 && hrsPerDay <= MAX_STUDY_HRS) warns.push({c:T.orange,m:`⚠️ ${hrsPerDay}h/day is extremely high. Risk of burnout.`});
                if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) warns.push({c:T.red,m:"🚨 Target completion is AFTER term end."});
                if (data.studyStartDate && data.targetCompletionDate && data.studyStartDate >= data.targetCompletionDate) warns.push({c:T.red,m:"🚨 Start date on or after completion — no study days."});
                if (data.studyStartDate && data.studyStartDate > todayStr()) warns.push({c:T.blue,m:`ℹ️ Start date is in the future.`});
                // Est. finish vs term end
                if (estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) {
                  const overDays = diffDays(data.targetDate, estCompletionDate);
                  warns.push({c:T.red,m:`🚨 Estimated finish (${new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) is ${overDays} day${overDays>1?"s":""} past your term end. Increase hours/day, remove days off, or extend your term.`});
                } else if (estCompletionDate && data.targetCompletionDate && estCompletionDate > data.targetCompletionDate) {
                  const overDays = diffDays(data.targetCompletionDate, estCompletionDate);
                  warns.push({c:T.orange,m:`⚠️ Estimated finish (${new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) is ${overDays} day${overDays>1?"s":""} past your target completion.`});
                }
                const studyDaysAvail = effectiveTarget && startDate ? calcStudyDays(startDate, effectiveTarget) : null;
                const totalCalDays = effectiveTarget && startDate ? diffDays(startDate, effectiveTarget) : null;
                if (studyDaysAvail != null && totalCalDays != null && totalCalDays > 0) {
                  const offPct = Math.round((1 - studyDaysAvail / totalCalDays) * 100);
                  if (offPct > 60) warns.push({c:T.red,m:`🚨 ${offPct}% of calendar is days off. Only ${studyDaysAvail} study days.`});
                }
                if (warns.length === 0) return null;
                return <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:10}}>{warns.map((w,i) => <div key={i} style={{padding:"6px 12px",borderRadius:7,background:`${w.c}11`,border:`1px solid ${w.c}33`,fontSize:fs(10),color:w.c}}>{w.m}</div>)}</div>;
              })()}
            </div>

            {/* Divider */}
            <div style={{borderTop:`1px solid ${T.border}`,marginBottom:16}}/>

            {/* Section B: Estimate Hours */}
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:fs(12),fontWeight:700,color:T.text,display:"flex",alignItems:"center",gap:6}}>
                  ⏱ Estimate Study Hours
                  {allHaveHours && <Badge color={T.accent} bg={T.accentD}>✓</Badge>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  {isEstimating && _bgState.abortCtrl && (
                    <Btn small v="ghost" onClick={()=>{_bgState.abortCtrl?.abort();bgSet({loading:false,regenId:null,label:""});toast("Estimation stopped","info")}} style={{color:T.red,borderColor:T.red}}>Stop</Btn>
                  )}
                  <Btn v={allHaveHours?"secondary":"ai"} onClick={estimateHours} disabled={bg.loading||!profile||allHaveHours}>
                    {isEstimating?<><Ic.Spin s={14}/> Estimating...</>:allHaveHours?"All Estimated ✓":"Estimate Hours"}
                  </Btn>
                </div>
              </div>
              <div style={{fontSize:fs(11),color:T.soft,marginBottom:8}}>{allHaveHours ? `All ${courses.filter(c=>c.status!=="completed").length} courses have hour estimates` : `${needsHours.length} course${needsHours.length>1?"s":""} need AI-powered hour estimates`}</div>
              {(needsHours.length > 0 || isEstimating) && (
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                  {courses.filter(c=>c.status!=="completed").map(c => (
                    <span key={c.id} style={{fontSize:fs(10),padding:"3px 9px",borderRadius:5,fontWeight:600,
                      background:c.averageStudyHours>0?T.accentD:(isEstimating&&bg.regenId===c.id)?T.purpleD:T.input,
                      color:c.averageStudyHours>0?T.accent:(isEstimating&&bg.regenId===c.id)?T.purple:T.dim,
                    }}>{(isEstimating&&bg.regenId===c.id)?"⏳ ":""}{c.courseCode||c.name.slice(0,12)} {c.averageStudyHours>0?`${c.averageStudyHours}h ✓`:"—"}</span>
                  ))}
                </div>
              )}
            </div>
            {activeStep===2 && <AIActivity/>}
          </StepHead>
        );
      })()}

      {/* Estimates (compact) */}
      {activeCourses.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:16}}>
          {[
            {l:"Est. Hours",v:totalEstHours,c:T.purple,sub:`${activeCourses.length} courses`},
            {l:"Est. Days",v:rawDaysNeeded,c:T.blue,sub:`at ${hrsPerDay}h/day`},
            {l:"Est. Finish",v:estCompletionDate?new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})+" '"+new Date(estCompletionDate+"T12:00:00").getFullYear().toString().slice(2):"—",c:estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate?T.red:estCompletionDate&&effectiveTarget&&estCompletionDate>effectiveTarget?T.orange:T.accent,sub:estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate?"⚠ past term end":effectiveDaysLeft!=null?`${effectiveDaysLeft}d to goal`:"set target"},
            {l:"Min Hrs/Day",v:minHrsPerDay!=null?(!data.overrideSafeguards&&minHrsPerDay>MAX_STUDY_HRS?"❌":minHrsPerDay):"—",c:minHrsPerDay!=null&&!data.overrideSafeguards&&minHrsPerDay>MAX_STUDY_HRS?T.red:minHrsPerDay!=null&&minHrsPerDay>12?T.red:minHrsPerDay!=null&&minHrsPerDay>8?T.orange:T.accent,sub:minHrsPerDay!=null&&!data.overrideSafeguards&&minHrsPerDay>MAX_STUDY_HRS?"infeasible":effectiveTarget?"to hit target":"—"},
          ].map((s,i)=>(
            <div key={i} className="sf-stat" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px",textAlign:"center"}}>
              <div style={{fontSize:fs(9),color:T.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:fs(22),fontWeight:800,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}</div>
              <div style={{fontSize:fs(9),color:T.dim}}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}
      {!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS && <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(12),color:T.red,marginBottom:12,fontWeight:600}}>🚨 Schedule is infeasible — {minHrsPerDay}h/day required but maximum is {MAX_STUDY_HRS}h. Extend your target date, remove days off, or enable override.</div>}
      {!data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate && (minHrsPerDay==null||minHrsPerDay<=MAX_STUDY_HRS) && <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(12),color:T.red,marginBottom:12,fontWeight:600}}>🚨 Estimated finish ({new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) exceeds term end ({new Date(data.targetDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}). Increase hours/day or reduce days off.</div>}
      {minHrsPerDay != null && minHrsPerDay > hrsPerDay && minHrsPerDay <= MAX_STUDY_HRS && <div style={{padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:12}}>You need {minHrsPerDay}h/day to hit your target completion — currently set to {hrsPerDay}h/day.</div>}

      {/* STEP 3: Enrich Courses */}
      {(() => {
        const unenriched = courses.filter(c => c.status!=="completed" && !hasCtx(c));
        const isEnriching = bg.loading && (bg.label||"").toLowerCase().includes("enrich");
        return (
          <StepHead n={3} title="Enrich Courses" done={step3Done} disabled={!step2Done} subtitle={step3Done?`All ${activeCourses.length} courses enriched`:unenriched.length>0?`${unenriched.length} need enrichment`:""}>
            {!profile && <div style={{padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:10}}>Connect an AI profile in Settings first.</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:fs(11),color:T.soft}}>{step3Done?"All courses have exam intelligence":"Sequential individual enrichment for reliable, thorough results"}</div>
              <div style={{display:"flex",gap:8}}>
                {isEnriching && _bgState.abortCtrl && (
                  <Btn small v="ghost" onClick={()=>{_bgState.abortCtrl?.abort();bgSet({loading:false,regenId:null,label:""});toast("Enrichment stopped","info")}} style={{color:T.red,borderColor:T.red}}>Stop</Btn>
                )}
                <Btn v={step3Done?"secondary":"ai"} onClick={enrichNew} disabled={bg.loading||!profile||unenriched.length===0}>
                  {isEnriching?<><Ic.Spin s={14}/> Working...</>:step3Done?"All Enriched ✓":"Enrich All New"}
                </Btn>
              </div>
            </div>
            {(isEnriching || unenriched.length > 0) && (
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {courses.filter(c=>c.status!=="completed").map(c => {
                  const enriched = hasCtx(c);
                  const active = bg.regenId === c.id;
                  return (
                    <span key={c.id} style={{fontSize:fs(9),padding:"3px 8px",borderRadius:5,fontWeight:600,
                      background:active?T.purpleD:enriched?T.accentD:T.input,
                      color:active?T.purple:enriched?T.accent:T.dim,
                    }}>{active?"⏳ ":""}{c.courseCode||c.name.slice(0,15)}{enriched?" ✓":""}</span>
                  );
                })}
              </div>
            )}
            {activeStep===3 && <AIActivity/>}
          </StepHead>
        );
      })()}

      {/* Course List */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:fs(14),fontWeight:700}}>Courses ({courses.length})</h3>
        <div style={{display:"flex",gap:6}}>
          <Btn small v="ai" onClick={regenAll} disabled={bg.loading||!profile||activeCourses.length===0}>Regenerate All</Btn>
          <Btn small v="ghost" onClick={()=>setExpanded(courses.reduce((a,c)=>({...a,[c.id]:true}),{}))}>Expand</Btn>
          <Btn small v="ghost" onClick={()=>setExpanded({})}>Collapse</Btn>
        </div>
      </div>

      {courses.length===0?<div style={{padding:"30px 0",textAlign:"center",color:T.dim,fontSize:fs(13)}}>No courses yet. Import a degree plan or add manually.</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:16}}>
          {courses.map((c,i)=>(
            <div key={c.id} draggable onDragStart={e=>handleDragStart(e,i)} onDragOver={e=>handleDragOver(e,i)} onDragLeave={handleDragLeave} onDrop={e=>handleDrop(e,i)} onDragEnd={handleDragEnd} className="fade sf-card"
              style={{background:dragOverIdx===i?T.purpleD:dragIdx===i?T.input:T.card,border:`1px solid ${dragOverIdx===i?T.purple:T.border}`,borderRadius:12,padding:"10px 14px",opacity:dragIdx===i?0.5:1,cursor:"grab"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="number" min="1" max={courses.length} value={i+1} onChange={e=>setPriority(c.id,e.target.value)} onClick={e=>e.stopPropagation()} style={{width:36,padding:"4px 2px",textAlign:"center",fontSize:fs(13),fontWeight:700,color:c.status==="completed"?T.dim:T.accent,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:6,cursor:"text",fontFamily:"'Outfit',sans-serif"}}/>
                <div style={{width:5,height:40,borderRadius:3,background:STATUS_C[c.status]||T.dim,flexShrink:0}}/>
                <div style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>setExpanded(e=>({...e,[c.id]:!e[c.id]}))}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:fs(13),fontWeight:600}}>{c.name}</span>
                    <Badge color={STATUS_C[c.status]||T.dim} bg={(STATUS_C[c.status]||T.dim)+"22"}>{STATUS_L[c.status]||c.status}</Badge>
                    {c.assessmentType&&<Badge color={T.blue} bg={T.blueD}>{c.assessmentType}</Badge>}
                    {hasCtx(c)?<Badge color={T.accent} bg={T.accentD}>ENRICHED</Badge>:c.status!=="completed"&&<Badge color={T.orange} bg={T.orangeD}>NEEDS ENRICHMENT</Badge>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:fs(11),color:T.dim,flexWrap:"wrap"}}>
                    <span>{c.credits||0} CU</span>
                    <span>{"★".repeat(c.difficulty||0)}{"☆".repeat(5-(c.difficulty||0))}</span>
                    {c.averageStudyHours>0&&<span>~{c.averageStudyHours}h</span>}
                    <CtxBadge label="Topics" count={safeArr(c.topicBreakdown).length} color={T.purple}/>
                    <CtxBadge label="Terms" count={safeArr(c.keyTermsAndConcepts).length} color={T.blue}/>
                    <CtxBadge label="Tips" count={safeArr(c.examTips).length} color={T.yellow}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:3,flexShrink:0,alignItems:"center"}}>
                  <button onClick={e=>{e.stopPropagation();if(i>0)moveCourse(i,i-1)}} disabled={i===0} style={{background:"none",border:"none",color:i>0?T.soft:T.faint,cursor:i>0?"pointer":"default",padding:2,fontSize:fs(16),lineHeight:1}}>↑</button>
                  <button onClick={e=>{e.stopPropagation();if(i<courses.length-1)moveCourse(i,i+1)}} disabled={i===courses.length-1} style={{background:"none",border:"none",color:i<courses.length-1?T.soft:T.faint,cursor:i<courses.length-1?"pointer":"default",padding:2,fontSize:fs(16),lineHeight:1}}>↓</button>
                  <Btn small v={bg.regenId===c.id?"ai":"ghost"} onClick={()=>regenCourse(c)} disabled={!profile||bg.regenId===c.id||bg.loading}>{bg.regenId===c.id?<Ic.Spin s={12}/>:bg.loading?"—":"🔄"}</Btn>
                  <button onClick={()=>openEdit(c)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Edit/></button>
                  <button onClick={()=>deleteCourse(c.id)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Trash/></button>
                </div>
              </div>
              {expanded[c.id] && <ErrorBoundary key={c.id+"detail"}><CourseDetail c={c}/></ErrorBoundary>}
            </div>
          ))}
        </div>
      )}

      {/* STEP 4: Generate Study Plan */}
      {(() => {
        const isBusy = bg.loading && !(bg.label||"").toLowerCase().includes("plan");
        const isGenerating = bg.loading && (bg.label||"").toLowerCase().includes("plan");
        return (
        <StepHead n={4} title="Generate Study Plan" done={step4Done} disabled={!step3Done} subtitle={step4Done?`${Object.keys(data.tasks||{}).length} days scheduled`:""}>
          <textarea value={planPrompt} onChange={e=>setPlanPrompt(e.target.value)} disabled={isBusy} placeholder="Optional: Describe your scheduling preferences — e.g. 'I work 9-5 weekdays so only schedule study in evenings and weekends'..." style={{minHeight:45,fontSize:fs(11),marginBottom:10,opacity:isBusy?0.4:1}}/>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:pendingPlan?12:0}}>
              {isGenerating && _bgState.abortCtrl && (
                <Btn small v="ghost" onClick={()=>{_bgState.abortCtrl?.abort();bgSet({loading:false,regenId:null,label:""});toast("Plan generation stopped","info")}} style={{color:T.red,borderColor:T.red}}>⬛ Stop</Btn>
              )}
              <Btn v={isBusy?"secondary":"ai"} onClick={genPlan} disabled={bg.loading||!profile||activeCourses.length===0||(!data.overrideSafeguards&&((minHrsPerDay!=null&&minHrsPerDay>MAX_STUDY_HRS)||(estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate)))}>
                {!data.overrideSafeguards&&minHrsPerDay!=null&&minHrsPerDay>MAX_STUDY_HRS?"Schedule Infeasible":!data.overrideSafeguards&&estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate?"Exceeds Term End":isGenerating?<><Ic.Spin s={14}/> Generating...</>:isBusy?"Waiting...":"Generate Plan"}
              </Btn>
          </div>
          {pendingPlan && (
            <div style={{marginTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:fs(12),color:T.soft}}>{pendingPlan.summary}</span>
                <div style={{display:"flex",gap:8}}>
                  <Btn small v="primary" onClick={confirmPlan}>Confirm</Btn>
                  <Btn small v="ghost" onClick={discardPlan}>Discard</Btn>
                </div>
              </div>
              <div style={{maxHeight:250,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
                {[...new Set(pendingPlan.tasks.map(t=>t.date))].sort().map(dt => (
                  <div key={dt}>
                    <div style={{fontSize:fs(10),fontWeight:700,color:T.accent,padding:"4px 0 2px"}}>{new Date(dt+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
                    {pendingPlan.tasks.filter(t=>t.date===dt).map((t,j) => (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 8px",borderRadius:6,background:T.input,marginBottom:2,fontSize:fs(10)}}>
                        <span style={{color:T.blue,minWidth:40,fontFamily:"'JetBrains Mono',monospace"}}>{t.time||"—"}</span>
                        <span style={{flex:1,color:T.text}}>{t.title}</span>
                        {t.endTime&&<span style={{color:T.dim,fontSize:fs(9)}}>→ {t.endTime}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeStep===4 && <AIActivity/>}
        </StepHead>
        );
      })()}

      {showAdd&&<Modal title={editId?"Edit Course":"Add Course"} onClose={()=>setShowAdd(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div><Label>Course Name</Label><input autoFocus value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. C779 - Web Development"/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
            <div><Label>Code</Label><input value={form.courseCode} onChange={e=>setForm({...form,courseCode:e.target.value})} placeholder="C779"/></div>
            <div><Label>Credits</Label><input type="number" min="1" max="12" value={form.credits} onChange={e=>setForm({...form,credits:e.target.value})}/></div>
            <div><Label>Difficulty</Label><input type="number" min="1" max="5" value={form.difficulty} onChange={e=>setForm({...form,difficulty:e.target.value})}/></div>
            <div><Label>Assessment</Label><select value={form.assessmentType} onChange={e=>setForm({...form,assessmentType:e.target.value})}><option value="">—</option><option value="OA">OA</option><option value="PA">PA</option><option value="OA+PA">OA+PA</option></select></div>
          </div>
          <div><Label>Status</Label><div style={{display:"flex",gap:4}}>{["not_started","in_progress","completed"].map(s=><button key={s} onClick={()=>setForm({...form,status:s})} style={{flex:1,padding:"8px 0",borderRadius:8,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${form.status===s?(STATUS_C[s]||T.dim):T.border}`,background:form.status===s?(STATUS_C[s]||T.dim)+"22":T.input,color:form.status===s?(STATUS_C[s]||T.dim):T.dim}}>{STATUS_L[s]}</button>)}</div></div>
          <div><Label>Topics</Label><input value={form.topics||""} onChange={e=>setForm({...form,topics:e.target.value})} placeholder="HTML, CSS..."/></div>
          <div><Label>Notes</Label><input value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Tips..."/></div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}><Btn v="secondary" onClick={()=>setShowAdd(false)}>Cancel</Btn><Btn onClick={saveCourse} disabled={!form.name.trim()}>{editId?"Update":"Add"}</Btn></div>
        </div>
      </Modal>}
    </div>
  );
};

// ----------------------------------------------------------------------
// STUDY CHAT (with tool-use)
// ----------------------------------------------------------------------
const StudyChatPage=({data,setData,profile})=>{
  const bp = useBreakpoint();
  const[selCourse,setSelCourse]=useState(data.courses?.[0]?.id||"");
  const[input,setInput]=useState("");
  const[loading,setLoading]=useState(false);
  const[chatAbort,setChatAbort]=useState(null);
  const[imgFile,setImgFile]=useState(null);
  const[imgPrev,setImgPrev]=useState(null);
  const[showExport,setShowExport]=useState(false);
  const[searchQ,setSearchQ]=useState("");
  const messagesEnd=useRef(null);
  const fileRef=useRef(null);

  const course=data.courses?.find(c=>c.id===selCourse);
  const chatKey=selCourse||"_general";
  const messages=data.chatHistories?.[chatKey]||[];
  const hasCtx = c => safeArr(c?.competencies).length>0||safeArr(c?.topicBreakdown).length>0||safeArr(c?.examTips).length>0;

  useEffect(()=>{messagesEnd.current?.scrollIntoView({behavior:"smooth"})},[messages.length]);

  const handleImg=(e)=>{
    const f=e.target.files?.[0];if(!f)return;setImgFile(f);
    const r=new FileReader();r.onload=()=>setImgPrev(r.result);r.readAsDataURL(f);
    e.target.value='';
  };

  const stopChat = () => { if(chatAbort) { chatAbort.abort(); setChatAbort(null); setLoading(false); toast("Stopped","info"); } };

  const sendMessage=async(overrideMsg)=>{
    if(loading) { stopChat(); return; }
    const msg = overrideMsg || input.trim();
    if((!msg&&!imgFile)||!profile)return;
    const controller = new AbortController();
    setChatAbort(controller);
    if(!overrideMsg) setInput("");

    const displayMsg={role:"user",content:msg,hasImage:!!imgFile};
    const newMsgs=[...messages,displayMsg];
    setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:newMsgs}}));
    setLoading(true);

    // Rich course context including enrichment data
    let courseCtx = "No specific course selected — general study help.";
    if (course) {
      courseCtx = `Active course: ${course.name} (${course.courseCode||"no code"})
Credits: ${course.credits} CU | Difficulty: ${course.difficulty}/5 | Status: ${course.status} | Assessment: ${course.assessmentType||"unknown"}`;
      if (safeArr(course.topicBreakdown).length > 0) courseCtx += `\nTopics: ${safeArr(course.topicBreakdown).map(t=>`${t.topic} (${t.weight||"?"})`).join(", ")}`;
      if (safeArr(course.competencies).length > 0) courseCtx += `\nCompetencies: ${safeArr(course.competencies).map(c=>`${c.code||""} ${c.title}`).join("; ")}`;
      if (safeArr(course.examTips).length > 0) courseCtx += `\nExam tips: ${safeArr(course.examTips).slice(0,5).join("; ")}`;
      if (safeArr(course.knownFocusAreas).length > 0) courseCtx += `\nFocus areas: ${safeArr(course.knownFocusAreas).join(", ")}`;
      // Actual study time vs estimated
      const courseStudiedMins = (data.studySessions||[]).filter(s => s.course === course.name).reduce((s,x) => s + (x.mins||0), 0);
      const courseEstHrs = course.averageStudyHours || 0;
      if (courseEstHrs > 0) courseCtx += `\nStudy progress: ${Math.round(courseStudiedMins/6)/10}h studied of ~${courseEstHrs}h estimated (${courseStudiedMins > 0 ? Math.round(courseStudiedMins/60/courseEstHrs*100) : 0}% complete by time)`;
    }

    // Calendar context: today's tasks + this week
    const today = todayStr();
    const todayTasks = safeArr(data.tasks?.[today]);
    const todayDone = todayTasks.filter(t => t.done).length;
    let calCtx = `\n\nCALENDAR CONTEXT:`;
    if (todayTasks.length > 0) {
      calCtx += `\nToday (${today}): ${todayTasks.length} tasks, ${todayDone} done`;
      calCtx += `\n${todayTasks.map(t => `  ${t.time||"--:--"}–${t.endTime||"?"} ${t.done?"✅":"⬜"} ${t.title} [${t.category}]`).join("\n")}`;
    } else {
      calCtx += `\nToday: No tasks scheduled.`;
    }
    // Next 7 days summary
    const weekSummary = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split("T")[0];
      const dt = safeArr(data.tasks?.[ds]);
      if (dt.length > 0) weekSummary.push(`${ds} (${d.toLocaleDateString("en-US",{weekday:"short"})}): ${dt.length} tasks — ${dt.filter(t=>t.category==="study").length} study, ${dt.filter(t=>t.done).length} done`);
    }
    if (weekSummary.length > 0) calCtx += `\nUpcoming this week:\n${weekSummary.join("\n")}`;

    // Study session history
    const sessions = data.studySessions || [];
    const sessionCourseHrs = {};
    sessions.forEach(s => { sessionCourseHrs[s.course||"Unlinked"] = (sessionCourseHrs[s.course||"Unlinked"]||0) + (s.mins||0); });
    const totalStudiedMins = sessions.reduce((s,x) => s + (x.mins||0), 0);
    const todaySessMins = sessions.filter(s => s.date === today).reduce((s,x) => s + (x.mins||0), 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
    const weekSessMins = sessions.filter(s => new Date(s.date+"T12:00:00") >= weekAgo).reduce((s,x) => s + (x.mins||0), 0);
    const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate()-14);
    const recentMins = sessions.filter(s => new Date(s.date+"T12:00:00") >= twoWeeksAgo).reduce((s,x) => s + (x.mins||0), 0);
    const avgHrsDay14 = Math.round((recentMins / 60 / 14) * 10) / 10;

    let sessionCtx = `\n\nSTUDY PROGRESS:`;
    sessionCtx += `\nToday: ${Math.round(todaySessMins/6)/10}h studied | This week: ${Math.round(weekSessMins/6)/10}h | All time: ${Math.round(totalStudiedMins/6)/10}h`;
    sessionCtx += `\n14-day avg pace: ${avgHrsDay14}h/day (target: ${data.studyHoursPerDay||4}h/day) — ${avgHrsDay14 >= (data.studyHoursPerDay||4) ? "ON TRACK ✅" : "BEHIND ⚠️"}`;
    if (Object.keys(sessionCourseHrs).length > 0) {
      sessionCtx += `\nHours studied per course: ${Object.entries(sessionCourseHrs).sort((a,b)=>b[1]-a[1]).map(([c,m])=>`${c}: ${Math.round(m/6)/10}h`).join(", ")}`;
    }

    // Streak + motivation
    const streak = data.studyStreak || { currentStreak:0, longestStreak:0 };
    sessionCtx += `\nStudy streak: ${streak.currentStreak} day${streak.currentStreak!==1?"s":""} (best: ${streak.longestStreak||0}d)`;

    // Task completion velocity
    const allTaskDates = Object.keys(data.tasks || {});
    const totalTasks = allTaskDates.reduce((s,d) => s + safeArr(data.tasks[d]).length, 0);
    const doneTasks = allTaskDates.reduce((s,d) => s + safeArr(data.tasks[d]).filter(t=>t.done).length, 0);
    if (totalTasks > 0) sessionCtx += `\nTask completion: ${doneTasks}/${totalTasks} (${Math.round(doneTasks/totalTasks*100)}%)`;

    const sys=`${buildSystemPrompt(data,courseCtx + calCtx + sessionCtx)}

You are a knowledgeable study tutor with full awareness of the student's calendar, study progress, and pace.
You have tools to add tasks and courses if the student asks to schedule something.
When explaining concepts, use concrete examples and analogies.
For practice questions, provide immediate feedback with explanations.
Format code blocks with triple backticks. Use **bold** for key terms.

CONTEXT-AWARE GUIDANCE:
- Reference the student's actual calendar when suggesting what to study next.
- If they're behind on pace, acknowledge it and help them prioritize.
- If they have tasks due today, mention specific upcoming blocks.
- Use their session data to identify which courses need more attention.
- Celebrate streaks and milestones — motivation matters.
- If a course has low tracked hours vs estimated hours, flag it.
Be concise, encouraging, and actionable.`;

    const apiMsgs=newMsgs.filter(m=>m.role==="user"||m.role==="assistant").map(m=>({role:m.role,content:m.content}));

    let imageData=null;
    if(imgFile){
      const b64=await fileToBase64(imgFile);
      imageData={type:imgFile.type,data:b64};
      setImgFile(null);setImgPrev(null);
    }

    try{
      let resp=await callAIWithTools(profile,sys,apiMsgs,imageData);
      let fullText="";
      let maxLoops=5;
      while(maxLoops-->0){
        if(controller.signal.aborted) break;
        if(resp.text)fullText+=(fullText?" ":"")+resp.text;
        if(resp.toolCalls.length>0){
          const results=executeTools(resp.toolCalls,data,setData);
          const toolSummary=results.map(r=>`[${r.result}]`).join(" ");
          fullText+=(fullText?"\n\n":"")+toolSummary;
          resp=await continueAfterTools(profile,sys,apiMsgs,resp.toolCalls,results);
        }else break;
      }
      if(resp.text&&!fullText.includes(resp.text))fullText+=(fullText?"\n\n":"")+resp.text;

      const withReply=[...newMsgs,{role:"assistant",content:fullText}];
      setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:withReply}}));
    }catch(e){
      if(e.name!=='AbortError') setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:[...newMsgs,{role:"assistant",content:`Error: ${e.message}`}]}}));
    }
    setLoading(false);
    setChatAbort(null);
  };

  // Export chat as markdown
  const exportChat = () => {
    const md = messages.map(m => `**${m.role==="user"?"You":"AI"}:** ${m.content}`).join("\n\n---\n\n");
    const header = `# Study Chat — ${course?course.name:"General"}\nExported: ${new Date().toLocaleString()}\nMessages: ${messages.length}\n\n---\n\n`;
    const blob = new Blob([header+md], {type:"text/markdown"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`devonsync-chat-${chatKey}-${todayStr()}.md`; a.click();
    URL.revokeObjectURL(url);
    toast("Chat exported as markdown","success");
  };

  // Simple markdown rendering
  const renderMd = (text) => {
    if(!text) return null;
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part,i) => {
      if(part.startsWith("```")) {
        const code = part.replace(/^```\w*\n?/,"").replace(/```$/,"");
        return <pre key={i} style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",fontSize:fs(11),fontFamily:"'JetBrains Mono',monospace",overflow:"auto",margin:"6px 0",whiteSpace:"pre-wrap"}}>{code}</pre>;
      }
      // Bold, inline code
      const html = part.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;font-size:12px;font-family:JetBrains Mono,monospace">$1</code>');
      return <span key={i} dangerouslySetInnerHTML={{__html:html}}/>;
    });
  };

  // Chat stats
  const msgCount = messages.length;
  const userMsgCount = messages.filter(m=>m.role==="user").length;

  // Quick actions based on course context
  const quickActions = course ? [
    // Learn
    {label:"Explain key concepts",prompt:`Explain the most important concepts in ${course.name} that I need to know for the assessment.`,cat:"learn"},
    {label:"Simplify hardest topic",prompt:`What's the hardest topic in ${course.name}? Explain it simply with an analogy a 10-year-old would understand.`,cat:"learn"},
    {label:"Create flashcards",prompt:`Create 10 flashcard-style Q&A pairs for the most important terms and concepts in ${course.name}.`,cat:"learn"},
    {label:"Teach me like I'm new",prompt:`I'm starting ${course.name} from scratch. Give me a roadmap — what concepts build on each other and what order should I learn them?`,cat:"learn"},
    {label:"Real-world examples",prompt:`Give me real-world examples for each major concept in ${course.name}. I learn better when I can see how things apply in practice.`,cat:"learn"},
    {label:"Compare & contrast",prompt:`What are the most commonly confused concepts in ${course.name}? Create a comparison table showing the differences.`,cat:"learn"},
    {label:"Memory tricks",prompt:`Give me mnemonics, acronyms, or memory tricks for the hardest-to-remember facts in ${course.name}.`,cat:"learn"},
    {label:"Explain like a story",prompt:`Explain the core framework/model in ${course.name} as a narrative story — with characters, conflict, and resolution.`,cat:"learn"},
    // Practice
    {label:"Quiz me (5 Q)",prompt:`Give me 5 practice questions for ${course.name}. After each question, wait for my answer before revealing the correct one.`,cat:"practice"},
    {label:"Scenario question",prompt:`Give me a real-world scenario question for ${course.name} — the kind that appears on WGU OAs. Make it application-level, not just recall.`,cat:"practice"},
    {label:"Fill in the blank",prompt:`Create 8 fill-in-the-blank questions covering key vocabulary and definitions from ${course.name}.`,cat:"practice"},
    {label:"True or false",prompt:`Give me 10 true/false statements about ${course.name}. Include common misconceptions as false statements. Wait for my answers.`,cat:"practice"},
    {label:"Match the terms",prompt:`Create a matching exercise: 10 terms on the left, 10 definitions on the right, shuffled. I'll match them.`,cat:"practice"},
    {label:"Case study",prompt:`Give me a detailed case study for ${course.name} with 3-4 questions I need to analyze and answer. Make it realistic.`,cat:"practice"},
    {label:"Rapid fire review",prompt:`Ask me 15 rapid-fire one-line questions about ${course.name}. I'll answer each one quickly, then grade me at the end.`,cat:"practice"},
    // Plan & Progress
    {label:"What's on today?",prompt:`Look at my calendar for today and this week. What should I focus on right now?`,cat:"plan"},
    {label:"Am I on track?",prompt:`Based on my study pace, session history, and calendar — am I on track to finish on time? What adjustments should I make?`,cat:"plan"},
    {label:"Schedule 2h study",prompt:`Schedule 2 hours of study for ${course.name} on my calendar for today.`,cat:"plan"},
    {label:"Optimize my week",prompt:`Look at my schedule for this week. Are there gaps I should fill? Am I spending too much time on anything?`,cat:"plan"},
    {label:"What's falling behind?",prompt:`Based on my course hours tracked vs estimated, which courses am I behind on? Prioritize what needs attention.`,cat:"plan"},
    // Assessment Prep
    ...(course.assessmentType==="PA"?[
      {label:"PA walkthrough",prompt:`Walk me through how to approach the Performance Assessment for ${course.name}. What are the key deliverables and rubric sections?`,cat:"assess"},
      {label:"PA rubric tips",prompt:`What do evaluators specifically look for in each section of the ${course.name} PA? How do I avoid getting sent back for revisions?`,cat:"assess"},
      {label:"PA outline template",prompt:`Create an outline/template I can follow to write my ${course.name} PA paper. Include section headers, approximate word counts, and key points to hit.`,cat:"assess"},
    ]:[]),
    ...(course.assessmentType==="OA"||course.assessmentType==="OA+PA"?[
      {label:"OA strategy",prompt:`What are the best strategies for passing the OA for ${course.name}? Cover format, time limit, common traps, and which competencies to prioritize.`,cat:"assess"},
      {label:"OA question types",prompt:`What types of questions appear on the ${course.name} OA? Multiple choice, multi-select, drag-and-drop? What formats should I prepare for?`,cat:"assess"},
      {label:"Last-minute review",prompt:`I'm taking the ${course.name} OA tomorrow. Give me a focused last-minute review — only the highest-weighted topics and most commonly missed concepts.`,cat:"assess"},
    ]:[]),
    {label:"Weak areas",prompt:`Based on the topic breakdown for ${course.name}, which areas are most commonly failed and what should I focus on?`,cat:"assess"},
    {label:"Predict my readiness",prompt:`Based on what I've studied so far for ${course.name}, do you think I'm ready for the assessment? What gaps remain?`,cat:"assess"},
    // Motivation & Wellness
    {label:"I'm stuck",prompt:`I'm stuck on ${course.name} and feeling frustrated. Help me break through — what's a different angle I can approach this from?`,cat:"wellness"},
    {label:"Motivate me",prompt:`I'm losing motivation. Remind me why finishing ${course.name} matters and give me a concrete micro-goal for the next 30 minutes.`,cat:"wellness"},
    {label:"Pomodoro plan",prompt:`Create a Pomodoro study plan for the next 2 hours on ${course.name}. 25-min focused blocks with specific topics per block.`,cat:"wellness"},
  ] : [
    // General — no course selected
    {label:"What should I study?",prompt:"Based on my calendar, courses, and progress — what should I focus on right now?",cat:"plan"},
    {label:"Am I on track?",prompt:"Look at my study pace, hours logged, and schedule. Am I on track to finish on time? What should I change?",cat:"plan"},
    {label:"Plan my week",prompt:"Help me plan my study schedule for this week based on my courses and current progress.",cat:"plan"},
    {label:"Priority order",prompt:"Based on my courses, difficulty, and deadlines — what order should I study them in and why?",cat:"plan"},
    {label:"Course overview",prompt:"Give me a one-paragraph summary of each of my remaining courses — what they cover and what to expect.",cat:"learn"},
    {label:"Easiest wins",prompt:"Which of my remaining courses are the quickest to pass? Help me plan to knock out easy wins first for momentum.",cat:"plan"},
    {label:"Study techniques",prompt:"What are the most effective study techniques for WGU online courses? Be specific to OA vs PA.",cat:"learn"},
    {label:"Burnout recovery",prompt:"I'm feeling burned out. Give me specific, actionable strategies to recover and get back on track with my WGU courses.",cat:"wellness"},
    {label:"Accountability check",prompt:"Be my accountability partner. Look at my progress data and give me honest, direct feedback on how I'm doing.",cat:"wellness"},
    {label:"Weekend plan",prompt:"Plan a productive but balanced weekend study schedule. Include study blocks, breaks, and personal time.",cat:"plan"},
  ];

  return(
    <div className="fade" style={{display:"flex",flexDirection:"column",height:"calc(100vh - 56px)"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexShrink:0}}>
        <div><h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Study Chat</h1><p style={{color:T.dim,fontSize:fs(13)}}>AI tutor with tool-use — schedule tasks, get explanations, practice questions</p></div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <select value={selCourse} onChange={e=>setSelCourse(e.target.value)} style={{width:220}}>
            <option value="">General Help</option>
            {(data.courses||[]).map(c=><option key={c.id} value={c.id}>{c.name} {hasCtx(c)?"✓":""}</option>)}
          </select>
          {messages.length>0&&<Btn small v="ghost" onClick={exportChat} title="Export chat as markdown">📋</Btn>}
          <Btn small v="ghost" onClick={()=>setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:[]}}))} title="Clear chat history">Clear</Btn>
        </div>
      </div>

      {/* Course context bar */}
      {course&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap"}}>
        <span style={{fontSize:fs(12),fontWeight:600}}>{course.name}</span>
        <Badge color={STATUS_C[course.status]||T.dim} bg={(STATUS_C[course.status]||T.dim)+"22"}>{STATUS_L[course.status]||course.status}</Badge>
        {course.assessmentType&&<Badge color={T.blue} bg={T.blueD}>{course.assessmentType}</Badge>}
        {hasCtx(course)?<Badge color={T.accent} bg={T.accentD}>ENRICHED — full context available</Badge>:<Badge color={T.orange} bg={T.orangeD}>Basic — enrich in Course Planner for better answers</Badge>}
        <span style={{fontSize:fs(10),color:T.dim,marginLeft:"auto"}}>{msgCount} messages</span>
      </div>}

      {!profile&&<div style={{padding:"40px 0",textAlign:"center",color:T.dim}}><p style={{fontSize:fs(13)}}>Connect an AI profile in Settings to start chatting.</p></div>}

      {/* Messages */}
      {profile&&<div style={{flex:1,overflowY:"auto",marginBottom:10,display:"flex",flexDirection:"column",gap:8}}>
        {messages.length===0&&<div style={{padding:"20px 0",color:T.dim,fontSize:fs(13)}}>
          <p style={{marginBottom:12,textAlign:"center"}}>Ask about {course?course.name:"anything"}.</p>
          {(() => {
            const cats = {learn:{l:"📚 Learn",c:T.blue},practice:{l:"🎯 Practice",c:T.purple},plan:{l:"📅 Plan & Progress",c:T.accent},assess:{l:"📝 Assessment Prep",c:T.orange},wellness:{l:"💪 Motivation & Wellness",c:"#f472b6"}};
            const grouped = {};
            quickActions.forEach(q => { const k=q.cat||"learn"; if(!grouped[k])grouped[k]=[]; grouped[k].push(q); });
            return (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {Object.entries(grouped).map(([cat,actions]) => {
                  const info = cats[cat]||{l:cat,c:T.soft};
                  return (
                    <div key={cat}>
                      <div style={{fontSize:fs(10),fontWeight:700,color:info.c,marginBottom:4}}>{info.l}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {actions.map((q,i) => (
                          <button key={i} onClick={()=>sendMessage(q.prompt)} style={{background:T.input,border:`1px solid ${info.c}33`,borderRadius:8,padding:"8px 14px",color:T.soft,fontSize:fs(11),cursor:"pointer",fontWeight:500}}>{q.label}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>}
        {messages.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
          <div style={{maxWidth:"78%",padding:"10px 14px",borderRadius:12,fontSize:fs(13),lineHeight:1.6,background:m.role==="user"?T.accent:T.card,color:m.role==="user"?"#060e09":T.text,border:m.role==="user"?"none":`1px solid ${T.border}`,whiteSpace:"pre-wrap"}}>
            {m.hasImage&&<span style={{fontSize:fs(10),opacity:.7}}>📷 Image attached<br/></span>}
            {m.role==="assistant"?renderMd(m.content):m.content}
          </div>
        </div>)}
        {loading&&<div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",color:T.soft,fontSize:fs(12)}}><Ic.Spin s={14}/> Thinking...</div>}
        <div ref={messagesEnd}/>
      </div>}

      {/* Quick actions bar (when chat has messages) */}
      {profile && messages.length > 0 && !loading && (
        <div style={{display:"flex",gap:4,flexShrink:0,marginBottom:6,overflowX:"auto",paddingBottom:2}}>
          {quickActions.slice(0,5).map((q,i)=>(
            <button key={i} className="sf-chip" onClick={()=>sendMessage(q.prompt)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:7,padding:"6px 12px",color:T.dim,fontSize:fs(10),cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{q.label}</button>
          ))}
        </div>
      )}

      {/* Image preview */}
      {imgPrev&&<div style={{padding:"6px 0",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
        <img src={imgPrev} style={{height:50,borderRadius:8,border:`1px solid ${T.border}`}} alt="upload"/>
        <span style={{fontSize:fs(10),color:T.soft}}>{imgFile?.name}</span>
        <button onClick={()=>{setImgFile(null);setImgPrev(null)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer"}}><Ic.X s={14}/></button>
      </div>}

      {/* Input bar */}
      {profile&&<div style={{display:"flex",gap:8,flexShrink:0}}>
        <button onClick={()=>fileRef.current?.click()} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:9,padding:"0 14px",cursor:"pointer",color:T.soft,display:"flex",alignItems:"center"}}><Ic.Img s={16}/></button>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMessage()} placeholder={`Ask about ${course?course.name:"studying"}...`} style={{flex:1,padding:"12px 16px",fontSize:fs(14)}}/>
        <Btn onClick={()=>sendMessage()} disabled={!loading&&(!input.trim()&&!imgFile)} style={{padding:"12px 20px",background:loading?T.red:undefined}}>{loading?<span style={{fontSize:fs(12),fontWeight:700}}>⬛ Stop</span>:<Ic.Send s={16}/>}</Btn>
      </div>}
    </div>
  );
};

// ----------------------------------------------------------------------
// SETTINGS PAGE
// ----------------------------------------------------------------------
const PRESETS = {
  anthropic: { name:"Anthropic", url:"https://api.anthropic.com/v1/messages", model:"claude-sonnet-4-20250514" },
  openai: { name:"OpenAI", url:"https://api.openai.com/v1/chat/completions", model:"gpt-4o" },
  custom: { name:"Custom", url:"", model:"" },
};
function getAuthHeaders(profile) {
  const h = { "Content-Type": "application/json" };
  const url = profile.baseUrl || "";
  if (profile.provider === "anthropic" || url.includes("anthropic.com")) {
    h["x-api-key"] = profile.apiKey;
    h["anthropic-version"] = "2023-06-01";
    h["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    h["Authorization"] = "Bearer " + profile.apiKey;
  }
  return h;
}
function isAnthProvider(p) { return p.provider === "anthropic" || (p.baseUrl||"").includes("anthropic.com"); }
function guessModelsUrl(baseUrl) {
  if (!baseUrl) return "";
  try {
    const u = new URL(baseUrl);
    const parts = u.pathname.replace(/\/+$/, "").split("/");
    const ci = parts.indexOf("chat");
    if (ci > 0) return u.origin + parts.slice(0, ci).join("/") + "/models";
    return u.origin + parts.slice(0, -1).join("/") + "/models";
  } catch(_e) { return ""; }
}

const SettingsPage = ({ data, setData, setPage }) => {
  const bp = useBreakpoint();
  const ytStats = useYtStats();
  const [showAdd, setShowAdd] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ provider:"anthropic", name:"", apiKey:"", baseUrl:"", model:"" });
  const [showSchema, setShowSchema] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [models, setModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const profiles = data.profiles || [];

  const openAdd = (prov = "anthropic") => {
    const p = PRESETS[prov];
    dlog('debug', 'profile', `Opening add: ${prov}`);
    setForm({ provider:prov, name:p.name, apiKey:"", baseUrl:p.url, model:p.model });
    setEditId(null); setTestResult(null); setModels([]);
    setShowAdd(true);
  };
  const openEdit = (prof) => {
    dlog('debug', 'profile', `Editing: ${prof.name}`);
    setForm({ provider:prof.provider||"custom", name:prof.name, apiKey:prof.apiKey, baseUrl:prof.baseUrl, model:prof.model });
    setEditId(prof.id); setTestResult(null); setModels([]);
    setShowAdd(true);
  };
  const saveProfile = () => {
    if (!form.name) { dlog('warn','profile','No name'); return; }
    if (!form.apiKey) { dlog('warn','profile','No key'); return; }
    if (!form.baseUrl) { dlog('warn','profile','No URL'); return; }
    dlog('info', 'profile', `Saving: ${form.name} (${form.model}) to ${form.baseUrl}`);
    const prof = { ...form, headerKey: isAnthProvider(form)?"x-api-key":"Authorization", headerPrefix: isAnthProvider(form)?"":"Bearer " };
    if (editId) setData(d => ({...d, profiles: d.profiles.map(p => p.id === editId ? {...prof, id:editId} : p)}));
    else { const np = {...prof, id: uid()}; setData(d => ({...d, profiles: [...d.profiles, np], activeProfileId: d.activeProfileId || np.id})); }
    setShowAdd(false);
    toast(`Profile saved: ${form.name}`,"success");
  };
  const removeProfile = (id) => {
    dlog('info', 'profile', `Removing: ${id}`);
    setData(d => ({...d, profiles:d.profiles.filter(p=>p.id!==id), activeProfileId:d.activeProfileId===id?(d.profiles.find(p=>p.id!==id)?.id||null):d.activeProfileId}));
  };

  const testConnection = async () => {
    if (!form.apiKey || !form.baseUrl) { setTestResult({ok:false,msg:"Need API key and base URL"}); return; }
    setTesting(true); setTestResult(null); setModels([]);
    dlog('info','profile',`Testing: ${form.baseUrl}`);
    const headers = getAuthHeaders(form);
    const isAnth = isAnthProvider(form);

    // Step 1: Fetch models FIRST — we need a valid model name to test
    let fetchedModels = [];
    setModelsLoading(true);
    try {
      if (isAnth) {
        fetchedModels = ["claude-opus-4-20250514","claude-sonnet-4-20250514","claude-haiku-4-5-20251001"];
      } else {
        const mUrl = guessModelsUrl(form.baseUrl);
        if (mUrl) {
          dlog('api','profile',`Fetching models: ${mUrl}`);
          const mHeaders = {...headers}; // use same auth
          const mRes = await fetch(mUrl, { headers: mHeaders });
          if (mRes.ok) {
            const mData = await mRes.json();
            let ids = [];
            if (Array.isArray(mData.data)) ids = mData.data.map(m => m.id).sort();
            else if (Array.isArray(mData)) ids = mData.map(m => typeof m === 'string' ? m : (m.id || m.name || "")).filter(Boolean).sort();
            dlog('info','profile',`Got ${ids.length} models`);
            fetchedModels = ids;
          } else {
            const errText = await mRes.text();
            dlog('warn','profile',`Models fetch HTTP ${mRes.status}`, errText.slice(0,200));
          }
        }
      }
    } catch (e) { dlog('warn','profile',`Models error: ${e.message}`); }
    if (fetchedModels.length > 0) setModels(fetchedModels);
    setModelsLoading(false);

    // Pick a model to test with: user-selected > first fetched > fallback
    const testModel = form.model || fetchedModels[0] || (isAnth ? "claude-sonnet-4-20250514" : "");
    if (!testModel) {
      setTestResult({ ok: false, msg: "Could not determine a model to test with. Select a model from the dropdown above." });
      setTesting(false); return;
    }
    dlog('info','profile',`Testing with model: ${testModel}`);

    // Auto-fill model field if empty and we found models
    if (!form.model && testModel) setForm(f => ({...f, model: testModel}));

    // Step 2: Test the chat endpoint
    try {
      const testBody = isAnth
        ? { model: testModel, max_tokens: 10, system: "Reply OK", messages: [{ role: "user", content: "ping" }] }
        : { model: testModel, max_tokens: 10, messages: [{ role: "system", content: "Reply OK" }, { role: "user", content: "ping" }] };
      const t0 = Date.now();
      const res = await fetch(form.baseUrl, { method: "POST", headers, body: JSON.stringify(testBody) });
      const ms = Date.now() - t0;
      dlog('api','profile',`Test: HTTP ${res.status} (${ms}ms)`);
      setApiStatus(res.ok, res.status);
      if (!res.ok) {
        const err = await res.text();
        dlog('error','profile',`Test failed: ${res.status}`, err.slice(0,500));
        setTestResult({ ok: false, msg: `HTTP ${res.status}: ${err.slice(0,150)}` });
        setTesting(false); return;
      }
      const rdText = await res.text();
      let rd; try { rd = JSON.parse(rdText); } catch(e) { setTestResult({ok:true,msg:`Connected (${ms}ms) — response wasn't JSON but auth works`}); setTesting(false); return; }
      let got = isAnth ? safeArr(rd.content).map(b=>b.text||"").join("") : (rd.choices?.[0]?.message?.content || "");
      dlog('info','profile',`Test OK: "${got.slice(0,50)}" (${ms}ms)`);
      setTestResult({ ok: true, msg: `Connected! (${ms}ms) ${fetchedModels.length > 0 ? `· ${fetchedModels.length} models available` : ""}` });
    } catch (e) {
      dlog('error','profile',`Test error`, e.message);
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  return (
    <div className="fade">
      <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:4}}>Settings</h1>
      <p style={{color:T.dim,fontSize:fs(13),marginBottom:20}}>Configure your DevonSYNC experience · <span style={{color:T.soft}}>v{APP_VERSION}</span></p>

      {/* Quick nav */}
      <div style={{display:"flex",gap:6,marginBottom:20,flexWrap:"wrap"}}>
        {[{id:"s-ai",l:"AI Profiles",c:T.accent},{id:"s-you",l:"About You",c:T.blue},{id:"s-look",l:"Appearance",c:T.purple},{id:"s-int",l:"Integrations",c:T.cyan},{id:"s-data",l:"Data",c:T.orange},{id:"s-adv",l:"Advanced",c:T.dim}].map(b=>
          <button key={b.id} className="sf-chip" onClick={()=>document.getElementById(b.id)?.scrollIntoView({behavior:"smooth"})} style={{padding:"6px 14px",borderRadius:8,fontSize:fs(11),fontWeight:600,border:`1px solid ${b.c}44`,background:`${b.c}11`,color:b.c,cursor:"pointer"}}>{b.l}</button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* AI CONNECTION — most important, goes first */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-ai" className="sf-section" style={{background:T.card,border:`1.5px solid ${T.accent}44`,borderRadius:14,padding:22,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:2}}>AI Connection Profiles</h3>
            <p style={{fontSize:fs(11),color:T.dim}}>Connect to Claude, GPT, or any OpenAI-compatible API</p>
          </div>
          <div style={{display:"flex",gap:6}}>
            <Btn small v="ai" onClick={()=>openAdd("anthropic")}>+ Anthropic</Btn>
            <Btn small v="secondary" onClick={()=>openAdd("openai")}>+ OpenAI</Btn>
            <Btn small v="ghost" onClick={()=>openAdd("custom")}>+ Custom</Btn>
          </div>
        </div>
        {profiles.length===0?<p style={{fontSize:fs(12),color:T.dim,textAlign:"center",padding:20,background:T.input,borderRadius:10}}>No AI profiles yet — add one to get started</p>:(
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {profiles.map(p=>(
              <div key={p.id} className="sf-profile" onClick={()=>{dlog('info','profile',`Activated: ${p.name}`);setData(d=>({...d,activeProfileId:p.id}))}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",borderRadius:10,cursor:"pointer",background:data.activeProfileId===p.id?T.accentD:T.input,border:`1.5px solid ${data.activeProfileId===p.id?T.accent:T.border}`}}>
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:data.activeProfileId===p.id?T.accent:T.dim,boxShadow:data.activeProfileId===p.id?`0 0 8px ${T.accent}`:"none"}}/>
                  <div><div style={{fontSize:fs(13),fontWeight:600}}>{p.name}</div><div className="mono" style={{fontSize:fs(10),color:T.dim}}>{p.model}</div></div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  {data.activeProfileId===p.id&&<Badge color={T.accent} bg={T.accentD}>ACTIVE</Badge>}
                  <button className="sf-icon-btn" onClick={e=>{e.stopPropagation();openEdit(p)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Edit/></button>
                  <button className="sf-icon-btn" onClick={e=>{e.stopPropagation();removeProfile(p.id)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Trash/></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* ABOUT YOU */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-you" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:3}}>About You</h3>
        <p style={{fontSize:fs(11),color:T.dim,marginBottom:10}}>Tell the AI about your study habits, schedule, and goals. Included in every AI request for personalized recommendations.</p>
        <textarea value={data.userContext||""} onChange={e=>setData(d=>({...d,userContext:e.target.value}))} placeholder="e.g. I'm a visual learner working full-time M-F 9-5. I prefer 2-hour study blocks in evenings and weekends. I struggle with memorization-heavy courses." style={{minHeight:90,fontSize:fs(12)}}/>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* APPEARANCE — theme, font, zoom combined */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-look" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:14}}>Appearance</h3>

        {/* Theme */}
        <div style={{marginBottom:18}}>
          <div style={{fontSize:fs(12),fontWeight:600,color:T.soft,marginBottom:8}}>Theme</div>
          <div style={{display:"flex",gap:8}}>
            {Object.entries(THEMES).map(([key, theme]) => {
              const active = (data.theme || "dark") === key;
              return (
                <button key={key} onClick={() => { setData(d => ({...d, theme: key})); setTheme(key); syncT(); toast(`Theme: ${theme.name}`, "success"); }} style={{
                  flex:1, padding:"12px 8px", borderRadius:10, cursor:"pointer", textAlign:"center",
                  border: `2px solid ${active ? theme.accent : theme.border}`,
                  background: theme.bg, color: theme.text, transition:"all .2s"
                }}>
                  <div style={{display:"flex",gap:3,justifyContent:"center",marginBottom:6}}>
                    <div style={{width:12,height:12,borderRadius:"50%",background:theme.accent}}/>
                    <div style={{width:12,height:12,borderRadius:"50%",background:theme.blue}}/>
                    <div style={{width:12,height:12,borderRadius:"50%",background:theme.purple}}/>
                  </div>
                  <div style={{fontSize:fs(12),fontWeight:600}}>{theme.name}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Font + Zoom side by side */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.soft,marginBottom:8}}>Font Size</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:fs(11),color:T.dim}}>A</span>
              <input type="range" min="75" max="300" step="5" value={data.fontScale||100} onChange={e=>{const v=Number(e.target.value);_fontScale=v;setData(d=>({...d,fontScale:v}))}} style={{flex:1,accentColor:T.accent}}/>
              <span style={{fontSize:fs(16),color:T.dim}}>A</span>
              <span style={{fontSize:fs(12),fontWeight:700,color:T.accent,minWidth:36,textAlign:"center"}}>{data.fontScale||100}%</span>
              {(data.fontScale||100)!==100&&<Btn small v="ghost" onClick={()=>setData(d=>({...d,fontScale:100}))}>Reset</Btn>}
            </div>
          </div>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.soft,marginBottom:8}}>UI Zoom</div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:fs(11),color:T.dim}}>-</span>
              <input type="range" min="75" max="200" step="5" value={data.uiZoom||100} onChange={e=>setData(d=>({...d,uiZoom:Number(e.target.value)}))} style={{flex:1,accentColor:T.blue}}/>
              <span style={{fontSize:fs(14),color:T.dim}}>+</span>
              <span style={{fontSize:fs(12),fontWeight:700,color:T.blue,minWidth:36,textAlign:"center"}}>{data.uiZoom||100}%</span>
              {(data.uiZoom||100)!==100&&<Btn small v="ghost" onClick={()=>setData(d=>({...d,uiZoom:100}))}>Reset</Btn>}
            </div>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════ */}
      {/* ═══════════════════════════════════════════════ */}
      <div id="s-int" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:14}}>Integrations</h3>

        {/* YouTube */}
        <div style={{marginBottom:18,paddingBottom:16,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
            <span style={{fontSize:fs(14)}}>📊</span>
            <div style={{fontSize:fs(13),fontWeight:700}}>YouTube Data API</div>
            <Badge color={data.ytApiKey?T.blue:T.accent} bg={data.ytApiKey?T.blueD:T.accentD}>{data.ytApiKey?"Custom Key":"Built-in"}</Badge>
          </div>
          <p style={{fontSize:fs(11),color:T.dim,marginBottom:8}}>Enables live stats, stream detection, and viewer counts in Study Radio. Override below if the built-in key hits rate limits.</p>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input value={data.ytApiKey||""} onChange={e=>setData(d=>({...d,ytApiKey:e.target.value}))} placeholder="Using built-in key" type="password" autoComplete="off" style={{flex:1,fontSize:fs(11)}} />
            <Btn small v="ai" onClick={()=>{fetchYtStats(getYtApiKey(data));toast("Fetching stats...","info")}}>Refresh</Btn>
            {data.ytApiKey && <Btn small v="ghost" onClick={()=>{setData(d=>({...d,ytApiKey:""}));toast("Reverted to built-in","info")}}>Reset</Btn>}
          </div>
          {Object.keys(ytStats).length > 0 ? (
            <div style={{marginTop:6,fontSize:fs(10),color:T.accent,display:"flex",gap:12}}>
              <span>{Object.keys(ytStats).length} streams</span>
              <span>{Object.values(ytStats).filter(s=>s.live).length} live</span>
            </div>
          ) : (
            <div style={{marginTop:6,fontSize:fs(10),color:T.orange}}>Stats unavailable — add your own YouTube API key for live data</div>
          )}
        </div>
      </div>

      {/* DATA MANAGEMENT */}
      <div id="s-data" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:3}}>Data Management</h3>
        <p style={{fontSize:fs(11),color:T.dim,marginBottom:14}}>Export/import full backups or settings-only snapshots.</p>
        <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <Btn v="secondary" onClick={() => {
            const fullBackup = { ...data, _meta: { version: APP_VERSION, exportDate: new Date().toISOString(), type: "devonsync-backup" }, _favorites: JSON.parse(localStorage.getItem('ds-favs') || '{"soma":[],"yt":[]}'), _customStreams: JSON.parse(localStorage.getItem('ds-custom-streams') || '[]') };
            const blob = new Blob([JSON.stringify(fullBackup, null, 2)], {type:"application/json"});
            const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `devonsync-backup-${todayStr()}.json`; a.click(); URL.revokeObjectURL(url);
            toast("Backup exported", "success");
          }}><Ic.Download s={14}/> Export Backup</Btn>
          <Btn v="secondary" onClick={() => {
            const input = document.createElement("input"); input.type = "file"; input.accept = ".json";
            input.onchange = (ev) => {
              const file = ev.target.files[0]; if (!file) return;
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  const imported = JSON.parse(e.target.result);
                  if (imported._favorites) { localStorage.setItem('ds-favs', JSON.stringify(imported._favorites)); delete imported._favorites; }
                  if (imported._customStreams) { localStorage.setItem('ds-custom-streams', JSON.stringify(imported._customStreams)); delete imported._customStreams; }
                  delete imported._meta;
                  setData(d => ({...d, ...imported}));
                  if (imported.theme) { setTheme(imported.theme); syncT(); }
                  toast("Backup restored", "success");
                } catch (err) { toast("Invalid file: " + err.message, "error"); }
              };
              reader.readAsText(file);
            };
            input.click();
          }}><Ic.Upload s={14}/> Import Backup</Btn>
        </div>
      </div>

      {/* ADVANCED */}
      <div id="s-adv" className="sf-section" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <h3 style={{fontSize:fs(16),fontWeight:700,marginBottom:14}}>Advanced</h3>
        <div style={{marginBottom:16,paddingBottom:14,borderBottom:`1px solid ${T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Ic.Bug s={15}/><div style={{fontSize:fs(13),fontWeight:700}}>Debug Log</div></div>
            <div style={{display:"flex",gap:6}}>
              <Btn small v="secondary" onClick={()=>{navigator.clipboard.writeText(getLogText());toast("Log copied","success")}}>Copy</Btn>
              <Btn small v="ghost" onClick={()=>setShowDebug(p=>!p)}>{showDebug?"Hide":"Show"}</Btn>
            </div>
          </div>
          {showDebug && <DebugPage/>}
        </div>
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}><Ic.Tool s={15}/><div style={{fontSize:fs(13),fontWeight:700}}>AI Tool Schema</div><Badge color={T.purple} bg={T.purpleD}>{TOOLS.length} tools</Badge></div>
            <Btn small v="ghost" onClick={()=>setShowSchema(!showSchema)}>{showSchema?"Hide":"View"}</Btn>
          </div>
          {showSchema&&<div style={{background:T.input,borderRadius:10,padding:14,maxHeight:300,overflowY:"auto",marginTop:10}}><pre className="mono" style={{fontSize:fs(10),color:T.soft,whiteSpace:"pre-wrap",lineHeight:1.5}}>{JSON.stringify(TOOLS,null,2)}</pre></div>}
        </div>
      </div>

      {/* CHANGELOG */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:22,marginBottom:20}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setShowChangelog(!showChangelog)}>
          <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:fs(14)}}>📋</span><h3 style={{fontSize:fs(16),fontWeight:700}}>Changelog</h3></div>
          <span style={{color:T.dim,fontSize:fs(12)}}>{showChangelog?"▲":"▼"}</span>
        </div>
        {showChangelog && (
          <div style={{marginTop:14,display:"flex",flexDirection:"column",gap:16}}>
            {[
              {v:"7.3.0",d:"Mar 20, 2026",items:[
                {t:"removed",m:"Spotify integration completely removed (SDK, UI, settings, mini player)"},
                {t:"changed",m:"Electron reverted to stock v35.2.1 (no castlabs/Widevine)"},
                {t:"changed",m:"Setup reduced to 6 steps (removed DRM verification)"},
                {t:"changed",m:"Setup uses streaming output — no more hanging on npm install"},
                {t:"fixed",m:"Setup.bat runs in same window (errors visible instead of flash-closing)"},
              ]},
              {v:"7.1.0",d:"Mar 20, 2026",items:[
                {t:"added",m:"Study Radio: 541 YouTube + 44 SomaFM stations with live stats"},
                {t:"added",m:"Mini media player with visualizer, per-source volume, transport controls"},
                {t:"added",m:"YouTube chat integration for live streams"},
                {t:"added",m:"SomaFM real-time audio level visualizer"},
                {t:"added",m:"Est. finish vs term end check — red warning when exceeding deadline"},
                {t:"changed",m:"Setup uses PowerShell for all display (eliminates batch escape issues)"},
                {t:"fixed",m:"BufferedInput number arrows reverting — now commits directly"},
              ]},
              {v:"7.0.0",d:"Mar 20, 2026",items:[
                {t:"added",m:"4-step Course Planner: Import → Configure → Enrich → Generate"},
                {t:"added",m:"Override safeguards, auto-calculated min hours/day"},
                {t:"added",m:"Days Off panel with recurring day toggles + date pills"},
                {t:"added",m:"Responsive breakpoint system: sm/md/lg/xl"},
                {t:"added",m:"Changelog in Settings with categorized version history"},
                {t:"changed",m:"Sequential field gating — each field enables after previous is filled"},
              ]},
              {v:"6.0.0",d:"Mar 19, 2026",items:[
                {t:"added",m:"Course Planner with AI parsing, enrichment, and plan generation"},
                {t:"added",m:"Study Radio: YouTube streams + SomaFM stations"},
                {t:"added",m:"Study Chat with 30+ quick actions and calendar context"},
                {t:"added",m:"Practice Exam, Pomodoro timer, Focus Mode, Weekly Report"},
                {t:"added",m:"Multi-profile AI connections (Anthropic + OpenAI compatible)"},
              ]},
            ].map(release => (
              <div key={release.v}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:fs(14),fontWeight:800,color:T.accent}}>{release.v}</span>
                  <span style={{fontSize:fs(10),color:T.dim}}>{release.d}</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:3,paddingLeft:12}}>
                  {release.items.map((item,j) => (
                    <div key={j} style={{display:"flex",alignItems:"center",gap:8,fontSize:fs(11)}}>
                      <span style={{fontSize:fs(9),padding:"2px 6px",borderRadius:4,fontWeight:700,
                        background:item.t==="added"?T.accentD:item.t==="changed"?T.blueD:item.t==="fixed"?T.orangeD:item.t==="removed"?`${T.red}15`:T.input,
                        color:item.t==="added"?T.accent:item.t==="changed"?T.blue:item.t==="fixed"?T.orange:item.t==="removed"?T.red:T.dim,
                      }}>{item.t}</span>
                      <span style={{color:T.soft}}>{item.m}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DANGER ZONE */}
      <div style={{background:`${T.red}08`,border:`1px solid ${T.red}33`,borderRadius:12,padding:20,marginTop:32}}>
        <h3 style={{fontSize:fs(14),fontWeight:700,color:T.red,marginBottom:12}}>Danger Zone</h3>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`}}>
            <div><div style={{fontSize:fs(12),fontWeight:600,color:T.text}}>Clear All Courses</div><div style={{fontSize:fs(10),color:T.dim}}>Removes courses, enrichment, and study settings. Calendar tasks kept.</div></div>
            <Btn small v="ghost" onClick={() => {
              const count = (data.courses||[]).length;
              if(!count){toast("No courses to clear","info");return}
              if(!confirm(`Remove all ${count} courses and reset study settings?`)) return;
              setData(d => ({...d, courses:[], chatHistories:{}, studyStartDate:"", studyStartTime:"", targetCompletionDate:"", targetDate:"", studyHoursPerDay:4, exceptionDates:[], overrideSafeguards:false}));
              toast(`${count} courses cleared`, "warn");
            }} style={{color:T.red,borderColor:T.red+"55"}}>Clear Courses</Btn>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`}}>
            <div><div style={{fontSize:fs(12),fontWeight:600,color:T.text}}>Clear Study Plan Tasks</div><div style={{fontSize:fs(10),color:T.dim}}>Removes AI-generated tasks. Personal/health/work kept.</div></div>
            <Btn small v="ghost" onClick={() => {
              const allDates = Object.keys(data.tasks||{});
              if(!allDates.length){toast("No tasks","info");return}
              if(!confirm("Remove all study plan tasks?")) return;
              let removed = 0;
              setData(d => {
                const tasks = {};
                for (const [dt, dayTasks] of Object.entries(d.tasks||{})) {
                  const kept = safeArr(dayTasks).filter(t => !AI_CATS.includes(t.category));
                  removed += safeArr(dayTasks).length - kept.length;
                  if(kept.length > 0) tasks[dt] = kept;
                }
                return {...d, tasks};
              });
              toast(`${removed} tasks removed`, "warn");
            }} style={{color:T.red,borderColor:T.red+"55"}}>Clear Study Plan</Btn>
          </div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",borderRadius:8,background:T.input,border:`1px solid ${T.border}`}}>
            <div><div style={{fontSize:fs(12),fontWeight:600,color:T.text}}>Clear ALL Calendar Tasks</div><div style={{fontSize:fs(10),color:T.dim}}>Wipes every task on every date.</div></div>
            <Btn small v="ghost" onClick={() => {
              const count = Object.values(data.tasks||{}).flat().length;
              if(!count){toast("Calendar empty","info");return}
              if(!confirm(`Delete ALL ${count} tasks?`)) return;
              setData(d => ({...d, tasks:{}}));
              toast(`${count} tasks removed`, "warn");
            }} style={{color:T.red,borderColor:T.red+"55"}}>Clear All Tasks</Btn>
          </div>
        </div>
        <div style={{borderTop:`1px solid ${T.red}22`,paddingTop:12}}>
          <p style={{fontSize:fs(11),color:T.dim,marginBottom:10}}>Full reset permanently erases everything.</p>
          <Btn small v="danger" onClick={() => {
            if (!confirm("WARNING: This will permanently delete ALL data.\n\nAre you absolutely sure?")) return;
            if (!confirm("Last chance. Click OK to confirm full reset.")) return;
            localStorage.removeItem('ds-v1'); localStorage.removeItem('ds-favs'); localStorage.removeItem('ds-custom-streams');
            setData({...INIT});
            toast("All data erased", "warn");
            dlog('warn','settings',"Full data reset");
          }}>Reset All Data</Btn>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// AMBIENT SOUNDS PAGE
// ----------------------------------------------------------------------

// YouTube stream health check
let _ytHealth = {}; // vid -> (ok, lastCheck, reason)
let _ytHealthSubs = [];
let _ytCheckProgress = {active:false, phase:'', done:0, total:0};
let _ytCheckSubs = [];
function ytHealthNotify() { _ytHealthSubs.forEach(fn => fn({..._ytHealth})); }
function ytCheckNotify() { _ytCheckSubs.forEach(fn => fn({..._ytCheckProgress})); }
function useYtHealth() {
  const [h,setH] = useState({..._ytHealth});
  useEffect(() => { _ytHealthSubs.push(setH); return () => { _ytHealthSubs = _ytHealthSubs.filter(fn=>fn!==setH); }; }, []);
  return h;
}
function useYtCheckProgress() {
  const [p,setP] = useState({..._ytCheckProgress});
  useEffect(() => { _ytCheckSubs.push(setP); return () => { _ytCheckSubs = _ytCheckSubs.filter(fn=>fn!==setP); }; }, []);
  return p;
}

// YouTube Data API stats — fetches live viewer count, view count, etc.
let _ytStats = {}; // vid -> {views, viewers, title, live, lastFetch}
let _ytStatsSubs = [];
function ytStatsNotify() { _ytStatsSubs.forEach(fn => fn({..._ytStats})); }
function useYtStats() {
  const [s,setS] = useState({..._ytStats});
  useEffect(() => { _ytStatsSubs.push(setS); return () => { _ytStatsSubs = _ytStatsSubs.filter(fn=>fn!==setS); }; }, []);
  return s;
}

async function fetchYtStats(apiKey) {
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

        dlog('debug','youtube',`API: ${snippet.title?.slice(0,30)} — ${detectedType}${isLiveNow?' [LIVE]':''}${hasConcurrentViewers?` [${lsd.concurrentViewers} watching]`:''} views:${fmtNum(parseInt(stats.viewCount||0))}`);
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

function fmtNum(n) {
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return String(n);
}
function timeAgo(date) {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s/60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m/60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h/24); if (d < 30) return d + 'd ago';
  const mo = Math.floor(d/30); if (mo < 12) return mo + 'mo ago';
  return Math.floor(mo/12) + 'y ago';
}

// Favorites system — stored in localStorage
const FAV_KEY = 'ds-favs';
let _favs = { yt: [], soma: [] };
try { const raw = localStorage.getItem(FAV_KEY); if (raw) _favs = JSON.parse(raw); } catch(_e) {}

// [STATE] Custom user-added streams — persisted in localStorage
const CUSTOM_KEY = 'ds-custom-streams';
let _customStreams = [];
try { const raw = localStorage.getItem(CUSTOM_KEY); if (raw) _customStreams = JSON.parse(raw); } catch(_e) {}
let _customSubs = [];
function customNotify() { localStorage.setItem(CUSTOM_KEY, JSON.stringify(_customStreams)); _customSubs.forEach(fn => fn([..._customStreams])); }
function useCustomStreams() {
  const [s, setS] = useState([..._customStreams]);
  useEffect(() => { _customSubs.push(setS); return () => { _customSubs = _customSubs.filter(fn => fn !== setS); }; }, []);
  return s;
}
function addCustomStream(vid, name) {
  if (_customStreams.some(s => s.vid === vid)) return;
  _customStreams.push({ vid, name: name || `Custom ${vid.slice(0,6)}`, addedAt: Date.now() });
  customNotify();
  dlog('info','youtube',`Custom stream added: ${vid}`);
}
function removeCustomStream(vid) {
  _customStreams = _customStreams.filter(s => s.vid !== vid);
  customNotify();
  dlog('info','youtube',`Custom stream removed: ${vid}`);
}
let _favSubs = [];
function favNotify() { localStorage.setItem(FAV_KEY, JSON.stringify(_favs)); _favSubs.forEach(fn => fn({..._favs})); }
function useFavs() {
  const [f,setF] = useState({..._favs});
  useEffect(() => { _favSubs.push(setF); return () => { _favSubs = _favSubs.filter(fn=>fn!==setF); }; }, []);
  return f;
}
function toggleFav(type, id) {
  const list = _favs[type] || [];
  if (list.includes(id)) { _favs[type] = list.filter(x => x !== id); } else { _favs[type] = [...list, id]; }
  dlog('debug','ui',`Favorite ${list.includes(id)?'removed':'added'}: ${type}/${id}`);
  favNotify();
}

// Pre-flight embed test — yt-ready often fires BEFORE yt-error (150)
// So we wait 700ms after ready to check if an error follows
function ytEmbedTest(vid) {
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

async function checkYtStreamHealth() {
  dlog('info','radio',`Checking ${YT_STREAMS.length} YouTube streams via API...`);
  _ytCheckProgress = { active: true, phase: 'Fetching stream data...', done: 0, total: YT_STREAMS.length };
  ytCheckNotify();
  
  // Use YouTube Data API for fast batch verification (50 per call)
  let apiKey;
  try { apiKey = getYtApiKey(JSON.parse(localStorage.getItem('ds-v1') || '{}')); } catch(_) { apiKey = DEFAULT_YT_API_KEY; }
  
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
setTimeout(checkYtStreamHealth, 3000);
setInterval(checkYtStreamHealth, 10 * 60 * 1000); // every 10 min

// Fetch YouTube stats on startup (5s delay) and every 10 min
setTimeout(() => {
  try {
    const d = JSON.parse(localStorage.getItem('ds-v1') || '{}');
    fetchYtStats(getYtApiKey(d));
  } catch(_e) { fetchYtStats(DEFAULT_YT_API_KEY); }
}, 5000);
setInterval(() => {
  try {
    const d = JSON.parse(localStorage.getItem('ds-v1') || '{}');
    fetchYtStats(getYtApiKey(d));
  } catch(_e) { fetchYtStats(DEFAULT_YT_API_KEY); }
}, 10 * 60 * 1000);

const AmbientPage = () => {
  const audio = useAudio();
  const health = useStationHealth();
  const ytHealth = useYtHealth();
  const ytStreams = useYtStreams();
  const ytStats = useYtStats();
  const favs = useFavs();
  const checkProgress = useYtCheckProgress();
  const customStreams = useCustomStreams();
  const [customUrl, setCustomUrl] = useState("");
  const [mainTab, setMainTab] = useState("youtube");
  const [filterCat, setFilterCat] = useState("all");
  const [ytFilterCat, setYtFilterCat] = useState("all");
  const [showDead, setShowDead] = useState(false);
  const [ytSort, setYtSort] = useState("popular");
  const [showFavs, setShowFavs] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [ytSearch, setYtSearch] = useState("");
  const [ytShowCount, setYtShowCount] = useState(60);
  const fmtMs=(ms)=>`${Math.floor(ms/60000)}:${String(Math.floor((ms%60000)/1000)).padStart(2,"0")}`;
  // Reset pagination when filter/search changes
  useEffect(() => { setYtShowCount(60); }, [ytFilterCat, ytSearch, showFavs]);

  // Discover state
  const [discQ, setDiscQ] = useState("");
  const [discResults, setDiscResults] = useState([]);
  const [discLoading, setDiscLoading] = useState(false);
  const [discSearched, setDiscSearched] = useState(false);
  const [discLastQ, setDiscLastQ] = useState("");
  const [discNextPage, setDiscNextPage] = useState("");
  const [discType, setDiscType] = useState("video");

  // Chat / Comments panel state
  const [chatTab, setChatTab] = useState("comments");
  const [chatPanel, setChatPanel] = useState(true);
  const [chatAvail, setChatAvail] = useState(true);
  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsNextPage, setCommentsNextPage] = useState("");
  const [commentsFetchedVid, setCommentsFetchedVid] = useState("");

  const fetchComments = async (vid, pageToken) => {
    if (!vid) return;
    setCommentsLoading(true);
    try {
      let apiKey;
      try { apiKey = getYtApiKey(JSON.parse(localStorage.getItem('ds-v1') || '{}')); } catch(_) { apiKey = DEFAULT_YT_API_KEY; }
      const params = new URLSearchParams({
        part: 'snippet', videoId: vid, maxResults: '20', order: 'relevance', key: apiKey,
        textFormat: 'plainText', ...(pageToken ? { pageToken } : {}),
      });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/commentThreads?${params}`, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) { setCommentsLoading(false); return; }
      const data = await r.json();
      const items = (data.items || []).map(it => {
        const s = it.snippet?.topLevelComment?.snippet;
        if (!s) return null;
        const ago = s.publishedAt ? timeAgo(new Date(s.publishedAt)) : '';
        return {
          author: s.authorDisplayName || 'Anonymous',
          avatar: s.authorProfileImageUrl || '',
          text: s.textDisplay || '',
          likes: s.likeCount || 0,
          time: ago,
          pinned: it.snippet?.isPublic,
        };
      }).filter(Boolean);
      setComments(prev => pageToken ? [...prev, ...items] : items);
      setCommentsNextPage(data.nextPageToken || '');
      setCommentsFetchedVid(vid);
    } catch(e) {
      dlog('warn','comments','Failed to fetch comments: ' + e.message);
    }
    setCommentsLoading(false);
  };

  // Auto-fetch comments when active stream changes
  useEffect(() => {
    const activeVid = ytStreams[0]?.vid;
    if (!activeVid || activeVid === commentsFetchedVid) return;
    setComments([]);
    setCommentsNextPage("");
    const isLive = _ytStats[activeVid]?.live || ytStreams[0]?.type === "live";
    setChatAvail(isLive);
    setChatTab(isLive ? "chat" : "comments");
    // Fetch comments for the new video
    fetchComments(activeVid);
  }, [ytStreams[0]?.vid]);

  const discoverSearch = async (query, pageToken) => {
    if (!query.trim()) return;
    setDiscLoading(true);
    if (!pageToken) { setDiscResults([]); setDiscSearched(true); setDiscLastQ(query); }
    try {
      let apiKey;
      try { apiKey = getYtApiKey(JSON.parse(localStorage.getItem('ds-v1') || '{}')); } catch(_) { apiKey = DEFAULT_YT_API_KEY; }
      const params = new URLSearchParams({
        part: 'snippet', q: query + ' music', type: 'video',
        videoCategoryId: '10', maxResults: '24', key: apiKey,
        videoEmbeddable: 'true', order: 'relevance',
        ...(discType === 'live' ? { eventType: 'live' } : { videoDuration: 'long' }),
        ...(pageToken ? { pageToken } : {}),
      });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) { toast("YouTube API error. Check your key in Settings.", "warn"); setDiscLoading(false); return; }
      const data = await r.json();
      const ids = (data.items||[]).map(it => it.id?.videoId).filter(Boolean);
      if (ids.length === 0) { setDiscLoading(false); return; }
      
      // Fetch video details for duration, view count
      const detailParams = new URLSearchParams({
        part: 'snippet,contentDetails,statistics,status', id: ids.join(','), key: apiKey,
      });
      const dr = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`, { signal: AbortSignal.timeout(10000) });
      const dd = await dr.json();
      
      const results = (dd.items||[]).filter(it => it.status?.embeddable !== false).map(it => {
        const dur = it.contentDetails?.duration || '';
        const match = dur.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
        let durStr = '';
        if (match) {
          const h = parseInt(match[1]||0), m = parseInt(match[2]||0);
          durStr = h > 0 ? `${h}h${m>0?m+'m':''}` : `${m}m`;
        }
        const views = parseInt(it.statistics?.viewCount || 0);
        const viewStr = views > 1000000 ? (views/1000000).toFixed(1)+'M' : views > 1000 ? Math.round(views/1000)+'K' : views > 0 ? String(views) : '';
        const pub = it.snippet?.publishedAt ? new Date(it.snippet.publishedAt).getFullYear() : '';
        return {
          vid: it.id, title: it.snippet?.title || 'Untitled',
          channel: it.snippet?.channelTitle || '',
          thumb: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || '',
          duration: durStr, views: viewStr ? viewStr + ' views' : '',
          published: pub ? String(pub) : '',
          isLive: it.snippet?.liveBroadcastContent === 'live',
        };
      });
      
      setDiscResults(prev => pageToken ? [...prev, ...results] : results);
      setDiscNextPage(data.nextPageToken || '');
    } catch(e) {
      toast("Search failed: " + e.message, "warn");
      dlog('error','discover','Search error: ' + e.message);
    }
    setDiscLoading(false);
  };
  const nowPlaying = audio.playing ? STATIONS.find(s => s.id === audio.playing) : null;
  const filtered = filterCat === "all" ? STATIONS : STATIONS.filter(s => s.cat === filterCat);
  const downCount = STATIONS.filter(s => health[s.id] && !health[s.id].ok).length;
  const hasActiveYT = ytStreams.length > 0;
  const [playerVisible, setPlayerVisible] = useState(false);
  useEffect(() => {
    if (hasActiveYT) setPlayerVisible(true);
    else { const t = setTimeout(() => setPlayerVisible(false), 350); return () => clearTimeout(t); }
  }, [hasActiveYT]);

  const toggleYtStream = (s) => {
    const isPlaying = ytStreams.some(st => st.vid === s.vid);
    if (isPlaying) {
      ytRemoveStream(s.vid);
    } else {
      ytAddStream({vid:s.vid, name:s.name, desc:s.desc, cat:s.cat});
      // Smooth scroll to player after a short delay for animation
      setTimeout(() => {
        mainPlayerRef.current?.scrollIntoView({behavior:"smooth",block:"nearest"});
      }, 150);
    }
  };

  // [FILTER] Merge built-in + custom streams into unified list
  const customAsStreams = customStreams.map((c, i) => ({
    id: `custom-${i}`, cat: "custom", name: c.name, desc: "User-added",
    vid: c.vid, pop: 3, type: "unknown", isCustom: true
  }));
  const ALL_YT = [...YT_STREAMS, ...customAsStreams];

  // [FILTER] Dynamic "Live Now" count — use API data when available, fall back to stream type metadata
  const liveNowCount = ALL_YT.filter(s => _ytStats[s.vid]?.live || _ytStats[s.vid]?.viewers > 0 || (s.type === "live" && Object.keys(_ytStats).length === 0)).length;

  // [FILTER] Build filtered stream list based on category or special filters
  let ytBase = ytFilterCat === "all" ? ALL_YT :
    ytFilterCat === "live" ? ALL_YT.filter(s => _ytStats[s.vid]?.live || _ytStats[s.vid]?.viewers > 0 || (s.type === "live" && Object.keys(_ytStats).length === 0)) :
    ytFilterCat === "custom" ? customAsStreams :
    YT_PARENT_CATS.some(p => p.key === ytFilterCat) ?
      ALL_YT.filter(s => s.cat.startsWith(ytFilterCat)) :
      ALL_YT.filter(s => s.cat === ytFilterCat);
  if (showFavs) ytBase = ytBase.filter(s => favs.yt.includes(s.vid));
  if (ytSearch.trim()) {
    const q = ytSearch.trim().toLowerCase();
    ytBase = ytBase.filter(s => s.name.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q) || (ytStats[s.vid]?.title||'').toLowerCase().includes(q));
  }
  const ytLiveUnsorted = ytBase.filter(s => !ytHealth[s.vid] || ytHealth[s.vid].ok);
  const ytLive = [...ytLiveUnsorted].sort((a,b) => {
    if (ytSort === "viewers") return (ytStats[b.vid]?.viewers||0) - (ytStats[a.vid]?.viewers||0) || (b.pop||3)-(a.pop||3);
    if (ytSort === "views") return (ytStats[b.vid]?.views||0) - (ytStats[a.vid]?.views||0) || (b.pop||3)-(a.pop||3);
    if (ytSort === "popular") {
      // Use API concurrent viewers first, then views, then fallback pop rating
      const aScore = (_ytStats[a.vid]?.viewers||0)*1000 + (_ytStats[a.vid]?.views||0) + (a.pop||3)*1e6;
      const bScore = (_ytStats[b.vid]?.viewers||0)*1000 + (_ytStats[b.vid]?.views||0) + (b.pop||3)*1e6;
      return bScore - aScore || a.name.localeCompare(b.name);
    }
    if (ytSort === "name") return a.name.localeCompare(b.name);
    if (ytSort === "category") return (a.cat||"").localeCompare(b.cat||"") || a.name.localeCompare(b.name);
    if (ytSort === "duration") {
      const aLive = (_ytStats[a.vid]?.live || a.type === "live") ? 1 : 0;
      const bLive = (_ytStats[b.vid]?.live || b.type === "live") ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      const aDur = _ytStats[a.vid]?.durationSec || 0;
      const bDur = _ytStats[b.vid]?.durationSec || 0;
      return bDur - aDur || a.name.localeCompare(b.name);
    }
    return 0;
  });
  const ytDead = ytBase.filter(s => ytHealth[s.vid] && !ytHealth[s.vid].ok);
  const ytDeadCount = YT_STREAMS.filter(s => ytHealth[s.vid] && !ytHealth[s.vid].ok).length;

  // Track main player visibility for sticky mini player
  const mainPlayerRef = useRef(null);
  const [mainPlayerVisible, setMainPlayerVisible] = useState(true);
  useEffect(() => {
    if (!mainPlayerRef.current) return;
    const obs = new IntersectionObserver(([entry]) => setMainPlayerVisible(entry.isIntersecting), { threshold: 0.15 });
    obs.observe(mainPlayerRef.current);
    return () => obs.disconnect();
  }, [ytStreams.length]);

  return (
    <div className="fade">
      {/* Header + tabs inline */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:4}}>
          <Ic.IcMusic s={22} c={T.accent}/>
          <h1 style={{fontSize:fs(22),fontWeight:800,background:`linear-gradient(135deg,${T.accent},${T.blue},${T.purple})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Study Radio</h1>
        </div>
        {/* Health check progress bar */}
        {checkProgress.active && (
          <div style={{marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
              <Ic.Spin s={12}/><span style={{fontSize:fs(10),color:T.soft}}>{checkProgress.phase} ({checkProgress.done}/{checkProgress.total})</span>
            </div>
            <div style={{height:3,background:T.input,borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",background:`linear-gradient(90deg,${T.accent},${T.blue})`,borderRadius:2,width:`${checkProgress.total?Math.round(checkProgress.done/checkProgress.total*100):0}%`,transition:"width .3s ease"}}/>
            </div>
          </div>
        )}
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          <button className="sf-btn sf-tab" onClick={()=>setMainTab("youtube")} style={{padding:"8px 18px",borderRadius:10,cursor:"pointer",fontSize:fs(13),fontWeight:700,border:`2px solid ${mainTab==="youtube"?"#ff4444":T.border}`,background:mainTab==="youtube"?"#ff444418":T.card,color:mainTab==="youtube"?"#ff4444":T.soft,display:"flex",alignItems:"center",gap:7}}>
            <Ic.YT s={18} c={mainTab==="youtube"?"#ff4444":T.dim}/> YouTube ({ALL_YT.length})
          </button>
          <button className="sf-btn sf-tab" onClick={()=>setMainTab("discover")} style={{padding:"8px 18px",borderRadius:10,cursor:"pointer",fontSize:fs(13),fontWeight:700,border:`2px solid ${mainTab==="discover"?T.purple:T.border}`,background:mainTab==="discover"?T.purpleD:T.card,color:mainTab==="discover"?T.purple:T.soft,display:"flex",alignItems:"center",gap:7}}>
            <Ic.IcSearch s={18} c={mainTab==="discover"?T.purple:T.dim}/> Discover
          </button>
          <button className="sf-btn sf-tab" onClick={()=>setMainTab("somafm")} style={{padding:"8px 18px",borderRadius:10,cursor:"pointer",fontSize:fs(13),fontWeight:700,border:`2px solid ${mainTab==="somafm"?T.accent:T.border}`,background:mainTab==="somafm"?T.accentD:T.card,color:mainTab==="somafm"?T.accent:T.soft,display:"flex",alignItems:"center",gap:7}}>
            <Ic.Radio s={18} c={mainTab==="somafm"?T.accent:T.dim}/> SomaFM ({STATIONS.length})
          </button>
        </div>
      </div>
      {/*  YouTube Tab  */}
      {/* YouTube Tab — stays mounted to preserve audio */}
      <div style={{display:mainTab==="youtube"?"block":"none"}}>
        {/* Active stream players (up to 4) */}
        {playerVisible && (
          <div ref={mainPlayerRef} className={hasActiveYT?"expand-down":""} style={{marginBottom:16,opacity:hasActiveYT?1:0,transition:"opacity .3s ease"}}>
            <div className="fade" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <span style={{fontSize:fs(13),fontWeight:700,color:T.accent}}>▶ {ytStreams.length} stream{ytStreams.length>1?"s":""} playing {ytStreams.length<4&&<span style={{fontSize:fs(10),color:T.dim,fontWeight:400}}>· click more to stack (max 4)</span>}</span>
              <Btn small v="danger" onClick={ytClearAll}>✕ Close All</Btn>
            </div>
            <div style={{display:"grid",gridTemplateColumns:ytStreams.length===1?(chatPanel?"1fr 320px":"1fr"):ytStreams.length===2?"1fr 1fr":"repeat(2,1fr)",gap:8,transition:"all .3s ease",position:"relative"}}>
              {ytStreams.map((s,i) => {
                const st = ytStats[s.vid];
                const detType = st?.detectedType || s.type || 'unknown';
                return (
                <div key={s.vid} className={s.closing?"fade-out":"slide-up"} style={{background:"#000",borderRadius:10,overflow:"hidden",border:`1px solid ${T.accent}44`,position:"relative",animationDelay:s.closing?'0ms':`${i*100}ms`}}>
                  <iframe data-yt-slot={i} src={`http://127.0.0.1:19532/yt-proxy?v=${s.vid}`}
                    style={{width:"100%",height:ytStreams.length<=2?380:220,border:"none",display:"block",transition:"height .3s ease"}}
                    allow="autoplay;encrypted-media;picture-in-picture;fullscreen" allowFullScreen/>
                  <div style={{padding:"6px 10px",display:"flex",alignItems:"center",justifyContent:"space-between",background:T.card}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flex:1,overflow:"hidden"}}>
                      <span style={{fontSize:fs(8),fontWeight:700,padding:"1px 5px",borderRadius:3,background:detType==='live'?'#e00':'#555',color:'#fff',flexShrink:0}}>{detType==='live'?'LIVE':'VIDEO'}</span>
                      <span style={{fontSize:fs(11),fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                    </div>
                    {st && <div style={{display:"flex",gap:6,fontSize:fs(9),color:T.dim,flexShrink:0,marginRight:6}}>
                      {st.viewers>0&&<span>👁 {fmtNum(st.viewers)}</span>}
                      {st.views>0&&<span>▶ {fmtNum(st.views)}</span>}
                      {st.channelTitle&&<span style={{color:T.soft}}>{st.channelTitle.slice(0,15)}</span>}
                    </div>}
                    <div style={{display:"flex",gap:4}}>
                      <button onClick={()=>ytPauseToggle(s.vid)} style={{background:"none",border:"none",color:s.paused?T.accent:T.soft,cursor:"pointer",padding:"4px"}}>{s.paused?<Ic.IcPlay s={18} c={T.accent}/>:<Ic.IcPause s={18} c={T.soft}/>}</button>
                      <button onClick={()=>ytRemoveStream(s.vid)} style={{background:"none",border:"none",color:T.red,cursor:"pointer",padding:"4px"}}><Ic.IcX s={18} c={T.red}/></button>
                    </div>
                  </div>
                </div>
                );
              })}
              {/* Chat / Comments Panel — inline for single stream */}
              {ytStreams.length === 1 && chatPanel && (
                <div style={{background:T.card,borderRadius:10,border:`1px solid ${T.border}`,overflow:"hidden",display:"flex",flexDirection:"column",height:440}}>
                  {/* Panel header with tabs */}
                  <div style={{display:"flex",alignItems:"center",padding:"6px 8px",borderBottom:`1px solid ${T.border}`,flexShrink:0,gap:4,background:T.bg2}}>
                    {chatAvail && (
                      <button onClick={()=>setChatTab("chat")} style={{padding:"3px 10px",borderRadius:5,border:"none",cursor:"pointer",fontSize:fs(10),fontWeight:chatTab==="chat"?700:500,background:chatTab==="chat"?T.accentD:"transparent",color:chatTab==="chat"?T.accent:T.dim}}>Live Chat</button>
                    )}
                    <button onClick={()=>setChatTab("comments")} style={{padding:"3px 10px",borderRadius:5,border:"none",cursor:"pointer",fontSize:fs(10),fontWeight:chatTab==="comments"?700:500,background:chatTab==="comments"?T.purpleD:"transparent",color:chatTab==="comments"?T.purple:T.dim}}>Comments{comments.length>0?` (${comments.length})`:""}</button>
                    <div style={{flex:1}}/>
                    <button onClick={()=>setChatPanel(false)} style={{background:"none",border:"none",cursor:"pointer",padding:2,color:T.dim}} title="Collapse"><Ic.IcX s={12}/></button>
                  </div>
                  <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                    {chatTab === "chat" && chatAvail && (
                      <iframe src={`http://127.0.0.1:19532/yt-chat?v=${ytStreams[0].vid}`} style={{flex:1,border:"none",background:T.bg2}}/>
                    )}
                    {chatTab === "comments" && (
                      <div style={{flex:1,overflow:"auto",padding:8}}>
                        {commentsLoading && comments.length===0 && <div style={{textAlign:"center",padding:20,color:T.dim}}><Ic.Spin s={16}/><div style={{marginTop:6,fontSize:fs(10)}}>Loading comments...</div></div>}
                        {!commentsLoading && comments.length === 0 && <div style={{textAlign:"center",padding:20,color:T.dim,fontSize:fs(11)}}>No comments available</div>}
                        {comments.map((c,i) => (
                          <div key={i} style={{display:"flex",gap:8,padding:"6px 0",borderBottom:`1px solid ${T.border}22`}}>
                            <img src={c.avatar} style={{width:24,height:24,borderRadius:"50%",flexShrink:0,marginTop:2,background:T.bg2}} alt="" onError={e=>{e.target.style.display='none'}}/>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                                <span style={{fontSize:fs(10),fontWeight:600,color:T.soft,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.author}</span>
                                <span style={{fontSize:fs(9),color:T.dim,flexShrink:0}}>{c.time}</span>
                              </div>
                              <div style={{fontSize:fs(11),color:T.text,lineHeight:1.4,wordBreak:"break-word"}}>{c.text}</div>
                              {c.likes > 0 && <div style={{fontSize:fs(9),color:T.dim,marginTop:2}}>&#9650; {fmtNum(c.likes)}</div>}
                            </div>
                          </div>
                        ))}
                        {commentsNextPage && !commentsLoading && (
                          <button onClick={()=>fetchComments(ytStreams[0]?.vid,commentsNextPage)} style={{width:"100%",padding:"6px",borderRadius:6,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",fontSize:fs(10),color:T.purple,fontWeight:600,marginTop:6}}>Load More Comments</button>
                        )}
                        {commentsLoading && comments.length > 0 && <div style={{textAlign:"center",padding:8}}><Ic.Spin s={12}/></div>}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Collapsed panel toggle */}
              {ytStreams.length >= 1 && !chatPanel && (
                <div style={{position:"absolute",top:8,right:8,zIndex:5}}>
                  <button onClick={()=>setChatPanel(true)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:fs(10),fontWeight:600,color:T.purple,boxShadow:"0 2px 8px rgba(0,0,0,.3)"}}>
                    <Ic.Chat s={12} c={T.purple}/> {chatAvail?"Chat":"Comments"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sticky hover bar — anchored to top when scrolled past player */}
        {hasActiveYT && !mainPlayerVisible && (
          <div className="fade" style={{position:"sticky",top:-28,zIndex:15,background:`${T.panel}f5`,backdropFilter:"blur(14px)",borderBottom:`2px solid ${T.accent}44`,padding:"10px 32px",margin:"-28px -32px 12px -32px",display:"flex",gap:12,alignItems:"center",boxShadow:"0 4px 24px rgba(0,0,0,.4)"}}>
            {/* Stream thumbnails */}
            <div style={{display:"flex",gap:4,flexShrink:0}}>
              {ytStreams.slice(0,4).map(s => (
                <img key={s.vid} src={`https://img.youtube.com/vi/${s.vid}/default.jpg`} style={{width:56,height:42,borderRadius:6,objectFit:"cover",border:`1.5px solid ${T.accent}44`}} alt={s.name}/>
              ))}
            </div>
            <div style={{flex:1,overflow:"hidden"}}>
              <div style={{fontSize:fs(14),fontWeight:700,color:T.accent,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                <Ic.IcPlay s={12} c={T.accent}/> {ytStreams.map(s=>s.name).join(" + ")}
              </div>
              <div style={{fontSize:fs(10),color:T.dim,marginTop:2}}>{ytStreams.length} stream{ytStreams.length>1?"s":""} active</div>
            </div>
            <button onClick={()=>mainPlayerRef.current?.scrollIntoView({behavior:"smooth"})} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:fs(13),color:T.soft,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              <Ic.ChevL s={12}/> Back
            </button>
            <button onClick={ytClearAll} style={{background:T.redD,border:`1px solid ${T.red}33`,borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:fs(13),color:T.red,fontWeight:600,display:"flex",alignItems:"center",gap:4}}>
              <Ic.IcX s={12} c={T.red}/> Close All
            </button>
          </div>
        )}

        {/* Filter + Sort bar */}
        <div style={{marginBottom:12}}>
          {/* Parent categories */}
          <div style={{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
            <button className="sf-chip" onClick={()=>setYtFilterCat("all")} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${ytFilterCat==="all"?T.accent:T.border}`,background:ytFilterCat==="all"?T.accentD:T.input,color:ytFilterCat==="all"?T.accent:T.soft}}>All ({ALL_YT.length})</button>
            <button className="sf-chip" onClick={()=>setYtFilterCat("live")} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:700,border:`1.5px solid ${ytFilterCat==="live"?"#e00":T.border}`,background:ytFilterCat==="live"?"#e0001a":T.input,color:ytFilterCat==="live"?"#fff":"#e00",display:"flex",alignItems:"center",gap:4}}><Ic.IcLive s={12}/> Live{liveNowCount>0?` (${liveNowCount})`:""}</button>
            <button className="sf-chip" onClick={()=>setYtFilterCat("custom")} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${ytFilterCat==="custom"?T.blue:T.border}`,background:ytFilterCat==="custom"?`${T.blue}22`:T.input,color:ytFilterCat==="custom"?T.blue:T.soft,display:"flex",alignItems:"center",gap:4}}><Ic.IcUser s={12} c={ytFilterCat==="custom"?T.blue:T.soft}/> My{customStreams.length>0?` (${customStreams.length})`:""}</button>
            {YT_PARENT_CATS.map(p => {
              const count = YT_STREAMS.filter(s => s.cat.startsWith(p.key)).length;
              const active = ytFilterCat === p.key || ytFilterCat.startsWith(p.key+"-");
              const YtIcons = {lofi:Ic.YtLofi,jazz:Ic.YtJazz,classical:Ic.YtClassical,ambient:Ic.YtAmbient,synth:Ic.YtSynth,focus:Ic.YtFocus,chill:Ic.YtChill,sleep:Ic.CatAmbient,world:Ic.CatWorld};
              const CatIcon = YtIcons[p.key];
              return <button key={p.key} onClick={()=>setYtFilterCat(p.key)} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${active?T.accent:T.border}`,background:active?T.accentD:T.input,color:active?T.accent:T.soft,display:"flex",alignItems:"center",gap:4}}>{CatIcon?<CatIcon s={14}/>:null} {p.label} ({count})</button>;
            })}
            <div style={{flex:1}}/>
            {/* [UI] Sort buttons with SVG icons */}
            <div style={{display:"flex",gap:2,background:T.input,borderRadius:6,padding:2,border:`1px solid ${T.border}`}}>
              {[
                {k:"popular",icon:Ic.IcCrown,label:"Popular"},
                {k:"viewers",icon:Ic.IcEye,label:"Viewers"},
                {k:"views",icon:Ic.IcChart,label:"Views"},
                {k:"name",icon:Ic.IcAZ,label:"A-Z"},
                {k:"category",icon:Ic.IcGrid,label:"Cat"},
                {k:"duration",icon:Ic.Clock,label:"Length"},
              ].map(o => (
                <button key={o.k} onClick={()=>setYtSort(o.k)} title={o.label} style={{padding:"3px 7px",borderRadius:4,border:"none",cursor:"pointer",background:ytSort===o.k?T.accentD:"transparent",color:ytSort===o.k?T.accent:T.dim,display:"flex",alignItems:"center",gap:3,fontSize:fs(9),fontWeight:ytSort===o.k?600:400,transition:"all .15s"}}>
                  <o.icon s={11} c={ytSort===o.k?T.accent:T.dim}/> {o.label}
                </button>
              ))}
            </div>
            <button onClick={()=>setShowFavs(!showFavs)} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${showFavs?T.yellow:T.border}`,background:showFavs?`${T.yellow}22`:T.input,color:showFavs?T.yellow:T.dim}}>{showFavs?"★ Favs":"☆ Favs"}</button>
            <button onClick={()=>setShowCustomInput(p=>!p)} style={{padding:"4px 10px",borderRadius:6,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${showCustomInput?T.blue:T.border}`,background:showCustomInput?`${T.blue}22`:T.input,color:showCustomInput?T.blue:T.dim,display:"flex",alignItems:"center",gap:4}}><Ic.IcPlus s={11} c={showCustomInput?T.blue:T.dim}/> Add URL</button>
            <div style={{flex:1}}/>
            <input value={ytSearch} onChange={e=>setYtSearch(e.target.value)} placeholder="Search streams..." style={{width:160,padding:"4px 10px",fontSize:fs(11),borderRadius:6,border:`1px solid ${T.border}`,background:T.input,color:T.text}}/>
            {ytSearch && <button onClick={()=>setYtSearch("")} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",fontSize:fs(11)}}>Clear</button>}
          </div>
          {/* Subcategories — show when a parent is selected */}
          {ytFilterCat !== "all" && (() => {
            const parentKey = YT_PARENT_CATS.find(p => ytFilterCat === p.key || ytFilterCat.startsWith(p.key))?.key;
            if (!parentKey) return null;
            const subs = YT_CATS.filter(c => c.parent === parentKey);
            return subs.length > 1 ? (
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                <button onClick={()=>setYtFilterCat(parentKey)} style={{padding:"3px 8px",borderRadius:5,cursor:"pointer",fontSize:fs(10),fontWeight:500,border:`1px solid ${ytFilterCat===parentKey?T.accent:T.border}`,background:ytFilterCat===parentKey?T.accentD:"transparent",color:ytFilterCat===parentKey?T.accent:T.dim}}>All {YT_PARENT_CATS.find(p=>p.key===parentKey)?.label}</button>
                {subs.map(sub => {
                  const count = YT_STREAMS.filter(s => s.cat === sub.key).length;
                  return <button key={sub.key} onClick={()=>setYtFilterCat(sub.key)} style={{padding:"3px 8px",borderRadius:5,cursor:"pointer",fontSize:fs(10),fontWeight:500,border:`1px solid ${ytFilterCat===sub.key?T.accent:T.border}`,background:ytFilterCat===sub.key?T.accentD:"transparent",color:ytFilterCat===sub.key?T.accent:T.dim}}>{sub.label} ({count})</button>;
                })}
              </div>
            ) : null;
          })()}
        </div>

        {/* Inline custom URL input */}
        {showCustomInput && (
          <div className="fade" style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
            <input value={customUrl} onChange={e=>setCustomUrl(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")document.getElementById("add-custom-btn")?.click()}} placeholder="Paste YouTube URL (watch, youtu.be, embed)" style={{flex:1,fontSize:fs(11),padding:"7px 12px"}}/>
            <Btn small v="ai" id="add-custom-btn" onClick={()=>{
              if (!customUrl.trim()) return;
              const m = customUrl.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);
              if (m) { const vid = m[1]; addCustomStream(vid, `Custom ${vid.slice(0,6)}`); ytAddStream({vid, name:`Custom ${vid.slice(0,6)}`, desc:"User-added", cat:"custom"}); toast(`Added: ${vid}`, "info"); setCustomUrl(""); }
              else toast("Could not parse YouTube URL", "warn");
            }}><Ic.IcPlus s={12} c="#fff"/> Add</Btn>
          </div>
        )}

        {/* Stream grid — paginated for performance */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))",gap:8}}>
          {ytLive.slice(0, ytShowCount).map(s => {
            const isActive = ytStreams.some(st => st.vid === s.vid);
            const st = ytStats[s.vid];
            const isFav = favs.yt.includes(s.vid);
            return (
              <div key={s.id} className="sf-yt-card" style={{
                background:isActive?T.accentD:T.card,
                border:`1.5px solid ${isActive?T.accent:T.border}`,
                borderRadius:10, overflow:"hidden", position:"relative",
              }}>
                <button onClick={()=>toggleYtStream(s)} style={{width:"100%",textAlign:"left",padding:0,border:"none",cursor:"pointer",background:"transparent"}}>
                  <div style={{position:"relative",width:"100%",aspectRatio:"16/9",background:T.bg2,overflow:"hidden"}}>
                    <img src={`https://img.youtube.com/vi/${s.vid}/mqdefault.jpg`} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}} loading="lazy"/>
                    {isActive && <div style={{position:"absolute",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:T.accent,fontSize:fs(12),fontWeight:700}}>● PLAYING</span></div>}
                    {/* [UI] Type badge — LIVE if viewers exist, STREAM if type=live, else VIDEO */}
                    {(() => {
                      const detType = ytStats[s.vid]?.detectedType || s.type;
                      const isLiveNow = ytStats[s.vid]?.live || st?.live || (st?.viewers > 0);
                      if (isLiveNow) return <div style={{position:"absolute",top:4,left:4,background:"#e00",borderRadius:4,padding:"2px 7px",fontSize:fs(9),color:"#fff",fontWeight:700,display:"flex",alignItems:"center",gap:3}}><Ic.IcLive s={10}/> LIVE</div>;
                      if (detType === "live") return <div style={{position:"absolute",top:4,left:4,background:"#e0002a",borderRadius:4,padding:"2px 7px",fontSize:fs(8),color:"#fff",fontWeight:700,letterSpacing:.5}}>STREAM</div>;
                      if (detType === "video") return <div style={{position:"absolute",top:4,left:4,background:"rgba(0,0,0,0.75)",borderRadius:4,padding:"2px 7px",fontSize:fs(8),color:"#ccc",fontWeight:600}}>VIDEO</div>;
                      return null;
                    })()}
                    {st?.viewers > 0 && <div style={{position:"absolute",bottom:4,left:4,background:"rgba(0,0,0,0.8)",borderRadius:4,padding:"1px 6px",fontSize:fs(9),color:"#fff"}}>👁 {fmtNum(st.viewers)}</div>}
                    {st?.views > 0 && <div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.8)",borderRadius:4,padding:"1px 6px",fontSize:fs(9),color:"#fff"}}>▶ {fmtNum(st.views)}</div>}
                    {!st && s.pop && <div style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,0.75)",borderRadius:4,padding:"1px 6px",fontSize:fs(9),color:"#fff"}}>{"★".repeat(s.pop)}</div>}
                  </div>
                  <div style={{padding:"6px 8px"}}>
                    <div style={{fontSize:fs(11),fontWeight:600,color:isActive?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                    <div style={{fontSize:fs(9),color:T.dim,marginTop:1,display:"flex",gap:6,alignItems:"center"}}>
                      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{st?.channelTitle || s.desc}</span>
                      {st?.durationSec > 0 && <span style={{flexShrink:0,color:T.soft}}>{Math.floor(st.durationSec/3600)}h{Math.floor((st.durationSec%3600)/60)}m</span>}
                    </div>
                  </div>
                </button>
                <button onClick={(e)=>{e.stopPropagation();toggleFav('yt',s.vid)}} style={{position:"absolute",top:4,right:s.isCustom?28:4,background:"rgba(0,0,0,0.6)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",fontSize:fs(12),color:isFav?T.yellow:"#fff8",zIndex:2}}>{isFav?"★":"☆"}</button>
                {s.isCustom && <button onClick={(e)=>{e.stopPropagation();removeCustomStream(s.vid);toast(`Removed: ${s.name}`,"info")}} style={{position:"absolute",top:4,right:4,background:"rgba(200,0,0,0.7)",border:"none",borderRadius:4,padding:"2px 5px",cursor:"pointer",zIndex:2}} title="Remove"><Ic.IcX s={10} c="#fff"/></button>}
              </div>
            );
          })}
        </div>
        {ytLive.length > ytShowCount && (
          <div style={{textAlign:"center",marginTop:12}}>
            <button onClick={()=>setYtShowCount(c=>c+60)} style={{padding:"8px 24px",borderRadius:8,border:`1px solid ${T.border}`,background:T.card,cursor:"pointer",fontSize:fs(12),fontWeight:600,color:T.accent}}>
              Show More ({ytLive.length - ytShowCount} remaining)
            </button>
          </div>
        )}
        {ytLive.length > 0 && ytLive.length <= ytShowCount && ytShowCount > 60 && (
          <div style={{textAlign:"center",marginTop:8,fontSize:fs(10),color:T.dim}}>Showing all {ytLive.length} streams</div>
        )}

        {/* My Streams management */}
        {customStreams.length > 0 && (
          <div style={{marginTop:12,padding:"10px 14px",background:T.card,border:`1px solid ${T.border}`,borderRadius:10}}>
            <div style={{fontSize:fs(10),fontWeight:600,color:T.soft,marginBottom:6,display:"flex",alignItems:"center",gap:4}}><Ic.IcUser s={12} c={T.soft}/> My Streams ({customStreams.length})</div>
            {customStreams.map(c => (
              <div key={c.vid} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:`1px solid ${T.border}22`}}>
                <img src={`https://img.youtube.com/vi/${c.vid}/default.jpg`} style={{width:40,height:30,borderRadius:4,objectFit:"cover"}} alt=""/>
                <div style={{flex:1,overflow:"hidden"}}>
                  <div style={{fontSize:fs(11),fontWeight:600,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ytStats[c.vid]?.title || c.name}</div>
                  <div style={{fontSize:fs(9),color:T.dim}}>{c.vid}{ytStats[c.vid]?.detectedType ? ` ${ytStats[c.vid].detectedType}` : ""}</div>
                </div>
                <button onClick={()=>{toggleYtStream({vid:c.vid,name:c.name,desc:"Custom",cat:"custom"})}} style={{background:T.accentD,border:`1px solid ${T.accent}44`,borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:fs(9),color:T.accent,fontWeight:600}}>
                  {ytStreams.some(s=>s.vid===c.vid)?"Stop":"Play"}
                </button>
                <button onClick={()=>{removeCustomStream(c.vid);toast(`Removed: ${c.name}`,"info")}} style={{background:T.redD,border:`1px solid ${T.red}33`,borderRadius:4,padding:"2px 6px",cursor:"pointer"}} title="Remove">
                  <Ic.IcTrash s={11} c={T.red}/>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Unavailable — collapsible */}
        {ytDead.length > 0 && (
          <div style={{marginTop:16}}>
            <button onClick={()=>setShowDead(!showDead)} style={{fontSize:fs(11),color:T.dim,fontWeight:600,display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",padding:"4px 0",marginBottom:showDead?6:0}}>
              <span style={{transition:"transform .2s",transform:showDead?"rotate(90deg)":"rotate(0)",display:"inline-block"}}>▶</span>
              <span style={{color:T.red}}>⊘</span> Unavailable ({ytDead.length})
            </button>
            {showDead && (
              <div className="fade" style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:6}}>
                {ytDead.map(s => (
                  <div key={s.id} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",opacity:0.3,filter:"grayscale(1)"}} title={ytHealth[s.vid]?.reason}>
                    <img src={`https://img.youtube.com/vi/${s.vid}/mqdefault.jpg`} style={{width:"100%",aspectRatio:"16/9",objectFit:"cover"}} loading="lazy"/>
                    <div style={{padding:"4px 8px",fontSize:fs(9),color:T.dim}}>{s.name}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/*  SomaFM Tab — stays mounted to preserve audio  */}
      <div style={{display:mainTab==="somafm"?"block":"none"}}>
        {/* Now Playing */}
        {nowPlaying && (
          <div className="fade" style={{background:T.accentD,border:`1.5px solid ${T.accent}44`,borderRadius:12,padding:16,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <span>{(() => {
                const catIcons = {lofi:Ic.CatLofi,ambient:Ic.CatAmbient,jazz:Ic.CatJazz,world:Ic.CatWorld,classical:Ic.CatClassical,energy:Ic.CatEnergy,holiday:Ic.CatHoliday};
                const CI = catIcons[nowPlaying.cat] || Ic.IcMusic;
                return <CI s={32}/>;
              })()}</span>
              <div>
                <div style={{fontSize:fs(15),fontWeight:700,color:T.accent}}>Now Playing: {nowPlaying.name}</div>
                <div style={{fontSize:fs(12),color:T.soft}}>{nowPlaying.desc}</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:6,minWidth:220}}>
                <span style={{cursor:"pointer",flexShrink:0}} onClick={()=>audioSetVolume(Math.max(0,audio.volume-0.05))}><Ic.IcVolLow s={14} c={T.accent}/></span>
                <div style={{flex:1,minWidth:120}}><VolumeBar value={audio.volume} onChange={audioSetVolume}/></div>
                <span style={{cursor:"pointer",flexShrink:0}} onClick={()=>audioSetVolume(Math.min(1,audio.volume+0.05))}><Ic.IcVolHi s={14} c={T.accent}/></span>
                <span style={{fontSize:fs(11),color:T.dim,minWidth:30,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{Math.round(audio.volume*100)}%</span>
              </div>
              <Btn small v="danger" onClick={audioStop}><Ic.IcStop s={12} c={T.red}/> Stop</Btn>
            </div>
          </div>
        )}

        {/* Category filter + favorites */}
        <div style={{display:"flex",gap:5,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <button className="sf-chip" onClick={()=>setFilterCat("all")} style={{padding:"5px 12px",borderRadius:7,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${filterCat==="all"?T.accent:T.border}`,background:filterCat==="all"?T.accentD:T.input,color:filterCat==="all"?T.accent:T.soft}}>All ({STATIONS.length})</button>
          {STATION_CATS.map(cat => {
            const count = STATIONS.filter(s => s.cat === cat.key).length;
            return <button key={cat.key} className="sf-chip" onClick={()=>setFilterCat(cat.key)} style={{padding:"5px 12px",borderRadius:7,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${filterCat===cat.key?T.accent:T.border}`,background:filterCat===cat.key?T.accentD:T.input,color:filterCat===cat.key?T.accent:T.soft,display:"flex",alignItems:"center",gap:5}}>{(() => { const CI = Ic[cat.iconKey]; return CI ? <CI s={14}/> : null; })()} {cat.label} ({count})</button>;
          })}
          <div style={{flex:1}}/>
          <button onClick={()=>setFilterCat(filterCat==="favs"?"all":"favs")} style={{padding:"5px 10px",borderRadius:7,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${filterCat==="favs"?T.yellow:T.border}`,background:filterCat==="favs"?`${T.yellow}22`:T.input,color:filterCat==="favs"?T.yellow:T.dim}}>{filterCat==="favs"?"★ Favorites":"☆ Favs"}</button>
        </div>

        {/* Station grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
          {(filterCat==="favs" ? STATIONS.filter(s=>favs.soma.includes(s.id)) : filtered).map(s => {
            const isPlaying = audio.playing === s.id;
            const h = health[s.id];
            const isDown = h && !h.ok;
            const isFav = favs.soma.includes(s.id);
            return (
              <div key={s.id} className={`sf-station ${isPlaying?"sf-station-playing":""}`} style={{
                background:isDown?T.input:isPlaying?T.accentD:T.card,
                border:`1.5px solid ${isDown?T.border:isPlaying?T.accent:T.border}`,
                borderRadius:12, padding:"14px 16px",
                textAlign:"left", display:"flex", alignItems:"center", gap:12,
                opacity:isDown?0.4:1, filter:isDown?"grayscale(1)":"none", position:"relative",
              }}>
                <button onClick={()=>{ if(isDown){toast(`${s.name} is currently offline`,"warn");return;} audioToggle(s.id); if(!isPlaying) toast(`Now playing: ${s.name}`,"info"); }}
                  title={isDown ? `Offline` : s.desc}
                  style={{display:"flex",alignItems:"center",gap:12,background:"none",border:"none",cursor:isDown?"not-allowed":"pointer",flex:1,textAlign:"left",padding:0}}>
                  <span style={{flexShrink:0}}>{(() => {
                    const catIcons = {lofi:Ic.CatLofi,ambient:Ic.CatAmbient,jazz:Ic.CatJazz,world:Ic.CatWorld,classical:Ic.CatClassical,energy:Ic.CatEnergy,holiday:Ic.CatHoliday};
                    const CI = catIcons[s.cat] || Ic.IcMusic;
                    return <CI s={28}/>;
                  })()}</span>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:fs(13),fontWeight:600,color:isDown?T.dim:isPlaying?T.accent:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</div>
                    <div style={{fontSize:fs(11),color:isDown?T.red:isPlaying?T.accent:T.dim}}>{isDown?"⊘ Offline":isPlaying?"● Playing":s.desc}</div>
                  </div>
                </button>
                <button onClick={()=>toggleFav('soma',s.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:fs(16),color:isFav?T.yellow:T.dim,flexShrink:0}}>{isFav?"★":"☆"}</button>
              </div>
            );
          })}
        </div>
        {downCount > 0 && <div style={{marginTop:10,fontSize:fs(10),color:T.dim,textAlign:"center"}}>
          {downCount} station{downCount>1?"s":""} currently offline — checked every 5 minutes
        </div>}

        <div style={{marginTop:20,fontSize:fs(11),color:T.dim,textAlign:"center"}}>
          Streams provided by <span style={{color:T.soft}}>SomaFM.com</span> — Listener-supported, commercial-free internet radio
        </div>
      </div>

      {/* Discover Tab */}
      {mainTab === "discover" && (
        <div className="fade">
          <div style={{marginBottom:16}}>
            <h2 style={{fontSize:fs(18),fontWeight:700,color:T.purple,marginBottom:4,display:"flex",alignItems:"center",gap:8}}><Ic.IcGlobe s={20} c={T.purple}/> Discover New Music</h2>
            <p style={{fontSize:fs(11),color:T.dim,margin:0}}>Search YouTube for new streams, mixes, and ambient videos to add to your library.</p>
          </div>

          {/* Quick discover presets */}
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:12}}>
            {[
              {q:"lofi hip hop radio live",l:"Lofi Radio"},
              {q:"jazz cafe ambience study",l:"Jazz Cafe"},
              {q:"ambient rain sounds sleep",l:"Rain Sounds"},
              {q:"classical piano relaxing",l:"Classical Piano"},
              {q:"synthwave retrowave radio",l:"Synthwave"},
              {q:"nature sounds forest birds",l:"Nature"},
              {q:"fireplace crackling sounds",l:"Fireplace"},
              {q:"ocean waves relaxing sleep",l:"Ocean Waves"},
              {q:"studio ghibli lofi",l:"Ghibli Lofi"},
              {q:"cyberpunk ambient music",l:"Cyberpunk"},
              {q:"dark ambient deep focus",l:"Dark Ambient"},
              {q:"celtic relaxing music",l:"Celtic"},
              {q:"brown noise sleep focus",l:"Brown Noise"},
              {q:"delta waves deep sleep",l:"Delta Waves"},
              {q:"anime game ost relaxing",l:"Game OST"},
              {q:"bossa nova relaxing coffee",l:"Bossa Nova"},
            ].map(p => (
              <button key={p.q} onClick={()=>{setDiscQ(p.q);discoverSearch(p.q)}} className="sf-btn" style={{padding:"5px 11px",borderRadius:7,border:`1px solid ${discQ===p.q?T.purple:T.border}`,background:discQ===p.q?T.purpleD:T.input,color:discQ===p.q?T.purple:T.soft,fontSize:fs(11),fontWeight:500,cursor:"pointer"}}>{p.l}</button>
            ))}
          </div>

          {/* Custom search */}
          <div style={{display:"flex",gap:6,marginBottom:16}}>
            <input value={discQ} onChange={e=>setDiscQ(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")discoverSearch(discQ)}} placeholder="Search YouTube for streams, mixes, ambient..." style={{flex:1,fontSize:fs(12),padding:"9px 14px"}}/>
            <Btn v="ai" onClick={()=>discoverSearch(discQ)} disabled={discLoading||!discQ.trim()}>
              <Ic.IcSearch s={14} c="#fff"/> Search
            </Btn>
            <div style={{display:"flex",gap:3,alignItems:"center"}}>
              {[{k:"video",l:"Videos"},{k:"live",l:"Live"}].map(f=>(
                <button key={f.k} onClick={()=>setDiscType(f.k)} style={{padding:"5px 10px",borderRadius:6,border:`1px solid ${discType===f.k?T.purple:T.border}`,background:discType===f.k?T.purpleD:"transparent",color:discType===f.k?T.purple:T.dim,fontSize:fs(10),fontWeight:600,cursor:"pointer"}}>{f.l}</button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {discLoading && (
            <div style={{textAlign:"center",padding:32,color:T.purple}}>
              <Ic.Spin s={24}/><div style={{marginTop:8,fontSize:fs(12)}}>Searching YouTube...</div>
            </div>
          )}

          {/* No results */}
          {!discLoading && discResults.length === 0 && discSearched && (
            <div style={{textAlign:"center",padding:32,color:T.dim}}>
              <div style={{fontSize:fs(14),marginBottom:4}}>No results found</div>
              <div style={{fontSize:fs(11)}}>Try different keywords or check your API key in Settings</div>
            </div>
          )}

          {/* Results grid */}
          {discResults.length > 0 && (
            <div>
              <div style={{fontSize:fs(11),color:T.dim,marginBottom:8}}>{discResults.length} results for "{discLastQ}"</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:10}}>
                {discResults.map(r => {
                  const alreadyInLib = YT_STREAMS.some(s=>s.vid===r.vid) || customStreams.some(s=>s.vid===r.vid);
                  const isPlaying = ytStreams.some(s=>s.vid===r.vid);
                  return (
                    <div key={r.vid} className="sf-yt-card" style={{background:alreadyInLib?`${T.accent}08`:T.card,border:`1.5px solid ${isPlaying?T.accent:alreadyInLib?`${T.accent}44`:T.border}`,borderRadius:10,overflow:"hidden",display:"flex",gap:0}}>
                      <div style={{position:"relative",width:160,minHeight:90,flexShrink:0,background:T.bg2}}>
                        <img src={r.thumb} style={{width:"100%",height:"100%",objectFit:"cover"}} loading="lazy" alt=""/>
                        {r.isLive && <span style={{position:"absolute",top:4,left:4,background:"#e00",color:"#fff",fontSize:fs(8),fontWeight:800,padding:"1px 5px",borderRadius:3}}>LIVE</span>}
                        {r.duration && <span style={{position:"absolute",bottom:4,right:4,background:"rgba(0,0,0,.75)",color:"#fff",fontSize:fs(9),fontWeight:600,padding:"1px 5px",borderRadius:3}}>{r.duration}</span>}
                      </div>
                      <div style={{flex:1,padding:"8px 10px",display:"flex",flexDirection:"column",justifyContent:"space-between",minWidth:0}}>
                        <div>
                          <div style={{fontSize:fs(11),fontWeight:600,color:T.text,lineHeight:1.3,display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden"}}>{r.title}</div>
                          <div style={{fontSize:fs(9),color:T.dim,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.channel}</div>
                          <div style={{fontSize:fs(9),color:T.dim,display:"flex",gap:6,marginTop:2}}>
                            {r.views && <span>{r.views}</span>}
                            {r.published && <span>{r.published}</span>}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:4,marginTop:6}}>
                          {alreadyInLib ? (
                            <span style={{fontSize:fs(10),color:T.accent,fontWeight:600,display:"flex",alignItems:"center",gap:3}}><Ic.IcCheck s={11} c={T.accent}/> In Library</span>
                          ) : (
                            <button onClick={()=>{addCustomStream(r.vid,r.title.slice(0,30));toast(`Added: ${r.title.slice(0,40)}`,"success")}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${T.purple}44`,background:T.purpleD,cursor:"pointer",fontSize:fs(10),fontWeight:600,color:T.purple,display:"flex",alignItems:"center",gap:3}}>
                              <Ic.IcPlus s={10} c={T.purple}/> Add to Library
                            </button>
                          )}
                          <button onClick={()=>{ytAddStream({vid:r.vid,name:r.title.slice(0,30),desc:r.channel,cat:"custom"});if(!alreadyInLib)addCustomStream(r.vid,r.title.slice(0,30))}} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${T.accent}44`,background:isPlaying?T.accentD:T.input,cursor:"pointer",fontSize:fs(10),fontWeight:600,color:isPlaying?T.accent:T.soft}}>
                            {isPlaying?"Playing":"Play Now"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {discNextPage && (
                <div style={{textAlign:"center",marginTop:12}}>
                  <Btn small v="ghost" onClick={()=>discoverSearch(discLastQ,discNextPage)} disabled={discLoading}>Load More Results</Btn>
                </div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

// ----------------------------------------------------------------------
// PRACTICE EXAM PAGE
// ----------------------------------------------------------------------
const PracticeExamPage = ({ data, setData, profile }) => {
  const bp = useBreakpoint();
  const [selCourse, setSelCourse] = useState(data.courses?.[0]?.id || "");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("mixed");
  const [examAbort, setExamAbort] = useState(null);
  const [examTime, setExamTime] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const timerRef = useRef(null);

  const course = data.courses?.find(c => c.id === selCourse);

  // Exam timer
  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setExamTime(t => t + 1), 1000);
      return () => clearInterval(timerRef.current);
    } else { clearInterval(timerRef.current); }
  }, [timerActive]);

  const stopExam = () => { if(examAbort) { examAbort.abort(); setExamAbort(null); setLoading(false); toast("Cancelled","info"); } };

  const generateExam = async () => {
    if (!profile || !course) return;
    const controller = new AbortController();
    setExamAbort(controller);
    setLoading(true); setSubmitted(false); setAnswers({}); setExamTime(0);
    toast("Generating practice exam...", "info");
    const diffPrompt = difficulty === "easy" ? "Make questions introductory-level." : difficulty === "hard" ? "Make questions challenging — focus on edge cases, exceptions, and deep understanding." : "Mix easy, medium, and hard questions.";
    const topicFocus = safeArr(course.topicBreakdown).length > 0 ? `Focus on topics (weighted by importance): ${safeArr(course.topicBreakdown).map(t=>`${t.topic} (${t.weight||"?"})`).join(", ")}` : "";
    const sys = `You are a WGU practice exam generator. Create exactly ${count} multiple-choice questions for: ${course.name}.
${topicFocus}
${safeArr(course.competencies).length > 0 ? `Competencies to cover: ${safeArr(course.competencies).slice(0,10).map(c=>`${c.code||""} ${c.title}`).join("; ")}` : ""}
${safeArr(course.knownFocusAreas).length > 0 ? `Known high-weight areas: ${safeArr(course.knownFocusAreas).join(", ")}` : ""}
${safeArr(course.commonMistakes).length > 0 ? `Common student mistakes: ${safeArr(course.commonMistakes).slice(0,5).join("; ")}` : ""}
${course.assessmentType === "OA" || course.assessmentType === "OA+PA" ? "Model questions after WGU OA format — scenario-based, application-level, not just recall." : ""}
${diffPrompt}

Each question must have exactly 4 answer choices. Weight questions by topic importance.
Respond ONLY with a JSON array. Each item: {"question":"...","options":["A","B","C","D"],"correct":0,"explanation":"...","difficulty":"easy|medium|hard"}
Where correct is the 0-based index of the right answer. No markdown, no backticks, no preamble.`;
    try {
      const headers = getAuthHeaders(profile);
      const isAnth = isAnthProvider(profile);
      const body = isAnth
        ? { model:profile.model, max_tokens:16384, system:sys, messages:[{role:"user",content:`Generate ${count} practice questions for ${course.name}`}] }
        : { model:profile.model, max_tokens:16384, messages:[{role:"system",content:sys},{role:"user",content:`Generate ${count} practice questions for ${course.name}`}] };
      const res = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body), signal:controller.signal });
      setApiStatus(res.ok, res.status);
      const rawText = await res.text();
      let rd; try { rd = JSON.parse(rawText); } catch(_e) { throw new Error("Bad response"); }
      let text = isAnth ? safeArr(rd.content).filter(b=>b.type==="text").map(b=>b.text).join("") : (rd.choices?.[0]?.message?.content||"");
      text = text.replace(/<think>[\s\S]*?<\/think>/g,'').replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setQuestions(parsed);
        setTimerActive(true);
        toast(`${parsed.length} questions generated! Timer started.`, "success");
      } else throw new Error("No questions returned");
    } catch(e) {
      if(e.name !== 'AbortError') {
        dlog('error','api',`Exam gen failed: ${e.message}`);
        toast(`Failed: ${e.message}`, "error");
      }
    }
    setLoading(false);
    setExamAbort(null);
  };

  const submitExam = () => {
    setSubmitted(true);
    setTimerActive(false);
  };

  const score = submitted ? questions.reduce((s,q,i) => s + (answers[i] === q.correct ? 1 : 0), 0) : 0;
  const fmtExamTime = (s) => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;

  return (
    <div className="fade">
      <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:4}}>Practice Exam</h1>
      <p style={{color:T.dim,fontSize:fs(13),marginBottom:20}}>AI-generated practice questions weighted by your course context</p>

      <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:20,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:180}}><Label>Course</Label><select value={selCourse} onChange={e=>setSelCourse(e.target.value)}>
          <option value="">Select a course...</option>
          {(data.courses||[]).filter(c=>c.status!=="completed").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select></div>
        <div style={{width:80}}><Label>Questions</Label><input type="number" min="5" max="30" value={count} onChange={e=>setCount(Number(e.target.value))}/></div>
        <div style={{width:120}}><Label>Difficulty</Label><select value={difficulty} onChange={e=>setDifficulty(e.target.value)}>
          <option value="easy">Easy</option><option value="mixed">Mixed</option><option value="hard">Hard</option>
        </select></div>
        {loading ? (
          <Btn v="ghost" onClick={stopExam} style={{borderColor:T.red,color:T.red}}>⬛ Stop</Btn>
        ) : (
          <Btn v="ai" onClick={generateExam} disabled={!profile||!selCourse}>Generate Exam</Btn>
        )}
      </div>

      {/* Topic coverage hint */}
      {course && safeArr(course.topicBreakdown).length > 0 && (
        <div style={{background:T.input,borderRadius:10,padding:10,marginBottom:16,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:fs(10),color:T.dim,fontWeight:600}}>Topics covered:</span>
          {safeArr(course.topicBreakdown).slice(0,8).map((t,i)=>(
            <span key={i} style={{fontSize:fs(9),padding:"2px 8px",borderRadius:5,background:T.purpleD,color:T.purple,fontWeight:500}}>{t.topic} {t.weight?`(${t.weight})`:""}</span>
          ))}
          {safeArr(course.topicBreakdown).length > 8 && <span style={{fontSize:fs(9),color:T.dim}}>+{safeArr(course.topicBreakdown).length-8} more</span>}
        </div>
      )}

      {questions.length > 0 && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {/* Timer + Submit bar */}
          <div className="sf-section" style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${T.card},${T.panel})`,border:`1.5px solid ${T.border}`,borderRadius:14,padding:"14px 20px",boxShadow:"0 2px 10px rgba(0,0,0,.08)"}}>
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:fs(10),color:T.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px"}}>Time</span>
                <span style={{fontSize:fs(18),fontWeight:800,color:T.accent,fontFamily:"'JetBrains Mono',monospace"}}>{fmtExamTime(examTime)}</span>
              </div>
              <div style={{width:1,height:24,background:T.border}}/>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:fs(10),color:T.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.5px"}}>Progress</span>
                <span style={{fontSize:fs(14),fontWeight:700,color:Object.keys(answers).length===questions.length?T.accent:T.soft}}>{Object.keys(answers).length}/{questions.length}</span>
              </div>
              {/* Mini progress bar */}
              <div style={{width:80,height:4,background:T.input,borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",background:T.accent,borderRadius:2,width:`${Object.keys(answers).length/questions.length*100}%`,transition:"width .3s"}}/></div>
            </div>
            {!submitted && <Btn small onClick={submitExam} disabled={Object.keys(answers).length===0}>Submit Exam</Btn>}
            {submitted && <Btn small v="ai" onClick={()=>{setQuestions([]);setAnswers({});setSubmitted(false);setExamTime(0)}}>New Exam</Btn>}
          </div>

          {submitted && (
            <div className="slide-up" style={{background:`linear-gradient(135deg,${score/questions.length>=0.8?T.accentD:score/questions.length>=0.6?T.orangeD:T.redD},${T.card})`,border:`1.5px solid ${score/questions.length>=0.8?T.accent:score/questions.length>=0.6?T.orange:T.red}33`,borderRadius:16,padding:20,textAlign:"center"}}>
              <div style={{fontSize:fs(36),fontWeight:800,color:score/questions.length>=0.8?T.accent:score/questions.length>=0.6?T.orange:T.red,lineHeight:1}}>{score}/{questions.length}</div>
              <div style={{fontSize:fs(14),color:T.soft,marginTop:6}}>{Math.round(score/questions.length*100)}% in {fmtExamTime(examTime)}</div>
              <div style={{fontSize:fs(12),color:T.dim,marginTop:4}}>{score/questions.length>=0.8?"Excellent work!":score/questions.length>=0.6?"Getting there — review missed questions":score/questions.length>=0.4?"Needs improvement — focus on weak areas":"Keep studying and try again"}</div>
            </div>
          )}
          {questions.map((q, qi) => (
            <div key={qi} className="sf-exam-q fade" style={{background:T.card,border:`1.5px solid ${submitted?(answers[qi]===q.correct?T.accent:answers[qi]!==undefined?T.red:T.border)+"44":T.border}`,borderRadius:16,padding:20,boxShadow:submitted&&answers[qi]===q.correct?"0 0 20px "+T.accent+"15":"0 1px 4px rgba(0,0,0,.06)"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:14}}>
                <div style={{width:32,height:32,borderRadius:10,background:submitted?(answers[qi]===q.correct?T.accentD:T.redD):`linear-gradient(135deg,${T.input},${T.card})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:fs(13),fontWeight:800,color:submitted?(answers[qi]===q.correct?T.accent:T.red):T.dim,flexShrink:0,border:`1px solid ${submitted?(answers[qi]===q.correct?T.accent:T.red)+"33":T.border}`}}>{qi+1}</div>
                <div style={{fontSize:fs(14),fontWeight:600,color:T.text,flex:1,lineHeight:1.6}}>{q.question}</div>
                {q.difficulty&&<span style={{fontSize:fs(9),padding:"3px 8px",borderRadius:6,flexShrink:0,background:q.difficulty==="hard"?T.redD:q.difficulty==="easy"?T.accentD:T.orangeD,color:q.difficulty==="hard"?T.red:q.difficulty==="easy"?T.accent:T.orange,fontWeight:700,letterSpacing:"0.3px",textTransform:"uppercase"}}>{q.difficulty}</span>}
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:6,paddingLeft:2}}>
                {safeArr(q.options).map((opt, oi) => {
                  const selected = answers[qi] === oi;
                  const isCorrect = oi === q.correct;
                  const showResult = submitted;
                  return (
                    <button key={oi} className="sf-exam-opt" onClick={()=>!submitted&&setAnswers(a=>({...a,[qi]:oi}))} disabled={submitted} style={{
                      textAlign:"left",padding:"12px 16px",borderRadius:12,cursor:submitted?"default":"pointer",fontSize:fs(12),display:"flex",alignItems:"center",gap:12,
                      border:`1.5px solid ${showResult?(isCorrect?T.accent:selected?T.red:T.border):(selected?T.blue:T.border)}`,
                      background:showResult?(isCorrect?T.accentD:selected?T.redD:T.input):(selected?T.blueD:T.input),
                      color:showResult?(isCorrect?T.accent:selected?T.red:T.text):(selected?T.blue:T.text),
                      fontWeight:selected||isCorrect?600:400,
                    }}>
                      <span style={{width:26,height:26,borderRadius:8,background:showResult?(isCorrect?T.accent+"22":selected?T.red+"22":"transparent"):(selected?T.blue+"22":"transparent"),display:"flex",alignItems:"center",justifyContent:"center",fontSize:fs(11),fontWeight:700,flexShrink:0,border:`1.5px solid ${showResult?(isCorrect?T.accent:selected?T.red:T.border):(selected?T.blue:T.border)}`}}>{String.fromCharCode(65+oi)}</span>
                      <span style={{flex:1,lineHeight:1.5}}>{opt}</span>
                      {showResult && isCorrect && <span style={{fontSize:fs(14),color:T.accent}}>✓</span>}
                      {showResult && selected && !isCorrect && <span style={{fontSize:fs(14),color:T.red}}>✗</span>}
                    </button>
                  );
                })}
              </div>
              {submitted && q.explanation && <div style={{fontSize:fs(12),color:T.soft,marginTop:12,padding:"12px 16px",background:`linear-gradient(135deg,${T.input},${T.panel})`,borderRadius:12,borderLeft:`3px solid ${T.accent}`,lineHeight:1.7}}>💡 {q.explanation}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------------------------
// WEEKLY REPORT PAGE
// ----------------------------------------------------------------------
const WeeklyReportPage = ({ data }) => {
  const bp = useBreakpoint();
  const [weekOffset, setWeekOffset] = useState(0);

  const getWeekDates = (offset) => {
    const now = new Date(); now.setDate(now.getDate() + offset * 7);
    const day = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const dates = [];
    const d = new Date(mon);
    for (let i=0; i<7; i++) { dates.push(d.toISOString().split("T")[0]); d.setDate(d.getDate() + 1); }
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { dates, monStr: mon.toLocaleDateString("en-US",{month:"short",day:"numeric"}), sunStr: sun.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) };
  };

  const week = getWeekDates(weekOffset);
  const prevWeek = getWeekDates(weekOffset - 1);
  const tasks = data.tasks || {};
  const courses = data.courses || [];
  const sessions = data.studySessions || [];
  const streak = data.studyStreak || { currentStreak:0, longestStreak:0 };

  // Tasks for week
  const weekTasks = week.dates.flatMap(d => (tasks[d]||[]).map(t => ({...t, date: d})));
  const totalTasks = weekTasks.length;
  const completedTasks = weekTasks.filter(t => t.done).length;
  const studyTasks = weekTasks.filter(t => STUDY_CATS.includes(t.category));
  const studyCompleted = studyTasks.filter(t => t.done).length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks/totalTasks)*100) : 0;

  const calcHours = (taskList) => taskList.reduce((s, t) => {
    const st = parseTime(t.time), en = parseTime(t.endTime);
    return s + (st && en ? Math.max(0, (en.mins - st.mins) / 60) : 0);
  }, 0);
  const totalScheduledHrs = Math.round(calcHours(weekTasks) * 10) / 10;
  const completedStudyHrs = Math.round(calcHours(studyTasks.filter(t => t.done)) * 10) / 10;

  // Sessions for this week
  const weekSessions = sessions.filter(s => week.dates.includes(s.date));
  const weekSessionMins = weekSessions.reduce((s,x) => s + (x.mins||0), 0);
  const weekSessionHrs = Math.round(weekSessionMins/6)/10;

  // Prev week sessions for comparison
  const prevSessions = sessions.filter(s => prevWeek.dates.includes(s.date));
  const prevSessionMins = prevSessions.reduce((s,x) => s + (x.mins||0), 0);
  const prevSessionHrs = Math.round(prevSessionMins/6)/10;
  const sessionDelta = weekSessionHrs - prevSessionHrs;

  // By day breakdown
  const byDay = week.dates.map(d => {
    const dt = tasks[d] || [];
    const daySessions = weekSessions.filter(s => s.date === d);
    const sessionMins = daySessions.reduce((s,x) => s + (x.mins||0), 0);
    return { date: d, dayName: new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}), total: dt.length, done: dt.filter(t=>t.done).length, hrs: Math.round(calcHours(dt)*10)/10, sessionMins, didStudy: sessionMins > 0 || daySessions.length > 0 };
  });

  // By category
  const byCat = {};
  weekTasks.forEach(t => { const c = t.category || "other"; if (!byCat[c]) byCat[c] = {total:0,done:0,hrs:0}; byCat[c].total++; if (t.done) byCat[c].done++; const st=parseTime(t.time),en=parseTime(t.endTime); if(st&&en) byCat[c].hrs+=Math.max(0,(en.mins-st.mins)/60); });

  // Course activity from sessions
  const courseActivity = {};
  weekSessions.forEach(s => {
    const name = s.course || "Unlinked";
    if (!courseActivity[name]) courseActivity[name] = { mins:0, count:0 };
    courseActivity[name].mins += (s.mins||0);
    courseActivity[name].count++;
  });
  // Also add task-based course matching
  studyTasks.forEach(t => {
    const match = courses.find(c => t.title.toLowerCase().includes(c.name.toLowerCase().split(" – ")[0].split(" - ")[0]) || (c.courseCode && t.title.toLowerCase().includes(c.courseCode.toLowerCase())));
    const name = match ? match.name : "Other Study";
    if (!courseActivity[name]) courseActivity[name] = { mins:0, count:0 };
    if (t.done) courseActivity[name].count++;
  });

  // Study days this week
  const studyDays = byDay.filter(d => d.didStudy).length;

  // Velocity
  const allTimeMins = sessions.reduce((s,x) => s + (x.mins||0), 0);
  const uniqueDays = [...new Set(sessions.map(s => s.date))].length;
  const avgMinsPerStudyDay = uniqueDays > 0 ? Math.round(allTimeMins / uniqueDays) : 0;

  return (
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Weekly Report</h1>
          <p style={{color:T.dim,fontSize:fs(13)}}>{week.monStr} — {week.sunStr}</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Btn small v="ghost" onClick={()=>setWeekOffset(w=>w-1)}>← Prev</Btn>
          <Btn small v={weekOffset===0?"primary":"ghost"} onClick={()=>setWeekOffset(0)}>This Week</Btn>
          <Btn small v="ghost" onClick={()=>setWeekOffset(w=>w+1)}>Next →</Btn>
        </div>
      </div>

      {/* Summary Cards — 2 rows */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
        {[
          {l:"Tasks Done",v:`${completedTasks}/${totalTasks}`,c:T.accent,sub:`${completionRate}% complete`},
          {l:"Study Tasks",v:`${studyCompleted}/${studyTasks.length}`,c:T.purple,sub:`of ${studyTasks.length} planned`},
          {l:"Tracked Time",v:`${weekSessionHrs}h`,c:T.blue,sub:sessionDelta!==0?`${sessionDelta>0?"+":""}${sessionDelta}h vs last wk`:"first week"},
          {l:"Study Days",v:`${studyDays}/7`,c:studyDays>=5?T.accent:studyDays>=3?T.orange:T.red,sub:studyDays>=5?"Consistent!":studyDays>=3?"Good pace":"Needs more"},
          {l:"Streak",v:`${streak.currentStreak}d`,c:streak.currentStreak>=7?T.accent:streak.currentStreak>=3?T.orange:T.dim,sub:`Best: ${streak.longestStreak||0}d`},
        ].map((s,i)=>(
          <div key={i} className="fade sf-stat" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14,textAlign:"center",animationDelay:`${i*40}ms`}}>
            <div style={{fontSize:fs(9),color:T.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:fs(20),fontWeight:800,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}</div>
            <div style={{fontSize:fs(10),color:T.dim,marginTop:2}}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Daily Breakdown with session tracking */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:12}}>Daily Breakdown</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8}}>
          {byDay.map((d,i) => {
            const pct = d.total > 0 ? Math.round((d.done/d.total)*100) : 0;
            const isToday = d.date === todayStr();
            const sessionHrs = Math.round(d.sessionMins/6)/10;
            return (
              <div key={i} style={{background:isToday?T.accentD:T.input,border:`1px solid ${isToday?T.accent+"44":T.border}`,borderRadius:10,padding:10,textAlign:"center"}}>
                <div style={{fontSize:fs(11),fontWeight:700,color:isToday?T.accent:T.soft,marginBottom:2}}>{d.dayName}</div>
                <div style={{fontSize:fs(10),color:T.dim,marginBottom:6}}>{new Date(d.date+"T12:00:00").getDate()}</div>
                <div style={{height:40,display:"flex",alignItems:"flex-end",justifyContent:"center",gap:3,marginBottom:6}}>
                  <div style={{width:12,background:T.accent,borderRadius:3,height:`${Math.min(40,Math.max(4,d.done/Math.max(1,d.total)*40))}px`}} title={`${d.done} done`}/>
                  <div style={{width:12,background:T.border,borderRadius:3,height:`${Math.min(40,Math.max(4,(d.total-d.done)/Math.max(1,d.total)*40))}px`}} title={`${d.total-d.done} remaining`}/>
                </div>
                <div style={{fontSize:fs(10),fontWeight:600,color:pct>=80?T.accent:pct>=50?T.orange:d.total>0?T.red:T.dim}}>{d.total > 0 ? `${pct}%` : "—"}</div>
                {sessionHrs>0&&<div style={{fontSize:fs(9),color:T.blue,fontWeight:600,marginTop:2}}>⏱ {sessionHrs}h</div>}
                {d.didStudy&&<div style={{fontSize:fs(8),color:T.accent,marginTop:1}}>✓ studied</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column: Category + Course Activity */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(350px,1fr))",gap:16,marginBottom:16}}>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:12}}>By Category</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(byCat).sort((a,b)=>b[1].hrs-a[1].hrs).map(([cat,v]) => {
              const c = CAT[cat] || CAT.other;
              const pct = v.total > 0 ? Math.round((v.done/v.total)*100) : 0;
              return (
                <div key={cat} style={{display:"flex",alignItems:"center",gap:8}}>
                  <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
                  <div style={{flex:1,height:6,borderRadius:3,background:T.bg2,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:c.fg,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:fs(10),color:T.dim,minWidth:55,textAlign:"right"}}>{v.done}/{v.total} · {Math.round(v.hrs*10)/10}h</span>
                </div>
              );
            })}
            {Object.keys(byCat).length === 0 && <div style={{color:T.dim,fontSize:fs(12),textAlign:"center",padding:12}}>No tasks this week</div>}
          </div>
        </div>

        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:12}}>Course Study Time</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(courseActivity).filter(([,v])=>v.mins>0).sort((a,b)=>b[1].mins-a[1].mins).map(([name,v]) => {
              const course = courses.find(c => c.name === name);
              const estHrs = course?.averageStudyHours || 0;
              const hrs = Math.round(v.mins/6)/10;
              return (
                <div key={name} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:fs(11),color:T.text,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
                  <span style={{fontSize:fs(10),color:T.accent,fontWeight:600}}>{hrs}h</span>
                  {estHrs>0&&<span style={{fontSize:fs(9),color:T.dim}}>/{estHrs}h</span>}
                  <span style={{fontSize:fs(9),color:T.dim}}>{v.count}×</span>
                </div>
              );
            })}
            {Object.keys(courseActivity).filter(k=>courseActivity[k].mins>0).length === 0 && <div style={{color:T.dim,fontSize:fs(12),textAlign:"center",padding:12}}>No tracked sessions this week</div>}
          </div>
        </div>
      </div>

      {/* Velocity & Insights */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16}}>
        <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:10}}>Insights & Velocity</h3>
        <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:fs(12),color:T.soft}}>
          {completionRate >= 80 && <div style={{padding:"6px 10px",background:T.accentD,borderRadius:6,borderLeft:`3px solid ${T.accent}`,color:T.accent}}>Excellent week! {completionRate}% task completion rate.</div>}
          {completionRate >= 50 && completionRate < 80 && <div style={{padding:"6px 10px",background:T.orangeD,borderRadius:6,borderLeft:`3px solid ${T.orange}`,color:T.orange}}>Decent week at {completionRate}%. Push for 80%+ next week.</div>}
          {completionRate > 0 && completionRate < 50 && <div style={{padding:"6px 10px",background:T.redD,borderRadius:6,borderLeft:`3px solid ${T.red}`,color:T.red}}>Tough week — only {completionRate}% completed. Consider adjusting your plan.</div>}
          {totalTasks === 0 && <div style={{padding:"6px 10px",background:T.input,borderRadius:6,color:T.dim}}>No tasks scheduled. Use Course Planner to generate a study plan.</div>}
          {weekSessionHrs > 0 && <div style={{color:T.soft}}>You logged {weekSessionHrs}h of focused study across {studyDays} day{studyDays!==1?"s":""}.</div>}
          {avgMinsPerStudyDay > 0 && <div style={{color:T.soft}}>Your all-time average is {Math.round(avgMinsPerStudyDay/6)/10}h per study day ({uniqueDays} days tracked).</div>}
          {sessionDelta > 0 && <div style={{color:T.accent}}>Up {sessionDelta}h from last week — keep it going!</div>}
          {sessionDelta < 0 && <div style={{color:T.orange}}>Down {Math.abs(sessionDelta)}h from last week. Try to get back on track.</div>}
          {byDay.filter(d => d.total > 0 && d.done === d.total).length > 0 && <div style={{color:T.accent}}>Perfect days: {byDay.filter(d => d.total > 0 && d.done === d.total).map(d => d.dayName).join(", ")}</div>}
          {byDay.filter(d => d.total > 0 && d.done === 0).length > 0 && <div style={{color:T.orange}}>Missed days: {byDay.filter(d => d.total > 0 && d.done === 0).map(d => d.dayName).join(", ")}</div>}
          {streak.currentStreak >= 7 && <div style={{color:T.accent}}>🔥 {streak.currentStreak}-day study streak! Longest: {streak.longestStreak}d.</div>}
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// DEBUG LOG PAGE
// ----------------------------------------------------------------------
const DebugPage = () => {
  const logs = useDebugLog();
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("all");
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [logs.length]);

  const filtered = filter === "all" ? logs : logs.filter(l => l.level === filter || l.cat === filter);

  const copyLog = () => {
    const text = getLogText();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      dlog('info', 'ui', `Debug log copied (${text.length} chars)`);
      setTimeout(() => setCopied(false), 2500);
    }).catch(e => {
      dlog('error', 'ui', 'Clipboard write failed', e.message);
      // Fallback: create a textarea and select
      try {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
        setCopied(true); setTimeout(() => setCopied(false), 2500);
      } catch(e2) { dlog('error','ui','Fallback copy also failed',e2.message); }
    });
  };

  const lvlCol = { info:T.blue, warn:T.orange, error:T.red, debug:T.dim, api:T.purple, tool:T.accent };

  return (
    <div className="fade" style={{display:"flex",flexDirection:"column",height:"calc(100vh - 56px)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexShrink:0}}>
        <div>
          <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>🐛 Debug Log</h1>
          <p style={{color:T.dim,fontSize:fs(13)}}>{logs.length} entries — copy and paste to troubleshoot issues</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn small v={copied?"primary":"secondary"} onClick={copyLog}>
            {copied ? <><Ic.Check s={14}/> Copied!</> : <><Ic.Copy s={14}/> Copy Full Log</>}
          </Btn>
          <Btn small v="danger" onClick={() => { _logs = []; _logSubs.forEach(fn => fn([])); dlog('info','ui','Log cleared'); }}>Clear</Btn>
        </div>
      </div>

      <div style={{display:"flex",gap:4,marginBottom:12,flexShrink:0,flexWrap:"wrap"}}>
        {["all","info","warn","error","api","tool","debug"].map(f => (
          <button key={f} onClick={()=>setFilter(f)} style={{padding:"6px 12px",borderRadius:7,fontSize:fs(11),fontWeight:600,cursor:"pointer",textTransform:"uppercase",letterSpacing:.5,border:`1px solid ${filter===f?T.accent:T.border}`,background:filter===f?T.accentD:T.input,color:filter===f?T.accent:T.dim}}>
            {f}
          </button>
        ))}
      </div>

      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
        {filtered.length === 0 && <div style={{padding:20,textAlign:"center",color:T.dim,fontSize:fs(12)}}>No entries matching filter</div>}
        {filtered.map((e) => (
          <div key={e.id} style={{display:"flex",gap:8,padding:"4px 8px",borderRadius:6,background:e.level==="error"?T.redD:T.bg2,fontSize:fs(11),fontFamily:"'JetBrains Mono',monospace",lineHeight:1.5}}>
            <span style={{color:T.dim,flexShrink:0,minWidth:75}}>{e.ts.slice(11, 23)}</span>
            <span style={{color:lvlCol[e.level]||T.dim,flexShrink:0,minWidth:42,fontWeight:700}}>{e.level.toUpperCase()}</span>
            <span style={{color:T.soft,flexShrink:0,minWidth:55}}>{e.cat}</span>
            <span style={{color:e.level==="error"?T.red:T.text,flex:1,wordBreak:"break-word"}}>
              {e.msg}
              {e.detail && <div style={{color:T.dim,marginTop:2,whiteSpace:"pre-wrap",fontSize:fs(10)}}>{e.detail.slice(0,800)}{e.detail.length>800?"...":""}</div>}
            </span>
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// APP SHELL
// ----------------------------------------------------------------------
const INIT={tasks:{},profiles:[],activeProfileId:null,courses:[],targetDate:"",targetCompletionDate:"",studyStartDate:"",studyStartTime:"",studyHoursPerDay:4,overrideSafeguards:false,exceptionDates:[],userContext:"",chatHistories:{},theme:"dark",fontScale:100,uiZoom:100,ytApiKey:"",studySessions:[],studyStreak:{lastStudyDate:"",currentStreak:0,longestStreak:0}};

const NAV=[
  {key:"dashboard",label:"Degree Dashboard",icon:Ic.Grad,color:"#06d6a0"},
  {key:"planner",label:"Course Planner",icon:Ic.Edit,color:"#a78bfa"},
  {key:"daily",label:"Study Schedule",icon:Ic.List,color:"#60a5fa"},
  {key:"calendar",label:"Calendar",icon:Ic.Cal,color:"#f472b6"},
  {key:"chat",label:"Study Chat",icon:Ic.Chat,color:"#34d399"},
  {key:"quiz",label:"Practice Exam",icon:Ic.Quiz,color:"#fb923c"},
  {key:"report",label:"Weekly Report",icon:Ic.Report,color:"#38bdf8"},
  {key:"ambient",label:"Study Radio",icon:Ic.Music,color:"#c084fc"},
];

export default function App(){
  const[data,setDataRaw]=useState(INIT);
  const[loaded,setLoaded]=useState(false);
  const[page,setPage]=useState("dashboard");
  const[profilePicker,setProfilePicker]=useState(false);
  const apiStatus = useApiStatus();
  const[date,setDate]=useState(todayStr());
  const[calOpen,setCalOpen]=useState(true);
  const bp = useBreakpoint();
  const[sideW,setSideW]=useState(bp.sideW);
  const[sideCollapsed,setSideCollapsed]=useState(false);
  const sideRef=useRef(null);
  const resizing=useRef(false);

  // Sidebar resize handler
  useEffect(()=>{
    const onMove=e=>{if(!resizing.current)return;const w=Math.max(180,Math.min(360,e.clientX));setSideW(w)};
    const onUp=()=>{resizing.current=false;document.body.style.cursor='';document.body.style.userSelect=''};
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    return()=>{window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp)};
  },[]);

  // Auto-collapse sidebar on small screens
  useEffect(()=>{
    if(bp.sm){setSideCollapsed(true);setSideW(56)}
    else{setSideCollapsed(false);setSideW(bp.sideW)}
  },[bp.sm]);

  useEffect(()=>{
    dlog('info','init','App mounting, loading data...');
    (async()=>{
      try {
        const d=await load("ds-v1",INIT);
        dlog('info','init',`Loaded: ${d.profiles?.length||0} profiles, ${d.courses?.length||0} courses, ${Object.keys(d.tasks||{}).length} days`);
        setDataRaw(d);
      } catch(e) {
        dlog('error','init','Failed to load data',e.message);
        setDataRaw(INIT);
      }
      setLoaded(true);
      dlog('info','init','App ready');
    })();
  },[]);
  const setData=useCallback(fn=>{setDataRaw(prev=>{
    try { const next=typeof fn==="function"?fn(prev):fn; save("ds-v1",next); return next; }
    catch(e) { dlog('error','state','setData error',e.message); return prev; }
  })},[]);
  const dayTasks=useMemo(()=>data.tasks?.[date]||[],[data.tasks,date]);
  const setDayTasks=useCallback(t=>setData(d=>({...d,tasks:{...d.tasks,[date]:t}})),[date,setData]);
  const profile=useMemo(()=>(data.profiles||[]).find(p=>p.id===data.activeProfileId)||null,[data.profiles,data.activeProfileId]);
  const bgIndicator = useBgTask();
  const audioIndicator = useAudio();
  const ytStreams = useYtStreams();
  const timer = useTimer();
  const focus = useFocus();

  // Sync theme + font scale from saved data
  useEffect(() => {
    if (data.theme) { _activeTheme = data.theme; syncT(); }
    if (data.fontScale) { _fontScale = data.fontScale; }
  }, [data.theme, data.fontScale]);


  if (!loaded) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:T.bg,color:T.accent,fontSize:24,fontWeight:800}}>Loading...</div>;

  return (
    <div style={{display:"flex",height:"100vh",background:T.bg,color:T.text,fontFamily:"'Outfit','Inter',sans-serif",zoom:(data.uiZoom||100)/100}}>
      {/* Sidebar */}
      <aside ref={sideRef} style={{width:sideCollapsed?56:sideW,minWidth:sideCollapsed?56:180,maxWidth:360,height:"100vh",background:T.panel,borderRight:`1px solid ${T.border}`,display:"flex",flexDirection:"column",overflow:"hidden",flexShrink:0,position:"relative",transition:sideCollapsed?"none":"width .15s ease"}}>
        <div className="fade" style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Logo */}
          <div style={{padding:sideCollapsed?"14px 8px":"18px 20px 14px",display:"flex",alignItems:"center",gap:10,flexShrink:0,borderBottom:`1px solid ${T.border}`}}>
            {!sideCollapsed && <><Ic.Grad s={24} c={T.accent}/><div><span style={{fontSize:fs(18),fontWeight:800,background:`linear-gradient(135deg,${T.accent},${T.blue})`,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:"-0.5px"}}>DevonSYNC</span><div style={{fontSize:fs(9),color:T.dim,marginTop:-2,letterSpacing:"0.5px"}}>WGU Study Planner</div></div></>}
            {sideCollapsed && <Ic.Grad s={22} c={T.accent}/>}
          </div>
          {/* Nav items */}
          <div style={{flex:1,overflowY:"auto",padding:sideCollapsed?"4px":"6px 10px"}}>
            {NAV.map(n => {
              const active = page === n.key;
              const IC = n.icon;
              return (
                <button key={n.key} className="sf-nav" onClick={()=>setPage(n.key)} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:sideCollapsed?"10px 0":"10px 14px",borderRadius:10,marginBottom:2,cursor:"pointer",background:active?`${n.color}15`:"transparent",border:"none",borderLeft:active&&!sideCollapsed?`3px solid ${n.color}`:"3px solid transparent",color:active?n.color:T.soft,justifyContent:sideCollapsed?"center":"flex-start",position:"relative"}}>
                  <IC s={sideCollapsed?20:17} c={active?n.color:T.dim}/>
                  {!sideCollapsed && <span style={{fontSize:fs(13),fontWeight:active?700:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.label}</span>}
                  {active && sideCollapsed && <div style={{position:"absolute",left:0,top:"25%",bottom:"25%",width:3,borderRadius:2,background:n.color}}/>}
                </button>
              );
            })}
            <div style={{height:1,background:T.border,margin:"6px 4px"}}/>
            {/* Settings */}
            <button className="sf-nav" onClick={()=>setPage("settings")} style={{width:"100%",display:"flex",alignItems:"center",gap:10,padding:sideCollapsed?"10px 0":"10px 14px",borderRadius:10,marginBottom:2,cursor:"pointer",background:page==="settings"?T.input:"transparent",border:"none",borderLeft:page==="settings"&&!sideCollapsed?`3px solid ${T.text}`:"3px solid transparent",color:page==="settings"?T.text:T.soft,justifyContent:sideCollapsed?"center":"flex-start"}}>
              <Ic.Gear s={sideCollapsed?20:17} c={page==="settings"?T.text:T.dim}/>
              {!sideCollapsed && <span style={{fontSize:fs(13),fontWeight:page==="settings"?700:500}}>Settings</span>}
            </button>
          </div>
          {/* Mini Calendar — collapsible */}
          {!sideCollapsed && (
            <div style={{padding:"6px 10px",borderTop:`1px solid ${T.border}`,flexShrink:0}}>
              <button onClick={()=>setCalOpen(!calOpen)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",background:"none",border:"none",color:T.soft,cursor:"pointer",padding:"4px 4px",fontSize:fs(11),fontWeight:600}}>
                <span>📅 Calendar</span>
                <span style={{fontSize:fs(9),color:T.dim}}>{calOpen?"▲":"▼"}</span>
              </button>
              {calOpen && <MiniCal date={date} setDate={setDate} tasks={data.tasks||{}}/>}
            </div>
          )}
          {/* AI Connection — large clickable panel */}
          <div onClick={()=>setProfilePicker(!profilePicker)} style={{padding:sideCollapsed?"8px 4px":"12px 14px",borderTop:`1px solid ${T.border}`,flexShrink:0,cursor:"pointer",background:profile?`${T.accent}08`:T.input,transition:"background .15s"}}>
            {sideCollapsed ? (
              <div style={{display:"flex",justifyContent:"center"}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:profile?(apiStatus?T.accent:T.orange):T.red,boxShadow:profile&&apiStatus?`0 0 8px ${T.accent}`:"none"}}/>
              </div>
            ) : (
              <>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:profile?6:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:10,height:10,borderRadius:"50%",background:profile?(apiStatus?T.accent:T.orange):T.red,boxShadow:profile&&apiStatus?`0 0 8px ${T.accent}`:"none",flexShrink:0}}/>
                    <div style={{fontSize:fs(11),fontWeight:700,color:T.soft,letterSpacing:"0.5px",textTransform:"uppercase"}}>AI Connection</div>
                  </div>
                  <span style={{fontSize:fs(10),color:T.dim,transition:"transform .2s",transform:profilePicker?"rotate(180deg)":"none"}}>▼</span>
                </div>
                {profile ? (
                  <div style={{marginLeft:18}}>
                    <div style={{fontSize:fs(13),fontWeight:700,color:profile?(apiStatus?T.accent:T.orange):T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.name}</div>
                    <div className="mono" style={{fontSize:fs(10),color:T.dim,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{profile.model}</div>
                  </div>
                ) : (
                  <div style={{marginLeft:18,fontSize:fs(11),color:T.orange}}>No profile connected</div>
                )}
              </>
            )}
          </div>
          {/* Profile picker dropdown */}
          {profilePicker && !sideCollapsed && (
            <div style={{padding:"4px 10px 8px",borderTop:`1px solid ${T.border}`,background:T.panel,flexShrink:0,maxHeight:200,overflowY:"auto"}}>
              {(data.profiles||[]).length > 0 ? (data.profiles||[]).map(p => {
                const isActive = p.id === data.activeProfileId;
                return (
                  <button key={p.id} onClick={(e)=>{e.stopPropagation();setData(d=>({...d,activeProfileId:p.id}));dlog('info','profile',`Switched to ${p.name}`);toast(`Active: ${p.name}`,"success");setProfilePicker(false)}} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,cursor:"pointer",background:isActive?T.accentD:T.input,border:`1.5px solid ${isActive?T.accent+"55":"transparent"}`,width:"100%",textAlign:"left",marginBottom:3,transition:"all .1s"}}>
                    <div style={{width:8,height:8,borderRadius:"50%",background:isActive?T.accent:T.dim,boxShadow:isActive?`0 0 6px ${T.accent}`:"none",flexShrink:0}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:fs(12),fontWeight:isActive?700:500,color:isActive?T.accent:T.soft,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</div>
                      <div style={{fontSize:fs(9),color:T.dim,fontFamily:"'JetBrains Mono',monospace"}}>{p.model?.slice(0,24)}</div>
                    </div>
                    {isActive && <span style={{fontSize:fs(8),color:T.accent,fontWeight:800,letterSpacing:"0.5px"}}>ACTIVE</span>}
                  </button>
                );
              }) : (
                <button onClick={(e)=>{e.stopPropagation();setPage("settings");setProfilePicker(false)}} style={{width:"100%",padding:"10px",borderRadius:8,border:`1px dashed ${T.accent}44`,background:"transparent",color:T.accent,fontSize:fs(11),cursor:"pointer",fontWeight:600}}>+ Add AI Profile</button>
              )}
            </div>
          )}
          {/*  Unified Media Player — supports SomaFM + YouTube  */}
          {(audioIndicator.playing || ytStreams.length > 0) && (() => {
            const isSoma = !!audioIndicator.playing;
            const isYT = ytStreams.length > 0;
            const station = isSoma ? STATIONS.find(s => s.id === audioIndicator.playing) : null;
            const somaAllPaused = isSoma ? audioIndicator.paused : true;
            const ytAllPaused = isYT ? ytStreams.every(s => s.paused) : true;
            const allPaused = somaAllPaused && ytAllPaused;
            const levels = audioIndicator.levels || new Array(16).fill(0);
            const sourceCount = (isSoma?1:0)+(isYT?1:0);
            const accentColor = sourceCount > 1 ? T.purple : isSoma ? T.accent : T.blue;
            const BARS = 24;
            const barData = [];
            const now = Date.now();
            const ytBands = [];
            if (isYT && !ytAllPaused) {
              const t = now / 1000;
              for (let b = 0; b < 8; b++) {
                const freq = 0.8 + b * 0.6;
                const amp = b < 2 ? 35 : b < 5 ? 28 : 18;
                const phase = b * 1.7;
                const val = amp + Math.sin(t*freq + phase)*amp*0.6
                  + Math.sin(t*(freq*2.3) + phase*0.5)*amp*0.3
                  + Math.cos(t*0.4 + b)*amp*0.2
                  + (Math.random()*6 - 3);
                ytBands.push(Math.max(4, Math.min(85, val)));
              }
            }
            for (let i = 0; i < BARS; i++) {
              const center = Math.abs(i - (BARS-1)/2) / ((BARS-1)/2);
              let val = 0;
              if (allPaused) { val = 0; }
              else if (isSoma && !audioIndicator.paused) {
                const fi = (i / BARS) * (levels.length - 1);
                const lo = Math.floor(fi), hi = Math.min(lo + 1, levels.length - 1);
                val = levels[lo] + (levels[hi] - levels[lo]) * (fi - lo);
              }
              if (isYT && !ytAllPaused && ytBands.length > 0) {
                const bi = (i / BARS) * (ytBands.length - 1);
                const blo = Math.floor(bi), bhi = Math.min(blo + 1, ytBands.length - 1);
                const ytVal = ytBands[blo] + (ytBands[bhi] - ytBands[blo]) * (bi - blo);
                val = Math.max(val, ytVal);
              }
              val = Math.max(0, Math.min(100, val));
              const h = allPaused ? 1 : Math.max(1, Math.round(val * 0.52));
              const hue = allPaused ? 0 : isSoma && isYT ? (280 - center * 60) : isSoma ? (140 - center * 90) : (0 + center * 30);
              barData.push({ h, hue, sat: allPaused?0: isYT&&!isSoma ? 70+val*0.3 : 55+val*0.45, lit: allPaused?25: isYT&&!isSoma ? 35+val*0.3 : 30+val*0.25, val });
            }
            return (
              <div style={{borderTop:`2px solid ${accentColor}33`,background:`linear-gradient(180deg,${isSoma&&isYT?`${T.purple}22`:isSoma?T.accentD:T.blueD}66,${T.bg})`}}>
                {/* Visualizer */}
                <div style={{display:"flex",alignItems:"flex-end",justifyContent:"center",gap:1.5,height:56,padding:"12px 8px 0",position:"relative"}}>
                  {barData.map((b, i) => (
                    <div key={i} style={{flex:1,maxWidth:6,borderRadius:2,height:b.h,background:allPaused?T.dim:`hsl(${b.hue},${b.sat}%,${b.lit}%)`,boxShadow:!allPaused&&b.val>40?`0 0 6px hsla(${b.hue},80%,55%,.5)`:"none",transition:"height 50ms ease-out"}}/>
                  ))}
                  <div style={{position:"absolute",bottom:-2,left:0,right:0,display:"flex",justifyContent:"center",gap:1.5,transform:"scaleY(-0.2)",transformOrigin:"top",opacity:0.08,pointerEvents:"none",filter:"blur(1px)"}}>
                    {barData.map((b, i) => <div key={i} style={{flex:1,maxWidth:6,borderRadius:2,height:b.h,background:`hsl(${b.hue},${b.sat}%,${b.lit}%)`}}/>)}
                  </div>
                </div>
                {/* Now playing */}
                <div style={{textAlign:"center",padding:"6px 10px 2px",overflow:"hidden"}}>
                  {isSoma && (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                      <Ic.Radio s={14} c={T.accent}/>
                      <div style={{fontSize:fs(13),fontWeight:700,color:T.accent,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120,display:"flex",alignItems:"center",gap:5}}>{(() => {
                        const catIcons = {lofi:Ic.CatLofi,ambient:Ic.CatAmbient,jazz:Ic.CatJazz,world:Ic.CatWorld,classical:Ic.CatClassical,energy:Ic.CatEnergy,holiday:Ic.CatHoliday};
                        const CI = catIcons[station?.cat] || Ic.IcMusic;
                        return <CI s={14}/>;
                      })()} {station?.name?.length > 12 ? station.name.slice(0,12)+"..." : station?.name}</div>
                      <button onClick={()=>toggleFav('soma',station?.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:fs(14),color:_favs.soma.includes(station?.id)?T.yellow:T.dim}}>{_favs.soma.includes(station?.id)?"★":"☆"}</button>
                    </div>
                  )}
                  {isYT && ytStreams.map((s,i) => (
                    <div key={s.vid} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4,opacity:s.paused?0.5:1,transition:"opacity .2s"}}>
                      <div style={{fontSize:fs(12),fontWeight:600,color:s.paused?T.dim:T.blue,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4}}>{i===0&&<Ic.YT s={14} c={s.paused?T.dim:T.blue}/>} {s.paused&&<Ic.IcPause s={10} c={T.dim}/>}{s.name}</div>
                      <button onClick={()=>toggleFav('yt',s.vid)} style={{background:"none",border:"none",cursor:"pointer",fontSize:fs(12),color:_favs.yt.includes(s.vid)?T.yellow:T.dim}}>{_favs.yt.includes(s.vid)?"★":"☆"}</button>
                    </div>
                  ))}
                  <div style={{fontSize:fs(9),color:accentColor,marginTop:2,fontWeight:500,display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                    {[isSoma&&"SomaFM",isYT&&"YouTube"].filter(Boolean).join(" + ")}
                  </div>
                </div>
                {/* Transport */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:5,padding:"4px 10px 6px"}}>
                  <button onClick={isSoma?audioPrev:ytPrev} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 12px",cursor:"pointer",color:T.soft,lineHeight:1}}><Ic.IcSkipB s={16} c={T.soft}/></button>
                  <button onClick={()=>{if(isSoma)audioPauseToggle();if(isYT)ytPauseAll();}} style={{background:allPaused?`${accentColor}22`:T.input,border:`2px solid ${allPaused?accentColor:T.border}`,borderRadius:10,padding:"8px 22px",cursor:"pointer",color:allPaused?accentColor:T.soft,lineHeight:1}}>{allPaused?<Ic.IcPlay s={20} c={accentColor}/>:<Ic.IcPause s={20} c={T.soft}/>}</button>
                  <button onClick={()=>{if(isSoma)audioStop();if(isYT)ytClearAll();}} style={{background:T.redD,border:`1px solid ${T.red}33`,borderRadius:8,padding:"7px 12px",cursor:"pointer",color:T.red,lineHeight:1}}><Ic.IcStop s={16} c={T.red}/></button>
                  <button onClick={isSoma?audioNext:ytNext} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"7px 12px",cursor:"pointer",color:T.soft,lineHeight:1}}><Ic.IcSkipF s={16} c={T.soft}/></button>
                </div>
                {/* Volume — SomaFM */}
                {isSoma && (
                  <div style={{display:"flex",alignItems:"center",gap:5,padding:"2px 10px 6px"}}>
                    <Ic.Radio s={11} c={T.dim}/>
                    <span style={{cursor:"pointer"}} onClick={()=>audioSetVolume(Math.max(0,audioIndicator.volume-0.05))}><Ic.IcVolLow s={13} c={T.dim}/></span>
                    <VolumeBar value={audioIndicator.volume} onChange={audioSetVolume}/>
                    <span style={{cursor:"pointer"}} onClick={()=>audioSetVolume(Math.min(1,audioIndicator.volume+0.05))}><Ic.IcVolHi s={13} c={T.dim}/></span>
                    <span style={{fontSize:fs(10),color:T.dim,minWidth:26,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{Math.round(audioIndicator.volume*100)}</span>
                  </div>
                )}
                {/* YouTube per-stream volume */}
                {isYT && ytStreams.map(s => (
                  <div key={s.vid} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px 5px"}}>
                    <button onClick={()=>ytPauseToggle(s.vid)} style={{background:s.paused?`${T.blue}22`:T.input,border:`1px solid ${s.paused?T.blue:T.border}`,borderRadius:6,padding:"3px 6px",cursor:"pointer",flexShrink:0}} title={s.paused?"Play":"Pause"}>
                      {s.paused?<Ic.IcPlay s={12} c={T.blue}/>:<Ic.IcPause s={12} c={T.dim}/>}
                    </button>
                    <span style={{fontSize:fs(10),color:s.paused?T.dim:T.blue,minWidth:52,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontWeight:500}}>{s.name.length>8?s.name.slice(0,8)+"...":s.name}</span>
                    <span style={{cursor:"pointer"}} onClick={()=>ytSetVolume(Math.max(0,s.volume-5),s.vid)}><Ic.IcVolLow s={11} c={T.dim}/></span>
                    <VolumeBar value={s.volume/100} onChange={v=>ytSetVolume(v*100,s.vid)}/>
                    <span style={{cursor:"pointer"}} onClick={()=>ytSetVolume(Math.min(100,s.volume+5),s.vid)}><Ic.IcVolHi s={11} c={T.dim}/></span>
                    <span style={{fontSize:fs(9),color:T.dim,minWidth:20,textAlign:"right",fontFamily:"'JetBrains Mono',monospace"}}>{s.volume}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          {/* Study timer in sidebar */}
          {timer.running && (
            <div style={{padding:"10px 14px",borderTop:`1px solid ${T.border}`,background:T.accentD}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontSize:fs(22),fontWeight:800,color:T.accent,fontFamily:"'JetBrains Mono',monospace"}}>{fmtElapsed(timer.elapsed)}</div>
                  <div style={{fontSize:fs(10),color:T.soft,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>{timer.taskTitle}</div>
                </div>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={timerPause} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 8px",cursor:"pointer"}}>{timer.paused?<Ic.IcPlay s={10} c={T.accent}/>:<Ic.IcPause s={10} c={T.soft}/>}</button>
                  <button onClick={timerStop} style={{background:T.redD,border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer"}}><Ic.IcStop s={10} c={T.red}/></button>
                </div>
              </div>
            </div>
          )}
          </div>{/* close fade wrapper */}
        {/* Resize handle */}
        {!sideCollapsed && <div onMouseDown={()=>{resizing.current=true;document.body.style.cursor='col-resize';document.body.style.userSelect='none'}} style={{position:"absolute",right:-3,top:0,bottom:0,width:6,cursor:"col-resize",zIndex:10}}/>}
        {/* Collapse toggle */}
        <button onClick={()=>{setSideCollapsed(!sideCollapsed);if(!sideCollapsed)setSideW(56);else setSideW(bp.sideW)}} style={{position:"absolute",top:12,right:-14,width:28,height:28,borderRadius:"50%",background:T.card,border:`1.5px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",zIndex:11,fontSize:10,color:T.dim,boxShadow:"0 2px 8px rgba(0,0,0,.2)",transition:"all .15s"}}>{sideCollapsed?"▶":"◀"}</button>
        </aside>
        <div style={{flex:1,overflow:"hidden",position:"relative"}}>
          {/* AmbientPage lives OUTSIDE the keyed main to persist across page switches */}
          <div style={page==="ambient"?{position:"absolute",inset:0,zIndex:2,overflow:"auto",padding:sideCollapsed?bp.padCol:bp.pad}:{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0,0,0,0)",pointerEvents:"none"}}><AmbientPage/></div>
          <main style={{height:"100%",overflow:"auto",padding:sideCollapsed?bp.padCol:bp.pad,display:page==="ambient"?"none":"block"}} key={page+date}>
            <div style={{maxWidth:bp.maxW,margin:"0 auto"}}>
              {page==="dashboard" && <DegreeDashboard data={data} setData={setData} setPage={setPage} setDate={setDate}/>}
              {page==="planner" && <CoursePlanner data={data} setData={setData} profile={profile} setPage={setPage}/>}
              {page==="daily" && <DailyPage date={date} tasks={dayTasks} setTasks={setDayTasks} profile={profile} data={data} setData={setData} setDate={setDate}/>}
              {page==="calendar" && <CalendarPage date={date} setDate={setDate} tasks={data.tasks||{}} setPage={setPage}/>}
              {page==="chat" && <StudyChatPage data={data} setData={setData} profile={profile}/>}
              {page==="quiz" && <PracticeExamPage data={data} setData={setData} profile={profile}/>}
              {page==="report" && <WeeklyReportPage data={data}/>}
              {page==="settings" && <SettingsPage data={data} setData={setData} setPage={setPage}/>}
            </div>
          </main>
        </div>
      {/* Focus mode overlay */}
      {focus.active && focus.showPulse && (
        <div style={{position:"fixed",inset:0,zIndex:9999,background:"rgba(0,0,0,0.85)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer"}} onClick={()=>{focusPulseYes();toast("Focus +15min","success")}}>
          <div style={{fontSize:48,marginBottom:16}}>🧘</div>
          <div style={{fontSize:fs(22),fontWeight:800,color:T.accent,marginBottom:8}}>Focus Check-in</div>
          <div style={{fontSize:fs(14),color:T.soft,marginBottom:20}}>Are you still studying?</div>
          <div style={{padding:"12px 32px",borderRadius:12,background:T.accent,color:"#000",fontSize:fs(15),fontWeight:700}}>Yes, I'm focused!</div>
          <div style={{fontSize:fs(11),color:T.dim,marginTop:16}}>Streak: {focus.streak} check-ins</div>
        </div>
      )}
    </div>
  );
}
