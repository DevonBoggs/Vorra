// DevonSYNC v7.3.0 — WGU Study Planner
// Restructured App Shell — imports from extracted modules

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Systems ────────────────────────────────────────────────────────
import { dlog } from "./systems/debug.js";
import { INIT, load, save } from "./systems/storage.js";
import { useTheme, fs, setTheme as setThemeGlobal, setFontScale, getThemeName } from "./styles/tokens.js";
import { toast, useToasts } from "./systems/toast.js";
import { useBreakpoint } from "./systems/breakpoint.js";
import { useTimer, timerStop, timerPause, fmtElapsed } from "./systems/timer.js";
import { useFocus, focusPulseYes } from "./systems/focus.js";
import { useApiStatus, APP_VERSION } from "./systems/api.js";
import { STATIONS, useAudio, audioStop, audioPauseToggle, audioSetVolume, audioNext, audioPrev } from "./systems/audio.js";
import { useYtStreams, ytPauseToggle, ytPauseAll, ytSetVolume, ytClearAll, ytNext, ytPrev, useFavs, toggleFav } from "./systems/youtube.js";

// ── Components ─────────────────────────────────────────────────────
import Ic from "./components/icons/index.jsx";
import { VolumeBar } from "./components/ui/VolumeBar.jsx";
import { Label } from "./components/ui/Label.jsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.jsx";

// ── Constants ──────────────────────────────────────────────────────
import { NAV } from "./constants/nav.js";
// categories used by page components via props

// ── Pages ──────────────────────────────────────────────────────────
import { MiniCal } from "./pages/Calendar/MiniCal.jsx";
import { CalendarPage } from "./pages/Calendar/CalendarPage.jsx";
import { WeeklyReportPage } from "./pages/Report/WeeklyReportPage.jsx";
import { PracticeExamPage } from "./pages/Quiz/PracticeExamPage.jsx";
import { DailyPage } from "./pages/Daily/DailyPage.jsx";
import { DegreeDashboard } from "./pages/Dashboard/DegreeDashboard.jsx";
import { CoursePlanner } from "./pages/Planner/CoursePlanner.jsx";
import { StudyChatPage } from "./pages/Chat/StudyChatPage.jsx";
import { SettingsPage } from "./pages/Settings/SettingsPage.jsx";
import { AmbientPage } from "./pages/Ambient/AmbientPage.jsx";

// ── Utilities ──────────────────────────────────────────────────────
import { todayStr } from "./utils/helpers.js";

// ── Init logging ───────────────────────────────────────────────────
dlog('info', 'init', `DevonSYNC v${APP_VERSION} started`);
dlog('info', 'init', `UA: ${navigator.userAgent}`);
dlog('info', 'init', `Window: ${window.innerWidth}x${window.innerHeight}, Date: ${new Date().toISOString()}`);

// ── Shared Btn component (used by pages as prop) ───────────────────
const Btn = ({ children, onClick, v = "primary", small, disabled, style: s }) => {
  const T = useTheme();
  const V = {
    primary: { background: `linear-gradient(135deg,${T.accent},${T.accent}cc)`, color: "#060e09", boxShadow: `0 2px 10px ${T.accentM}, 0 1px 3px rgba(0,0,0,.12)` },
    secondary: { background: T.input, color: T.text, border: `1.5px solid ${T.border}` },
    danger: { background: T.redD, color: T.red, border: `1.5px solid ${T.red}33` },
    ghost: { background: "transparent", color: T.soft, border: `1.5px solid ${T.border}` },
    ai: { background: `linear-gradient(135deg,${T.purple},${T.blue})`, color: "#fff", boxShadow: `0 3px 14px ${T.purple}44, 0 1px 3px rgba(0,0,0,.15)` },
  };
  return (
    <button className="sf-btn" disabled={disabled} onClick={onClick} style={{ ...V[v], borderRadius: small ? 8 : 10, cursor: disabled ? "not-allowed" : "pointer", padding: small ? "6px 14px" : "10px 22px", fontSize: small ? fs(12) : fs(13), fontFamily: "'Outfit',sans-serif", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 7, transition: "all .2s cubic-bezier(.4,0,.2,1)", opacity: disabled ? .4 : 1, whiteSpace: "nowrap", minHeight: small ? 30 : 38, letterSpacing: "0.02em", ...s }}>
      {children}
    </button>
  );
};

// ── Toast Container ────────────────────────────────────────────────
const ToastContainer = () => {
  const toasts = useToasts();
  const T = useTheme();
  const colors = { info: T.blue, success: T.accent, error: T.red, warn: T.orange };
  const icons = { success: Ic.IcCheck, error: Ic.IcX, warn: Ic.IcWarn, info: Ic.IcInfo };
  if (toasts.length === 0) return null;
  return (
    <div style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none", maxWidth: 380 }}>
      {toasts.map(t => {
        const Icon = icons[t.type] || Ic.IcMusic;
        const col = colors[t.type] || T.border;
        return (
          <div key={t.id} className="slide-up" style={{ padding: "11px 18px", borderRadius: 12, background: `${T.card}ee`, border: `1px solid ${col}44`, color: col, fontSize: fs(13), fontWeight: 500, boxShadow: `0 8px 32px rgba(0,0,0,.25), 0 0 0 1px ${col}15`, pointerEvents: "auto", display: "flex", alignItems: "center", gap: 10, backdropFilter: "blur(16px) saturate(1.3)" }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: `${col}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Icon s={13} c={col} />
            </div>
            <span style={{ lineHeight: 1.35 }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
};

// ── CSS injection (legacy — uses theme for dynamic classes) ────────
function useCssInjection(T) {
  useEffect(() => {
    const id = "ds-dynamic-css";
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = `
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
.sf-yt-card:hover img{filter:brightness(1.15)}
.sf-yt-card:active{transform:scale(0.97);transition:transform .1s}
.sf-yt-card img{transition:filter .3s ease}
.sf-parse-opt{transition:transform .2s cubic-bezier(.4,0,.2,1),box-shadow .2s ease,border-color .2s ease,filter .2s ease}
.sf-parse-opt:hover{transform:translateY(-3px) scale(1.02);box-shadow:0 8px 28px rgba(0,0,0,.3);filter:brightness(1.15);border-color:currentColor !important}
.sf-parse-opt:active{transform:scale(0.98)}
.sf-task{transition:transform .12s ease,border-color .15s,box-shadow .15s}
.sf-task:hover{border-color:${T.borderL} !important;box-shadow:0 4px 16px rgba(0,0,0,.18);transform:translateY(-1px)}
.sf-icon-btn{transition:all .12s ease;border-radius:6px;opacity:.6}
.sf-icon-btn:hover{opacity:1;background:${T.input} !important;transform:scale(1.15)}
.sf-icon-btn:active{transform:scale(.9)}
.sf-cal-cell{transition:background .15s ease,box-shadow .15s ease}
.sf-cal-cell:hover{background:${T.input} !important;box-shadow:inset 0 0 0 1px ${T.accent}33}
.sf-cal-day{transition:all .12s ease !important}
.sf-cal-day:hover{background:${T.accentD} !important;transform:scale(1.15);border-radius:8px !important}
.sf-exam-q{transition:transform .15s ease,box-shadow .2s ease,border-color .2s ease}
.sf-exam-q:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.15);border-color:${T.borderL} !important}
.sf-exam-opt{transition:all .12s ease !important}
.sf-exam-opt:hover:not(:disabled){transform:translateX(4px);box-shadow:0 2px 8px rgba(0,0,0,.12);filter:brightness(1.08)}
.sf-exam-opt:active:not(:disabled){transform:translateX(2px)}
.sf-stat{transition:transform .15s ease,box-shadow .2s ease}
.sf-stat:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.15)}
.sf-section{transition:box-shadow .25s ease,border-color .25s ease}
.sf-section:hover{box-shadow:0 4px 20px rgba(0,0,0,.1);border-color:${T.borderL} !important}
.sf-chip{transition:all .12s ease}
.sf-chip:hover{filter:brightness(1.15);transform:translateY(-1px)}
.sf-chip:active{transform:translateY(0) scale(.97)}
.sf-toggle{transition:all .12s ease}
.sf-toggle:hover{filter:brightness(1.15);border-color:currentColor !important}
.sf-input-wrap{position:relative;transition:all .15s ease}
.sf-input-wrap:focus-within{box-shadow:0 0 0 3px ${T.accentD};border-color:${T.accent} !important}
.sf-badge{transition:all .15s ease}
.sf-badge:hover{filter:brightness(1.2)}
.sf-profile{transition:all .15s ease}
.sf-profile:hover{transform:translateX(3px);box-shadow:0 3px 12px rgba(0,0,0,.12);border-color:${T.accent}44 !important}
.sf-icon-btn:hover{background:${T.input} !important;color:${T.text} !important;transform:scale(1.1)}
.sf-tab{transition:all .12s ease}
.sf-tab:hover{background:${T.cardH} !important}
.sf-row{transition:background .12s ease}
.sf-row:hover{background:${T.input} !important}
.sf-input:hover{border-color:${T.borderL} !important}
.sf-input:focus{border-color:${T.accent} !important;box-shadow:0 0 0 3px ${T.accentD} !important}
`;
  }, [T]);
}

// ══════════════════════════════════════════════════════════════════════
// APP COMPONENT
// ══════════════════════════════════════════════════════════════════════
export default function App() {
  const T = useTheme();
  const [data, setDataRaw] = useState(INIT);
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState("dashboard");
  const [profilePicker, setProfilePicker] = useState(false);
  const apiStatus = useApiStatus();
  const [date, setDate] = useState(todayStr());
  const [calOpen, setCalOpen] = useState(true);
  const bp = useBreakpoint();
  const [sideW, setSideW] = useState(bp.sideW);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const sideRef = useRef(null);
  const resizing = useRef(false);
  const audioIndicator = useAudio();
  const ytStreams = useYtStreams();
  const timer = useTimer();
  const focus = useFocus();
  const favs = useFavs();

  // Inject dynamic CSS
  useCssInjection(T);

  // Sidebar resize handler
  useEffect(() => {
    const onMove = e => { if (!resizing.current) return; const w = Math.max(180, Math.min(360, e.clientX)); setSideW(w); };
    const onUp = () => { resizing.current = false; document.body.style.cursor = ''; document.body.style.userSelect = ''; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // Auto-collapse sidebar on small screens
  useEffect(() => {
    if (bp.sm) { setSideCollapsed(true); setSideW(56); }
    else { setSideCollapsed(false); setSideW(bp.sideW); }
  }, [bp.sm]);

  // Load data from localStorage
  useEffect(() => {
    dlog('info', 'init', 'App mounting, loading data...');
    (async () => {
      try {
        const d = await load("ds-v1", INIT);
        dlog('info', 'init', `Loaded: ${d.profiles?.length || 0} profiles, ${d.courses?.length || 0} courses, ${Object.keys(d.tasks || {}).length} days`);
        setDataRaw(d);
      } catch (e) {
        dlog('error', 'init', 'Failed to load data', e.message);
        setDataRaw(INIT);
      }
      setLoaded(true);
      dlog('info', 'init', 'App ready');
    })();
  }, []);

  const setData = useCallback(fn => {
    setDataRaw(prev => {
      try { const next = typeof fn === "function" ? fn(prev) : fn; save("ds-v1", next); return next; }
      catch (e) { dlog('error', 'state', 'setData error', e.message); return prev; }
    });
  }, []);

  const dayTasks = useMemo(() => data.tasks?.[date] || [], [data.tasks, date]);
  const setDayTasks = useCallback(t => setData(d => ({ ...d, tasks: { ...d.tasks, [date]: t } })), [date, setData]);
  const profile = useMemo(() => (data.profiles || []).find(p => p.id === data.activeProfileId) || null, [data.profiles, data.activeProfileId]);

  // Sync theme + font scale from saved data
  useEffect(() => {
    if (data.theme && data.theme !== getThemeName()) {
      setThemeGlobal(data.theme);
    }
    if (data.fontScale) { setFontScale(data.fontScale); }
  }, [data.theme, data.fontScale]);

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, color: T.accent, fontSize: 24, fontWeight: 800 }}>Loading...</div>;

  // Media player bar data
  const isSoma = !!audioIndicator.playing;
  const isYT = ytStreams.length > 0;
  const showPlayer = isSoma || isYT;

  return (
    <ErrorBoundary>
      <div style={{ display: "flex", height: "100vh", background: T.bg, color: T.text, fontFamily: "'Outfit','Inter',sans-serif", zoom: (data.uiZoom || 100) / 100 }}>
        <ToastContainer />

        {/* ══ SIDEBAR ══════════════════════════════════════════════ */}
        <aside ref={sideRef} style={{ width: sideCollapsed ? 56 : sideW, minWidth: sideCollapsed ? 56 : 180, maxWidth: 360, height: "100vh", background: `linear-gradient(180deg, ${T.panel}, ${T.bg2})`, borderRight: `1px solid ${T.border}`, display: "flex", flexDirection: "column", overflow: "hidden", flexShrink: 0, position: "relative", transition: sideCollapsed ? "none" : "width .2s cubic-bezier(.4,0,.2,1)" }}>
          <div className="fade" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

            {/* Logo */}
            <div style={{ padding: sideCollapsed ? "16px 8px" : "20px 22px 16px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: `linear-gradient(180deg, ${T.accent}06, transparent)` }}>
              {!sideCollapsed && <>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${T.accent}20, ${T.blue}20)`, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${T.accent}25` }}>
                  <Ic.Grad s={20} c={T.accent} />
                </div>
                <div>
                  <span style={{ fontSize: fs(19), fontWeight: 800, background: `linear-gradient(135deg,${T.accent},${T.blue})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.5px", display: "block", lineHeight: 1.1 }}>DevonSYNC</span>
                  <div style={{ fontSize: fs(9), color: T.dim, marginTop: 1, letterSpacing: "0.8px", textTransform: "uppercase", fontWeight: 500 }}>WGU Study Planner</div>
                </div>
              </>}
              {sideCollapsed && <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${T.accent}15, ${T.blue}15)`, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic.Grad s={18} c={T.accent} /></div>}
            </div>

            {/* Nav items */}
            <div style={{ flex: 1, overflowY: "auto", padding: sideCollapsed ? "6px 4px" : "8px 10px", display: "flex", flexDirection: "column", gap: 1 }}>
              {NAV.map(n => {
                const active = page === n.key;
                const IC = n.icon;
                return (
                  <button key={n.key} className="sf-nav" onClick={() => setPage(n.key)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: sideCollapsed ? "10px 0" : "9px 14px", borderRadius: 9, cursor: "pointer", background: active ? `${n.color}18` : "transparent", border: "none", color: active ? n.color : T.soft, justifyContent: sideCollapsed ? "center" : "flex-start", position: "relative", transition: "all .15s ease" }}>
                    {active && !sideCollapsed && <div style={{ position: "absolute", left: 0, top: "15%", bottom: "15%", width: 3, borderRadius: "0 3px 3px 0", background: n.color, boxShadow: `0 0 8px ${n.color}66` }} />}
                    <div style={{ width: sideCollapsed ? 34 : 28, height: sideCollapsed ? 34 : 28, borderRadius: 8, background: active ? `${n.color}15` : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s ease", flexShrink: 0 }}>
                      <IC s={sideCollapsed ? 18 : 16} c={active ? n.color : T.dim} />
                    </div>
                    {!sideCollapsed && <span style={{ fontSize: fs(13), fontWeight: active ? 650 : 450, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: active ? "0.01em" : 0 }}>{n.label}</span>}
                    {active && sideCollapsed && <div style={{ position: "absolute", left: 2, top: "20%", bottom: "20%", width: 3, borderRadius: 2, background: n.color, boxShadow: `0 0 6px ${n.color}66` }} />}
                  </button>
                );
              })}
              <div style={{ height: 1, background: T.border, margin: "8px 6px", opacity: 0.6 }} />
              <button className="sf-nav" onClick={() => setPage("settings")} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: sideCollapsed ? "10px 0" : "9px 14px", borderRadius: 9, cursor: "pointer", background: page === "settings" ? `${T.text}10` : "transparent", border: "none", color: page === "settings" ? T.text : T.soft, justifyContent: sideCollapsed ? "center" : "flex-start", position: "relative", transition: "all .15s ease" }}>
                {page === "settings" && !sideCollapsed && <div style={{ position: "absolute", left: 0, top: "15%", bottom: "15%", width: 3, borderRadius: "0 3px 3px 0", background: T.text, boxShadow: `0 0 8px ${T.text}33` }} />}
                <div style={{ width: sideCollapsed ? 34 : 28, height: sideCollapsed ? 34 : 28, borderRadius: 8, background: page === "settings" ? `${T.text}10` : "transparent", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s ease", flexShrink: 0 }}>
                  <Ic.Gear s={sideCollapsed ? 18 : 16} c={page === "settings" ? T.text : T.dim} />
                </div>
                {!sideCollapsed && <span style={{ fontSize: fs(13), fontWeight: page === "settings" ? 650 : 450 }}>Settings</span>}
              </button>
            </div>

            {/* Mini Calendar */}
            {!sideCollapsed && (
              <div style={{ padding: "6px 10px", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
                <button onClick={() => setCalOpen(!calOpen)} style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "none", border: "none", color: T.soft, cursor: "pointer", padding: "4px 4px", fontSize: fs(11), fontWeight: 600 }}>
                  <span>{"\ud83d\udcc5"} Calendar</span>
                  <span style={{ fontSize: fs(9), color: T.dim }}>{calOpen ? "\u25b2" : "\u25bc"}</span>
                </button>
                {calOpen && <MiniCal date={date} setDate={setDate} tasks={data.tasks || {}} />}
              </div>
            )}

            {/* AI Connection panel */}
            <div onClick={() => setProfilePicker(!profilePicker)} style={{ padding: sideCollapsed ? "8px 4px" : "12px 14px", borderTop: `1px solid ${T.border}`, flexShrink: 0, cursor: "pointer", background: profile ? `${T.accent}08` : T.input, transition: "background .15s" }}>
              {sideCollapsed ? (
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: profile ? (apiStatus ? T.accent : T.orange) : T.red, boxShadow: profile && apiStatus ? `0 0 8px ${T.accent}` : "none" }} />
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: profile ? 6 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: profile ? (apiStatus ? T.accent : T.orange) : T.red, boxShadow: profile && apiStatus ? `0 0 8px ${T.accent}` : "none", flexShrink: 0 }} />
                      <div style={{ fontSize: fs(11), fontWeight: 700, color: T.soft, letterSpacing: "0.5px", textTransform: "uppercase" }}>AI Connection</div>
                    </div>
                    <span style={{ fontSize: fs(10), color: T.dim, transition: "transform .2s", transform: profilePicker ? "rotate(180deg)" : "none" }}>{"\u25bc"}</span>
                  </div>
                  {profile ? (
                    <div style={{ marginLeft: 18 }}>
                      <div style={{ fontSize: fs(13), fontWeight: 700, color: apiStatus ? T.accent : T.orange, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.name}</div>
                      <div className="mono" style={{ fontSize: fs(10), color: T.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.model}</div>
                    </div>
                  ) : (
                    <div style={{ marginLeft: 18, fontSize: fs(11), color: T.orange }}>No profile connected</div>
                  )}
                </>
              )}
            </div>

            {/* Profile picker dropdown */}
            {profilePicker && !sideCollapsed && (
              <div style={{ padding: "4px 10px 8px", borderTop: `1px solid ${T.border}`, background: T.panel, flexShrink: 0, maxHeight: 200, overflowY: "auto" }}>
                {(data.profiles || []).length > 0 ? (data.profiles || []).map(p => {
                  const isActive = p.id === data.activeProfileId;
                  return (
                    <button key={p.id} onClick={(e) => { e.stopPropagation(); setData(d => ({ ...d, activeProfileId: p.id })); dlog('info', 'profile', `Switched to ${p.name}`); toast(`Active: ${p.name}`, "success"); setProfilePicker(false); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: isActive ? T.accentD : T.input, border: `1.5px solid ${isActive ? T.accent + "55" : "transparent"}`, width: "100%", textAlign: "left", marginBottom: 3, transition: "all .1s" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? T.accent : T.dim, boxShadow: isActive ? `0 0 6px ${T.accent}` : "none", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: fs(12), fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.soft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                        <div style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>{p.model?.slice(0, 24)}</div>
                      </div>
                      {isActive && <span style={{ fontSize: fs(8), color: T.accent, fontWeight: 800, letterSpacing: "0.5px" }}>ACTIVE</span>}
                    </button>
                  );
                }) : (
                  <button onClick={(e) => { e.stopPropagation(); setPage("settings"); setProfilePicker(false); }} style={{ width: "100%", padding: "10px", borderRadius: 8, border: `1px dashed ${T.accent}44`, background: "transparent", color: T.accent, fontSize: fs(11), cursor: "pointer", fontWeight: 600 }}>+ Add AI Profile</button>
                )}
              </div>
            )}

            {/* Unified Media Player */}
            {showPlayer && (() => {
              const station = isSoma ? STATIONS.find(s => s.id === audioIndicator.playing) : null;
              const somaAllPaused = isSoma ? audioIndicator.paused : true;
              const ytAllPaused = isYT ? ytStreams.every(s => s.paused) : true;
              const allPaused = somaAllPaused && ytAllPaused;
              const levels = audioIndicator.levels || new Array(16).fill(0);
              const sourceCount = (isSoma ? 1 : 0) + (isYT ? 1 : 0);
              const accentColor = sourceCount > 1 ? T.purple : isSoma ? T.accent : T.blue;
              const BARS = 24;
              const barData = [];
              const now = Date.now();
              const ytBands = [];
              if (isYT && !ytAllPaused) {
                const t = now / 1000;
                for (let b = 0; b < 8; b++) {
                  const freq = 0.8 + b * 0.6, amp = b < 2 ? 35 : b < 5 ? 28 : 18, phase = b * 1.7;
                  const val = amp + Math.sin(t * freq + phase) * amp * 0.6 + Math.sin(t * (freq * 2.3) + phase * 0.5) * amp * 0.3 + Math.cos(t * 0.4 + b) * amp * 0.2 + (Math.random() * 6 - 3);
                  ytBands.push(Math.max(4, Math.min(85, val)));
                }
              }
              for (let i = 0; i < BARS; i++) {
                const center = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2);
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
                  val = Math.max(val, ytBands[blo] + (ytBands[bhi] - ytBands[blo]) * (bi - blo));
                }
                val = Math.max(0, Math.min(100, val));
                const h = allPaused ? 1 : Math.max(1, Math.round(val * 0.52));
                const hue = allPaused ? 0 : isSoma && isYT ? (280 - center * 60) : isSoma ? (140 - center * 90) : (0 + center * 30);
                barData.push({ h, hue, sat: allPaused ? 0 : isYT && !isSoma ? 70 + val * 0.3 : 55 + val * 0.45, lit: allPaused ? 25 : isYT && !isSoma ? 35 + val * 0.3 : 30 + val * 0.25, val });
              }
              return (
                <div style={{ borderTop: `2px solid ${accentColor}33`, background: `linear-gradient(180deg,${isSoma && isYT ? `${T.purple}22` : isSoma ? T.accentD : T.blueD}66,${T.bg})` }}>
                  {/* Visualizer */}
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 1.5, height: 56, padding: "12px 8px 0", position: "relative" }}>
                    {barData.map((b, i) => (<div key={i} style={{ flex: 1, maxWidth: 6, borderRadius: 2, height: b.h, background: allPaused ? T.dim : `hsl(${b.hue},${b.sat}%,${b.lit}%)`, boxShadow: !allPaused && b.val > 40 ? `0 0 6px hsla(${b.hue},80%,55%,.5)` : "none", transition: "height 50ms ease-out" }} />))}
                    <div style={{ position: "absolute", bottom: -2, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 1.5, transform: "scaleY(-0.2)", transformOrigin: "top", opacity: 0.08, pointerEvents: "none", filter: "blur(1px)" }}>
                      {barData.map((b, i) => <div key={i} style={{ flex: 1, maxWidth: 6, borderRadius: 2, height: b.h, background: `hsl(${b.hue},${b.sat}%,${b.lit}%)` }} />)}
                    </div>
                  </div>
                  {/* Now playing */}
                  <div style={{ textAlign: "center", padding: "6px 10px 2px", overflow: "hidden" }}>
                    {isSoma && (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <Ic.Radio s={14} c={T.accent} />
                        <div style={{ fontSize: fs(13), fontWeight: 700, color: T.accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{station?.name}</div>
                        <button onClick={() => toggleFav('soma', station?.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: fs(14), color: favs.soma?.includes(station?.id) ? T.yellow : T.dim }}>{favs.soma?.includes(station?.id) ? "\u2605" : "\u2606"}</button>
                      </div>
                    )}
                    {isYT && ytStreams.map((s, i) => (
                      <div key={s.vid} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, opacity: s.paused ? 0.5 : 1, transition: "opacity .2s" }}>
                        <div style={{ fontSize: fs(12), fontWeight: 600, color: s.paused ? T.dim : T.blue, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>{i === 0 && <Ic.YT s={14} c={s.paused ? T.dim : T.blue} />} {s.paused && <Ic.IcPause s={10} c={T.dim} />}{s.name}</div>
                        <button onClick={() => toggleFav('yt', s.vid)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: fs(12), color: favs.yt?.includes(s.vid) ? T.yellow : T.dim }}>{favs.yt?.includes(s.vid) ? "\u2605" : "\u2606"}</button>
                      </div>
                    ))}
                    <div style={{ fontSize: fs(9), color: accentColor, marginTop: 2, fontWeight: 500 }}>
                      {[isSoma && "SomaFM", isYT && "YouTube"].filter(Boolean).join(" + ")}
                    </div>
                  </div>
                  {/* Transport */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "4px 10px 6px" }}>
                    <button onClick={isSoma ? audioPrev : ytPrev} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: T.soft, lineHeight: 1 }}><Ic.IcSkipB s={16} c={T.soft} /></button>
                    <button onClick={() => { if (isSoma) audioPauseToggle(); if (isYT) ytPauseAll(); }} style={{ background: allPaused ? `${accentColor}22` : T.input, border: `2px solid ${allPaused ? accentColor : T.border}`, borderRadius: 10, padding: "8px 22px", cursor: "pointer", color: allPaused ? accentColor : T.soft, lineHeight: 1 }}>{allPaused ? <Ic.IcPlay s={20} c={accentColor} /> : <Ic.IcPause s={20} c={T.soft} />}</button>
                    <button onClick={() => { if (isSoma) audioStop(); if (isYT) ytClearAll(); }} style={{ background: T.redD, border: `1px solid ${T.red}33`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: T.red, lineHeight: 1 }}><Ic.IcStop s={16} c={T.red} /></button>
                    <button onClick={isSoma ? audioNext : ytNext} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 12px", cursor: "pointer", color: T.soft, lineHeight: 1 }}><Ic.IcSkipF s={16} c={T.soft} /></button>
                  </div>
                  {/* Volume — SomaFM */}
                  {isSoma && (
                    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 10px 6px" }}>
                      <Ic.Radio s={11} c={T.dim} />
                      <span style={{ cursor: "pointer" }} onClick={() => audioSetVolume(Math.max(0, audioIndicator.volume - 0.05))}><Ic.IcVolLow s={13} c={T.dim} /></span>
                      <VolumeBar value={audioIndicator.volume} onChange={audioSetVolume} />
                      <span style={{ cursor: "pointer" }} onClick={() => audioSetVolume(Math.min(1, audioIndicator.volume + 0.05))}><Ic.IcVolHi s={13} c={T.dim} /></span>
                      <span style={{ fontSize: fs(10), color: T.dim, minWidth: 26, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(audioIndicator.volume * 100)}</span>
                    </div>
                  )}
                  {/* YouTube per-stream volume */}
                  {isYT && ytStreams.map(s => (
                    <div key={s.vid} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px 5px" }}>
                      <button onClick={() => ytPauseToggle(s.vid)} style={{ background: s.paused ? `${T.blue}22` : T.input, border: `1px solid ${s.paused ? T.blue : T.border}`, borderRadius: 6, padding: "3px 6px", cursor: "pointer", flexShrink: 0 }}>
                        {s.paused ? <Ic.IcPlay s={12} c={T.blue} /> : <Ic.IcPause s={12} c={T.dim} />}
                      </button>
                      <span style={{ fontSize: fs(10), color: s.paused ? T.dim : T.blue, minWidth: 52, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{s.name.length > 8 ? s.name.slice(0, 8) + "..." : s.name}</span>
                      <span style={{ cursor: "pointer" }} onClick={() => ytSetVolume(Math.max(0, s.volume - 5), s.vid)}><Ic.IcVolLow s={11} c={T.dim} /></span>
                      <VolumeBar value={s.volume / 100} onChange={v => ytSetVolume(v * 100, s.vid)} />
                      <span style={{ cursor: "pointer" }} onClick={() => ytSetVolume(Math.min(100, s.volume + 5), s.vid)}><Ic.IcVolHi s={11} c={T.dim} /></span>
                      <span style={{ fontSize: fs(9), color: T.dim, minWidth: 20, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" }}>{s.volume}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Study timer in sidebar */}
            {timer.running && (
              <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, background: T.accentD }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: fs(22), fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmtElapsed(timer.elapsed)}</div>
                    <div style={{ fontSize: fs(10), color: T.soft, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{timer.taskTitle}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={timerPause} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>{timer.paused ? <Ic.IcPlay s={10} c={T.accent} /> : <Ic.IcPause s={10} c={T.soft} />}</button>
                    <button onClick={timerStop} style={{ background: T.redD, border: "none", borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}><Ic.IcStop s={10} c={T.red} /></button>
                  </div>
                </div>
              </div>
            )}

          </div>{/* close fade wrapper */}

          {/* Resize handle */}
          {!sideCollapsed && <div onMouseDown={() => { resizing.current = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; }} style={{ position: "absolute", right: -3, top: 0, bottom: 0, width: 6, cursor: "col-resize", zIndex: 10 }} />}
          {/* Collapse toggle */}
          <button onClick={() => { setSideCollapsed(!sideCollapsed); if (!sideCollapsed) setSideW(56); else setSideW(bp.sideW); }} style={{ position: "absolute", top: 14, right: -13, width: 26, height: 26, borderRadius: "50%", background: T.card, border: `1.5px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 11, fontSize: 9, color: T.dim, boxShadow: `0 2px 12px rgba(0,0,0,.25), 0 0 0 1px ${T.bg}`, transition: "all .2s cubic-bezier(.4,0,.2,1)" }}>{sideCollapsed ? <Ic.ChevR s={12} /> : <Ic.ChevL s={12} />}</button>
        </aside>

        {/* ══ MAIN CONTENT ═════════════════════════════════════════ */}
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {/* AmbientPage persists across page switches */}
          <div style={page === "ambient" ? { position: "absolute", inset: 0, zIndex: 2, overflow: "auto", padding: sideCollapsed ? bp.padCol : bp.pad } : { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", pointerEvents: "none" }}>
            <AmbientPage Btn={Btn} />
          </div>
          <main style={{ height: "100%", overflow: "auto", padding: sideCollapsed ? bp.padCol : bp.pad, display: page === "ambient" ? "none" : "block" }} key={page + date}>
            <div style={{ maxWidth: bp.maxW, margin: "0 auto" }}>
              {page === "dashboard" && <DegreeDashboard data={data} setData={setData} setPage={setPage} setDate={setDate} Btn={Btn} />}
              {page === "planner" && <CoursePlanner data={data} setData={setData} profile={profile} setPage={setPage} Btn={Btn} />}
              {page === "daily" && <DailyPage date={date} tasks={dayTasks} setTasks={setDayTasks} profile={profile} data={data} setData={setData} setDate={setDate} Btn={Btn} />}
              {page === "calendar" && <CalendarPage date={date} setDate={setDate} tasks={data.tasks || {}} setPage={setPage} Btn={Btn} />}
              {page === "chat" && <StudyChatPage data={data} setData={setData} profile={profile} Btn={Btn} />}
              {page === "quiz" && <PracticeExamPage data={data} setData={setData} profile={profile} Btn={Btn} Label={Label} />}
              {page === "report" && <WeeklyReportPage data={data} Btn={Btn} />}
              {page === "settings" && <SettingsPage data={data} setData={setData} setPage={setPage} Btn={Btn} />}
            </div>
          </main>
        </div>

        {/* Focus mode overlay */}
        {focus.active && focus.showPulse && (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.82)", backdropFilter: "blur(20px) saturate(0.8)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer" }} onClick={() => { focusPulseYes(); toast("Focus +15min", "success"); }}>
            <div className="pop-in" style={{ background: `${T.card}dd`, border: `1px solid ${T.accent}33`, borderRadius: 24, padding: "48px 56px", display: "flex", flexDirection: "column", alignItems: "center", backdropFilter: "blur(20px)", boxShadow: `0 24px 60px rgba(0,0,0,.5), 0 0 80px ${T.accent}15` }}>
              <div style={{ fontSize: 56, marginBottom: 20, filter: "drop-shadow(0 4px 12px rgba(0,0,0,.3))" }}>{"\ud83e\uddd8"}</div>
              <div style={{ fontSize: fs(24), fontWeight: 800, color: T.accent, marginBottom: 8, letterSpacing: "-0.02em" }}>Focus Check-in</div>
              <div style={{ fontSize: fs(14), color: T.soft, marginBottom: 28, opacity: 0.8 }}>Are you still studying?</div>
              <div style={{ padding: "14px 40px", borderRadius: 14, background: `linear-gradient(135deg, ${T.accent}, ${T.accent}cc)`, color: "#000", fontSize: fs(15), fontWeight: 700, boxShadow: `0 4px 20px ${T.accentM}`, transition: "all .15s" }}>Yes, I'm focused!</div>
              <div style={{ fontSize: fs(11), color: T.dim, marginTop: 20 }}>Streak: {focus.streak} check-ins</div>
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
