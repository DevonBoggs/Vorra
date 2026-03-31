// Vorra v7.3.0 — AI-powered study & life planner
// Restructured App Shell — imports from extracted modules

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Systems ────────────────────────────────────────────────────────
import { dlog } from "./systems/debug.js";
import { INIT, load, save, flushSave } from "./systems/storage.js";
import { useTheme, fs, setTheme as setThemeGlobal, setFontScale, getThemeName } from "./styles/tokens.js";
import { toast, useToasts } from "./systems/toast.js";
import { useBreakpoint } from "./systems/breakpoint.js";
import { useBgTask, bgSet, getBgState, bgAbort } from "./systems/background.js";
import { LogLine } from "./components/ui/LogLine.jsx";
import { useTimer, timerStop, timerPause, fmtElapsed } from "./systems/timer.js";
import { useFocus, focusPulseYes } from "./systems/focus.js";
import { useApiStatus, APP_VERSION } from "./systems/api.js";
import { useAudio, audioStop, audioPauseToggle, audioNext, audioPrev } from "./systems/audio.js";
import { useYtStreams, ytPauseAll, ytClearAll, ytNext, ytPrev, useFavs } from "./systems/youtube.js";

// ── Components ─────────────────────────────────────────────────────
import Ic from "./components/icons/index.jsx";
import { Label } from "./components/ui/Label.jsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.jsx";
import { OnboardingWizard } from "./components/ui/OnboardingWizard.jsx";
import { CelebrationModal } from "./components/ui/CelebrationModal.jsx";
import { MediaPlayer } from "./components/MediaPlayer/MediaPlayer.jsx";
import { CommandPalette } from "./components/ui/CommandPalette.jsx";

// ── Constants ──────────────────────────────────────────────────────
import { NAV } from "./constants/nav.js";

// ── Router ─────────────────────────────────────────────────────────
import { usePageNav } from "./routes.jsx";

// ── Shortcuts ──────────────────────────────────────────────────────
import { registerShortcuts } from "./systems/shortcuts.js";
// categories used by page components via props

// ── Pages ──────────────────────────────────────────────────────────
import { MiniCal } from "./pages/Calendar/MiniCal.jsx";
import { CalendarPage } from "./pages/Calendar/CalendarPage.jsx";
import { WeeklyReportPage } from "./pages/Report/WeeklyReportPage.jsx";
import { PracticeExamPage } from "./pages/Quiz/PracticeExamPage.jsx";
import { DailyPage } from "./pages/Daily/DailyPage.jsx";
import { DegreeDashboard } from "./pages/Dashboard/DegreeDashboard.jsx";
import { MyCoursesPage } from "./pages/Courses/MyCoursesPage.jsx";
import { StudyPlannerPage } from "./pages/Planner/StudyPlannerPage.jsx";
import { StudyChatPage } from "./pages/Chat/StudyChatPage.jsx";
import { SettingsPage } from "./pages/Settings/SettingsPage.jsx";
import { AmbientPage } from "./pages/Ambient/AmbientPage.jsx";

// ── Utilities ──────────────────────────────────────────────────────
import { todayStr } from "./utils/helpers.js";

// ── Init logging ───────────────────────────────────────────────────
dlog('info', 'init', `Vorra v${APP_VERSION} started`);
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
    <div aria-live="polite" style={{ position: "fixed", top: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none", maxWidth: 380 }}>
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
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
@keyframes dotPulse{0%,80%,100%{opacity:.2;transform:scale(.8)}40%{opacity:1;transform:scale(1)}}
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
.sf-import-btn{transition:transform .2s cubic-bezier(.4,0,.2,1),box-shadow .25s ease,border-color .2s ease,background .2s ease,filter .2s ease}
.sf-import-btn:hover:not(:disabled){transform:translateY(-3px);filter:brightness(1.1)}
.sf-import-btn:active:not(:disabled){transform:translateY(0) scale(.98)}
.sf-import-accent:hover:not(:disabled){border-color:${T.accent}88 !important;background:${T.accent}28 !important;box-shadow:0 0 20px ${T.accentM},0 8px 24px rgba(0,0,0,.3)}
.sf-import-accent:focus-visible{border-color:${T.accent}88 !important;box-shadow:0 0 20px ${T.accentM},0 0 0 2px ${T.accent} !important}
.sf-import-blue:hover:not(:disabled){border-color:${T.blue}88 !important;background:${T.blue}28 !important;box-shadow:0 0 20px ${T.blue}33,0 8px 24px rgba(0,0,0,.3)}
.sf-import-blue:focus-visible{border-color:${T.blue}88 !important;box-shadow:0 0 20px ${T.blue}33,0 0 0 2px ${T.blue} !important}
.sf-step-head{transition:background .15s ease}
.sf-step-head:hover{background:${T.input}08 !important}
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
  const { page, setPage } = usePageNav();
  const [profilePicker, setProfilePicker] = useState(false);
  const [bgMinimized, setBgMinimized] = useState(false);
  const bg = useBgTask();
  const [cmdOpen, setCmdOpen] = useState(false);
  const [recentPages, setRecentPages] = useState([]);
  const apiStatus = useApiStatus();
  const [date, setDate] = useState(todayStr());
  const [calOpen, setCalOpen] = useState(true);
  const bp = useBreakpoint();
  const [sideW, setSideW] = useState(bp.sideW);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const sideRef = useRef(null);
  const mainRef = useRef(null);
  const resizing = useRef(false);
  const audioIndicator = useAudio();
  const ytStreams = useYtStreams();
  const timer = useTimer();
  const focus = useFocus();
  const favs = useFavs();

  // First-run onboarding wizard (replaces standalone AI disclaimer)
  const [showOnboarding, setShowOnboarding] = useState(() => !data.onboardingComplete && !localStorage.getItem('vorra-ai-ack'));

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
        const d = await load("vorra-v1", INIT);
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

  // Flush pending saves on window close
  useEffect(() => {
    const handleUnload = () => flushSave();
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  const setData = useCallback(fn => {
    setDataRaw(prev => {
      try { const next = typeof fn === "function" ? fn(prev) : fn; save("vorra-v1", next); return next; }
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

  // Track recent pages for command palette
  useEffect(() => {
    setRecentPages(prev => {
      const filtered = prev.filter(p => p !== page);
      return [page, ...filtered].slice(0, 5);
    });
  }, [page]);

  // Focus main content on page change for screen readers
  useEffect(() => { mainRef.current?.focus(); }, [page]);

  // Keyboard shortcuts
  useEffect(() => {
    const unsubscribe = registerShortcuts(window, (id) => {
      if (id === 'command-palette') { setCmdOpen(o => !o); return; }
      if (id.startsWith('go-')) {
        const target = id.replace('go-', '');
        setPage(target);
        return;
      }
      if (id === 'toggle-sidebar') { setSideCollapsed(c => !c); return; }
      if (id === 'toggle-timer') { if (timer.running) timerStop(); return; }
      if (id === 'pause-timer') { if (timer.running) timerPause(); return; }
      if (id === 'media-play-pause') { if (audioIndicator.playing) audioPauseToggle(); if (ytStreams.length > 0) ytPauseAll(); return; }
      if (id === 'media-stop') { if (audioIndicator.playing) audioStop(); if (ytStreams.length > 0) ytClearAll(); return; }
      if (id === 'media-next') { if (audioIndicator.playing) audioNext(); else if (ytStreams.length > 0) ytNext(); return; }
      if (id === 'media-prev') { if (audioIndicator.playing) audioPrev(); else if (ytStreams.length > 0) ytPrev(); return; }
      if (id === 'zoom-in') { setData(d => ({ ...d, uiZoom: Math.min(200, (d.uiZoom || 100) + 10) })); return; }
      if (id === 'zoom-out') { setData(d => ({ ...d, uiZoom: Math.max(50, (d.uiZoom || 100) - 10) })); return; }
      if (id === 'zoom-reset') { setData(d => ({ ...d, uiZoom: 100 })); return; }
    });
    return unsubscribe;
  }, [audioIndicator.playing, ytStreams.length, timer.running]);

  // Command palette action handler
  const handleCmdAction = useCallback(({ type, target }) => {
    setCmdOpen(false);
    if (type === 'navigate') setPage(target);
    if (type === 'action') {
      if (target === 'toggle-sidebar') setSideCollapsed(c => !c);
      if (target === 'toggle-timer') { if (timer.running) timerStop(); }
      if (target === 'media-play-pause') { if (audioIndicator.playing) audioPauseToggle(); if (ytStreams.length > 0) ytPauseAll(); }
      if (target === 'media-stop') { if (audioIndicator.playing) audioStop(); if (ytStreams.length > 0) ytClearAll(); }
    }
  }, [timer.running, audioIndicator.playing, ytStreams.length]);

  if (!loaded) return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: T.bg, color: T.accent, fontSize: 24, fontWeight: 800 }}>Loading...</div>;

  return (
    <ErrorBoundary>
      <div style={{ display: "flex", height: "100vh", background: T.bg, color: T.text, fontFamily: "'Outfit','Inter',sans-serif", zoom: (data.uiZoom || 100) / 100 }}>
        <ToastContainer />

        {/* Persistent AI activity overlay — visible across all pages */}
        {bg.loading && (
          <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 998, width: bgMinimized ? 'auto' : 360, maxWidth: '90vw', transition: 'all .2s ease' }}>
            {bgMinimized ? (
              <button onClick={() => setBgMinimized(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 12, background: T.card, border: `1.5px solid ${T.purple}44`, boxShadow: `0 4px 20px rgba(0,0,0,.4), 0 0 12px ${T.purple}22`, cursor: 'pointer', color: T.purple, fontSize: fs(11), fontWeight: 600 }}>
                <Ic.Spin s={14} />
                <span>{bg.label || 'AI working...'}</span>
              </button>
            ) : (
              <div style={{ background: T.card, border: `1.5px solid ${T.purple}44`, borderRadius: 14, boxShadow: `0 8px 32px rgba(0,0,0,.5), 0 0 16px ${T.purple}22`, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Ic.Spin s={14} />
                    <span style={{ fontSize: fs(12), fontWeight: 700, color: T.purple }}>{bg.label || 'AI working...'}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setBgMinimized(true)} title="Minimize" style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 4, fontSize: fs(12) }}>{'\u2013'}</button>
                    <button onClick={() => bgAbort()} title="Cancel" style={{ background: 'none', border: 'none', color: T.red, cursor: 'pointer', padding: 4, fontSize: fs(12) }}>{'\u2716'}</button>
                  </div>
                </div>
                <div style={{ padding: '8px 14px', maxHeight: 150, overflowY: 'auto' }}>
                  {bg.streamText && <div style={{ padding: '4px 8px', borderRadius: 6, background: T.purpleD, border: `1px solid ${T.purple}22`, fontSize: fs(10), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 60, overflow: 'auto', marginBottom: 4 }}>{bg.streamText}</div>}
                  {bg.logs.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{bg.logs.slice(-6).map((l, i) => <LogLine key={i} l={l} />)}</div>}
                </div>
              </div>
            )}
          </div>
        )}

        {showOnboarding && (
          <OnboardingWizard
            data={data}
            setData={setData}
            profile={profile}
            setPage={p => { setPage(p); setShowOnboarding(false); }}
            onComplete={() => {
              localStorage.setItem('vorra-ai-ack', '1');
              setData(d => ({ ...d, onboardingComplete: true }));
              setShowOnboarding(false);
            }}
          />
        )}
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onAction={handleCmdAction} courses={data.courses || []} recentPages={recentPages} data={data} />

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
                  <span style={{ fontSize: fs(19), fontWeight: 800, background: `linear-gradient(135deg,${T.accent},${T.blue})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "-0.5px", display: "block", lineHeight: 1.1 }}>Vorra</span>
                  <div style={{ fontSize: fs(9), color: T.dim, marginTop: 1, letterSpacing: "0.8px", textTransform: "uppercase", fontWeight: 500 }}>Study & Life Planner</div>
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
              <div style={{ padding: "4px 10px 8px", borderTop: `1px solid ${T.border}`, background: T.panel, flexShrink: 0, maxHeight: 280, overflowY: "auto" }}>
                {(data.profiles || []).length > 0 ? (data.profiles || []).map(p => {
                  const isActive = p.id === data.activeProfileId;
                  return (
                    <div key={p.id} style={{ marginBottom: 3 }}>
                      <button onClick={(e) => { e.stopPropagation(); setData(d => ({ ...d, activeProfileId: p.id })); dlog('info', 'profile', `Switched to ${p.name}`); toast(`Active: ${p.name}`, "success"); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: isActive ? T.accentD : T.input, border: `1.5px solid ${isActive ? T.accent + "55" : "transparent"}`, width: "100%", textAlign: "left", transition: "all .1s" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: isActive ? T.accent : T.dim, boxShadow: isActive ? `0 0 6px ${T.accent}` : "none", flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: fs(12), fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.soft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                          <div style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>{p.model?.slice(0, 24)}</div>
                        </div>
                        {isActive && <span style={{ fontSize: fs(8), color: T.accent, fontWeight: 800, letterSpacing: "0.5px" }}>ACTIVE</span>}
                      </button>
                      {/* Model selector for active profile */}
                      {isActive && (
                        <div style={{ padding: "6px 10px 4px 28px", display: "flex", alignItems: "center", gap: 6 }} onClick={e => e.stopPropagation()}>
                          <span style={{ fontSize: fs(9), color: T.dim, fontWeight: 600, whiteSpace: "nowrap" }}>MODEL</span>
                          <input
                            value={p.model || ""}
                            onChange={e => { const newModel = e.target.value; setData(d => ({ ...d, profiles: d.profiles.map(pr => pr.id === p.id ? { ...pr, model: newModel } : pr) })); }}
                            placeholder="model name"
                            style={{ fontSize: fs(10), padding: "4px 8px", borderRadius: 6, background: T.input, border: `1px solid ${T.border}`, color: T.text, fontFamily: "'JetBrains Mono',monospace", flex: 1, minWidth: 0 }}
                          />
                        </div>
                      )}
                    </div>
                  );
                }) : (
                  <button onClick={(e) => { e.stopPropagation(); setPage("settings"); setProfilePicker(false); }} style={{ width: "100%", padding: "10px", borderRadius: 8, border: `1px dashed ${T.accent}44`, background: "transparent", color: T.accent, fontSize: fs(11), cursor: "pointer", fontWeight: 600 }}>+ Add AI Profile</button>
                )}
              </div>
            )}

            {/* Unified Media Player (extracted component) */}
            <MediaPlayer audioIndicator={audioIndicator} ytStreams={ytStreams} favs={favs} />

            {/* Study timer in sidebar */}
            {timer.running && (
              <div style={{ padding: "10px 14px", borderTop: `1px solid ${T.border}`, background: T.accentD }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: fs(22), fontWeight: 800, color: timer.remaining <= 60000 && timer.durationMs > 0 ? T.orange : T.accent, fontFamily: "'JetBrains Mono',monospace" }}>{fmtElapsed(timer.durationMs > 0 ? timer.remaining : timer.elapsed)}</div>
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
          <main ref={mainRef} tabIndex={-1} style={{ height: "100%", overflow: "auto", padding: sideCollapsed ? bp.padCol : bp.pad, display: page === "ambient" ? "none" : "block", outline: "none" }} key={page + date}>
            <div style={{ maxWidth: bp.maxW, margin: "0 auto" }}>
              {page === "dashboard" && <DegreeDashboard data={data} setData={setData} setPage={setPage} setDate={setDate} Btn={Btn} />}
              {page === "courses" && <MyCoursesPage data={data} setData={setData} profile={profile} setPage={setPage} setDate={setDate} />}
              {page === "planner" && <StudyPlannerPage data={data} setData={setData} profile={profile} setPage={setPage} />}
              {page === "daily" && <DailyPage date={date} tasks={dayTasks} setTasks={setDayTasks} profile={profile} data={data} setData={setData} setDate={setDate} setPage={setPage} Btn={Btn} />}
              {page === "calendar" && <CalendarPage date={date} setDate={setDate} tasks={data.tasks || {}} setPage={setPage} Btn={Btn} data={data} />}
              {page === "chat" && <StudyChatPage data={data} setData={setData} profile={profile} Btn={Btn} />}
              {page === "quiz" && <PracticeExamPage data={data} setData={setData} profile={profile} Btn={Btn} Label={Label} />}
              {page === "report" && <WeeklyReportPage data={data} Btn={Btn} setPage={setPage} />}
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
