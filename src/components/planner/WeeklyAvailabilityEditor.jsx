// WeeklyAvailabilityEditor — interactive timeline with drag/resize for all blocks
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme, fs } from '../../styles/tokens.js';
import { Btn } from '../ui/Btn.jsx';
import { uid } from '../../utils/helpers.js';
import { getEffectiveHours, DAY_NAMES } from '../../utils/availabilityCalc.js';
import { CommitmentEditor } from './CommitmentEditor.jsx';

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const CATEGORY_COLORS = {
  work: '#4ea8de', family: '#e88bb3', health: '#4ecdc4', commute: '#f7b731', other: '#a0a0a0',
};

const toMin = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToTime = (m) => { const h = Math.floor(m / 60); const min = m % 60; return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`; };

// Time formatting: "9:00a", "5:30p", "12:00p"
const fmtTime = (totalMin) => {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h < 12 ? 'a' : 'p';
  return m === 0 ? `${h12}:00${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
};
// Short format for axis labels
const fmtHour = (h) => h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;

const TIME_LABELS = Array.from({ length: 24 }, (_, i) => i);
const GRID_HOURS = Array.from({ length: 23 }, (_, i) => i + 1);
const SNAP = 15;
const MIN_DURATION = 30;
const snapMin = (m) => Math.round(m / SNAP) * SNAP;
const clampMin = (m) => Math.max(0, Math.min(1440, m));

const ToggleSwitch = ({ label, isOn, onClick, T }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20,
    border: `1.5px solid ${isOn ? T.accent + '66' : T.border}`,
    background: isOn ? T.accent + '18' : 'transparent',
    color: isOn ? T.accent : T.dim, fontSize: fs(11), fontWeight: 600,
    cursor: 'pointer', transition: 'all .15s',
  }}>
    <div style={{ width: 28, height: 16, borderRadius: 8, padding: 2, background: isOn ? T.accent : T.border, display: 'flex', alignItems: 'center', justifyContent: isOn ? 'flex-end' : 'flex-start', transition: 'all .2s' }}>
      <div style={{ width: 12, height: 12, borderRadius: 6, background: '#fff', transition: 'all .2s' }} />
    </div>
    {label}
  </button>
);

// Context menu component — rendered via portal to bypass CSS zoom
const CtxMenu = ({ x, y, items, onClose, T }) => {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);
  useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    setPos({
      left: Math.min(x, Math.max(8, vw - rect.width - 8)),
      top: Math.min(y, Math.max(8, vh - rect.height - 8)),
    });
  }, [x, y]);
  return createPortal(
    <div ref={ref} style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9999, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}>
      {items.map((item, i) => item.divider ? (
        <div key={i} style={{ height: 1, background: T.border, margin: '3px 0' }} />
      ) : (
        <button key={i} onClick={() => { item.action(); onClose(); }} disabled={item.disabled}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', color: item.danger ? T.red : item.disabled ? T.faint : T.text, fontSize: fs(11), cursor: item.disabled ? 'default' : 'pointer', borderRadius: 4, opacity: item.disabled ? 0.4 : 1 }}
          onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = T.input; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}>
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  );
};

export const WeeklyAvailabilityEditor = ({ plannerConfig, onUpdate, onUpdateCommitment, onUpdateCommitments }) => {
  const T = useTheme();
  const [drag, setDrag] = useState(null);
  const [contextDay, setContextDay] = useState(null);
  const [showCommitmentForm, setShowCommitmentForm] = useState(false);
  const [editingCommitmentId, setEditingCommitmentId] = useState(null);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, items }
  const [clipboardWindow, setClipboardWindow] = useState(null); // { start, end }
  const [commitmentPrefill, setCommitmentPrefill] = useState(null);
  const [editingTimes, setEditingTimes] = useState(null); // { dow, winIdx, start, end }
  const [hoveredBlock, setHoveredBlock] = useState(null); // { dow, winIdx, type: 'study'|'commitment', commitmentId? }
  const [selectedBlock, setSelectedBlock] = useState(null); // { dow, winIdx, type: 'study'|'commitment', commitmentId? }
  const [selectedBlocks, setSelectedBlocks] = useState([]);
  const [selectionBox, setSelectionBox] = useState(null); // { startX, startY, currentX, currentY, startDow, startMin }
  const barRefs = useRef({});
  const wrapperRef = useRef(null);

  const wa = plannerConfig?.weeklyAvailability || {};
  const commitments = plannerConfig?.commitments || [];

  const isMultiSelected = (dow, winIdx, type, commitmentId) =>
    selectedBlocks.some(b => b.dow === dow && b.winIdx === winIdx && b.type === type &&
      (type !== 'commitment' || b.commitmentId === commitmentId));

  // ── Undo/Redo system (captures both wa + commitments) ──
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const lastSnapRef = useRef(null);

  // Keep lastSnapRef in sync with current state after each render
  useEffect(() => { lastSnapRef.current = JSON.stringify({ wa, cm: commitments }); });

  // Capture a combined snapshot of wa + commitments before changes
  const pushUndo = () => {
    const waSnap = JSON.stringify(wa);
    const cmSnap = JSON.stringify(commitments);
    const top = undoStack.current[undoStack.current.length - 1];
    // Skip if identical to the last snapshot (prevents duplicates)
    if (top && top.wa === waSnap && top.cm === cmSnap) return;
    undoStack.current.push({ wa: waSnap, cm: cmSnap });
    redoStack.current = [];
    if (undoStack.current.length > 30) undoStack.current.shift();
  };

  // Wrap onUpdate to capture undo snapshots before applying changes
  const wrappedOnUpdate = (updates) => {
    pushUndo();
    onUpdate(updates);
  };

  // Wrap onUpdateCommitments to capture undo snapshots before applying changes
  const wrappedOnUpdateCommitments = (updated) => {
    pushUndo();
    if (onUpdateCommitments) onUpdateCommitments(updated);
  };

  // ── Study window CRUD ──
  const setDayAvailable = (dow, available) => {
    const current = wa[dow] || { available: true, windows: [{ start: '09:00', end: '17:00' }] };
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...current, available } } });
  };
  const updateWindowBoth = (dow, winIdx, start, end) => {
    const day = { ...(wa[dow] || { available: true, windows: [] }) };
    const windows = [...(day.windows || [])];
    windows[winIdx] = { ...windows[winIdx], start, end };
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows } } });
  };
  const removeWindow = (dow, winIdx) => {
    const day = { ...(wa[dow] || { available: true, windows: [] }) };
    const windows = (day.windows || []).filter((_, i) => i !== winIdx);
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows, available: windows.length > 0 } } });
  };

  // ── Bulk actions ──
  const setAllDays = (available) => { const u = { ...wa }; for (let d = 0; d < 7; d++) u[d] = { ...(u[d] || { windows: [{ start: '09:00', end: '17:00' }] }), available }; onUpdate({ weeklyAvailability: u }); };
  const setAllWeekdays = (available) => { const u = { ...wa }; for (const d of [1,2,3,4,5]) u[d] = { ...(u[d] || { windows: [{ start: '09:00', end: '17:00' }] }), available }; onUpdate({ weeklyAvailability: u }); };
  const setAllWeekends = (available) => { const u = { ...wa }; for (const d of [0,6]) u[d] = { ...(u[d] || { windows: [{ start: '09:00', end: '17:00' }] }), available }; onUpdate({ weeklyAvailability: u }); };
  const copyDayToAll = (dow) => { const s = wa[dow]; if (!s) return; const u = { ...wa }; for (let d = 0; d < 7; d++) if (d !== dow) u[d] = JSON.parse(JSON.stringify(s)); onUpdate({ weeklyAvailability: u }); };
  const copyDayToWeekdays = (dow) => { const s = wa[dow]; if (!s) return; const u = { ...wa }; for (const d of [1,2,3,4,5]) if (d !== dow) u[d] = JSON.parse(JSON.stringify(s)); onUpdate({ weeklyAvailability: u }); };
  const copyDayToWeekends = (dow) => { const s = wa[dow]; if (!s) return; const u = { ...wa }; for (const d of [0,6]) if (d !== dow) u[d] = JSON.parse(JSON.stringify(s)); onUpdate({ weeklyAvailability: u }); };
  const clearDayWindows = (dow) => { wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { available: false, windows: [] } } }); };

  // Split a study window into two halves with a 30-min gap
  const splitWindow = (dow, winIdx) => {
    const day = { ...(wa[dow] || { available: true, windows: [] }) };
    const windows = [...(day.windows || [])];
    const w = windows[winIdx];
    const s = toMin(w.start), e = toMin(w.end);
    const mid = Math.round((s + e) / 2);
    if (e - s < 90) return; // too small to split (need 30+30+30)
    windows.splice(winIdx, 1, { start: w.start, end: minToTime(mid - 15) }, { start: minToTime(mid + 15), end: w.end });
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows } } });
  };

  // Copy a single window to clipboard
  const copyWindow = (w) => setClipboardWindow({ start: w.start, end: w.end });

  // Paste window from clipboard to a specific day
  const pasteWindow = (dow, atMin) => {
    if (!clipboardWindow) return;
    const day = { ...(wa[dow] || { available: true, windows: [] }) };
    const dur = toMin(clipboardWindow.end) - toMin(clipboardWindow.start);
    let ns = snapMin(atMin - dur / 2), ne = ns + dur;
    ns = Math.max(0, ns); ne = Math.min(1440, ne);
    const windows = [...(day.windows || []), { start: minToTime(ns), end: minToTime(ne) }].sort((a, b) => toMin(a.start) - toMin(b.start));
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows, available: true } } });
  };

  // Copy a single window's times to all days
  const copyWindowToAllDays = (w) => {
    const u = { ...wa };
    for (let d = 0; d < 7; d++) {
      const day = { ...(u[d] || { available: true, windows: [] }) };
      if (!day.available) continue;
      const existing = day.windows || [];
      // Skip if identical window already exists (prevents duplicates)
      if (existing.some(ex => ex.start === w.start && ex.end === w.end)) { u[d] = day; continue; }
      day.windows = [...existing, { start: w.start, end: w.end }].sort((a, b) => toMin(a.start) - toMin(b.start));
      u[d] = day;
    }
    wrappedOnUpdate({ weeklyAvailability: u });
  };

  // Duplicate a window on the same day, offset by its duration
  const duplicateWindow = (dow, winIdx) => {
    const day = { ...(wa[dow] || { available: true, windows: [] }) };
    const w = (day.windows || [])[winIdx];
    if (!w) return;
    const dur = toMin(w.end) - toMin(w.start);
    let ns = toMin(w.end) + 15, ne = ns + dur; // place after original with 15min gap
    if (ne > 1440) { ns = toMin(w.start) - dur - 15; ne = ns + dur; } // try before if no room after
    if (ns < 0) return; // no room
    const windows = [...(day.windows || []), { start: minToTime(Math.max(0, ns)), end: minToTime(Math.min(1440, ne)) }]
      .sort((a, b) => toMin(a.start) - toMin(b.start));
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows } } });
  };

  // Remove a commitment (with undo snapshot)
  const removeCommitment = (id) => {
    wrappedOnUpdateCommitments(commitments.filter(c => c.id !== id));
  };

  // Context menu builders
  const openCtx = (e, items) => {
    e.preventDefault();
    e.stopPropagation();
    // CtxMenu renders via portal at document.body (outside CSS zoom), so clientX/Y is correct
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  };

  const buildEmptyCtx = (dow, clickMin) => [
    { label: 'Add study window here', action: () => handleBarDoubleClick({ clientX: 0, _forceMin: clickMin }, dow) },
    { label: 'Add commitment here', action: () => {
      const s = snapMin(Math.max(0, clickMin - 30));
      const e = snapMin(Math.min(1440, clickMin + 30));
      setCommitmentPrefill({ days: [dow], start: minToTime(s), end: minToTime(e) });
      setShowCommitmentForm(true);
    }},
    { divider: true },
    { label: 'Paste window', action: () => pasteWindow(dow, clickMin), disabled: !clipboardWindow },
  ];

  const buildStudyCtx = (dow, winIdx, w) => [
    { label: 'Set exact times...', action: () => setEditingTimes({ dow, winIdx, start: w.start, end: w.end }) },
    { label: 'Split window', action: () => splitWindow(dow, winIdx), disabled: toMin(w.end) - toMin(w.start) < 90 },
    { label: 'Duplicate window', action: () => duplicateWindow(dow, winIdx) },
    { divider: true },
    { label: 'Copy window', action: () => copyWindow(w) },
    { label: 'Copy to all days', action: () => copyWindowToAllDays(w) },
    { divider: true },
    { label: 'Delete window', action: () => removeWindow(dow, winIdx), danger: true },
  ];

  // Time axis right-click menu
  const buildAxisCtx = (clickMin) => {
    const timeLabel = fmtTime(clickMin);
    return [
      { label: `Add study window at ${timeLabel} on all days`, action: () => {
        const u = { ...wa };
        const ns = snapMin(clickMin), ne = snapMin(clickMin + 120);
        for (let d = 0; d < 7; d++) {
          const day = { ...(u[d] || { available: true, windows: [] }) };
          if (!day.available) continue;
          if ((day.windows || []).some(ex => ex.start === minToTime(ns) && ex.end === minToTime(ne))) continue;
          day.windows = [...(day.windows || []), { start: minToTime(ns), end: minToTime(ne) }].sort((a, b) => toMin(a.start) - toMin(b.start));
          u[d] = day;
        }
        wrappedOnUpdate({ weeklyAvailability: u });
      }},
      { label: `Add 30min break at ${timeLabel} on all days`, action: () => {
        const u = { ...wa };
        const breakStart = snapMin(clickMin), breakEnd = snapMin(clickMin + 30);
        for (let d = 0; d < 7; d++) {
          const day = { ...(u[d] || { available: true, windows: [] }) };
          if (!day.available || !(day.windows || []).length) continue;
          // Split any window that contains this break time
          const newWindows = [];
          for (const w of (day.windows || [])) {
            const ws = toMin(w.start), we = toMin(w.end);
            if (ws < breakEnd && we > breakStart && we - ws > 60) {
              // Window contains the break — split it
              if (breakStart > ws) newWindows.push({ start: w.start, end: minToTime(breakStart) });
              if (breakEnd < we) newWindows.push({ start: minToTime(breakEnd), end: w.end });
            } else {
              newWindows.push(w);
            }
          }
          day.windows = newWindows.sort((a, b) => toMin(a.start) - toMin(b.start));
          u[d] = day;
        }
        wrappedOnUpdate({ weeklyAvailability: u });
      }},
    ];
  };

  const buildCommitmentCtx = (c, dow) => {
    const dayName = DAY_NAMES[dow];
    const isOnThisDay = (c.days || []).includes(dow);
    const isMultiDay = (c.days || []).length > 1;
    return [
      { label: 'Edit commitment...', action: () => { setShowCommitmentForm(true); setEditingCommitmentId(c.id); } },
      // Remove this commitment from just this day (keep it on other days)
      ...(isMultiDay && isOnThisDay ? [{
        label: `Remove from ${dayName} only`,
        action: () => {
          const updated = commitments.map(cm => cm.id === c.id ? { ...cm, days: cm.days.filter(d => d !== dow) } : cm);
          wrappedOnUpdateCommitments(updated);
        }
      }] : []),
      // Add a study window during this commitment's time on this day
      { label: `Add study block (${c.start}\u2013${c.end})`, action: () => {
        const day = { ...(wa[dow] || { available: true, windows: [] }) };
        const windows = [...(day.windows || []), { start: c.start, end: c.end }].sort((a, b) => toMin(a.start) - toMin(b.start));
        wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows, available: true } } });
      }},
      { divider: true },
      { label: 'Delete commitment', action: () => removeCommitment(c.id), danger: true },
    ];
  };

  const buildDayCtx = (dow) => [
    { label: (wa[dow]?.available !== false) ? 'Turn day off' : 'Turn day on', action: () => setDayAvailable(dow, !(wa[dow]?.available !== false)) },
    { divider: true },
    { label: 'Copy to weekdays', action: () => copyDayToWeekdays(dow) },
    { label: 'Copy to weekends', action: () => copyDayToWeekends(dow) },
    { label: 'Copy to all days', action: () => copyDayToAll(dow) },
    { divider: true },
    { label: 'Clear all windows', action: () => clearDayWindows(dow), danger: true },
  ];

  const buildMultiSelectCtx = () => {
    const n = selectedBlocks.length;
    const studyBlks = selectedBlocks.filter(b => b.type === 'study');
    const commitmentBlks = selectedBlocks.filter(b => b.type === 'commitment');

    return [
      { label: `Delete ${n} selected block${n > 1 ? 's' : ''}`, action: () => {
        pushUndo();
        let newWa = { ...wa };
        const byDay = {};
        studyBlks.forEach(b => { if (!byDay[b.dow]) byDay[b.dow] = []; byDay[b.dow].push(b.winIdx); });
        for (const [d, indices] of Object.entries(byDay)) {
          const day = { ...(newWa[d] || { available: true, windows: [] }) };
          const sorted = [...indices].sort((a, b) => b - a);
          const windows = [...(day.windows || [])];
          for (const idx of sorted) windows.splice(idx, 1);
          newWa[d] = { ...day, windows, available: windows.length > 0 };
        }
        onUpdate({ weeklyAvailability: newWa });
        if (commitmentBlks.length > 0) {
          const idsToRemove = new Set(commitmentBlks.map(b => b.commitmentId));
          if (onUpdateCommitments) onUpdateCommitments(commitments.filter(c => !idsToRemove.has(c.id)));
        }
        setSelectedBlocks([]);
        setSelectedBlock(null);
      }, danger: true },
      { divider: true },
      ...(studyBlks.length >= 2 ? [
        { label: 'Align start times', action: () => {
          pushUndo();
          const starts = studyBlks.map(b => toMin((wa[b.dow]?.windows || [])[b.winIdx]?.start)).filter(v => !isNaN(v));
          const earliest = Math.min(...starts);
          const newWa = { ...wa };
          studyBlks.forEach(b => {
            const day = { ...(newWa[b.dow] || { available: true, windows: [] }) };
            const windows = [...(day.windows || [])];
            const w = windows[b.winIdx];
            if (w) {
              const dur = toMin(w.end) - toMin(w.start);
              windows[b.winIdx] = { start: minToTime(earliest), end: minToTime(earliest + dur) };
            }
            newWa[b.dow] = { ...day, windows };
          });
          onUpdate({ weeklyAvailability: newWa });
        }},
        { label: 'Align end times', action: () => {
          pushUndo();
          const ends = studyBlks.map(b => toMin((wa[b.dow]?.windows || [])[b.winIdx]?.end)).filter(v => !isNaN(v));
          const latest = Math.max(...ends);
          const newWa = { ...wa };
          studyBlks.forEach(b => {
            const day = { ...(newWa[b.dow] || { available: true, windows: [] }) };
            const windows = [...(day.windows || [])];
            const w = windows[b.winIdx];
            if (w) {
              const dur = toMin(w.end) - toMin(w.start);
              windows[b.winIdx] = { start: minToTime(latest - dur), end: minToTime(latest) };
            }
            newWa[b.dow] = { ...day, windows };
          });
          onUpdate({ weeklyAvailability: newWa });
        }},
        { label: 'Make same duration', action: () => {
          pushUndo();
          const durations = studyBlks.map(b => {
            const w = (wa[b.dow]?.windows || [])[b.winIdx];
            return w ? toMin(w.end) - toMin(w.start) : 0;
          });
          const maxDur = Math.max(...durations);
          const newWa = { ...wa };
          studyBlks.forEach(b => {
            const day = { ...(newWa[b.dow] || { available: true, windows: [] }) };
            const windows = [...(day.windows || [])];
            const w = windows[b.winIdx];
            if (w) windows[b.winIdx] = { start: w.start, end: minToTime(Math.min(toMin(w.start) + maxDur, 1440)) };
            newWa[b.dow] = { ...day, windows };
          });
          onUpdate({ weeklyAvailability: newWa });
        }},
      ] : []),
      { divider: true },
      { label: 'Shift all +15min', action: () => {
        pushUndo();
        const newWa = { ...wa };
        studyBlks.forEach(b => {
          const day = { ...(newWa[b.dow] || { available: true, windows: [] }) };
          const windows = [...(day.windows || [])];
          const w = windows[b.winIdx];
          if (w) {
            const ns = Math.min(toMin(w.start) + 15, 1440 - 30);
            const ne = Math.min(toMin(w.end) + 15, 1440);
            windows[b.winIdx] = { start: minToTime(ns), end: minToTime(ne) };
          }
          newWa[b.dow] = { ...day, windows };
        });
        onUpdate({ weeklyAvailability: newWa });
      }},
      { label: 'Shift all -15min', action: () => {
        pushUndo();
        const newWa = { ...wa };
        studyBlks.forEach(b => {
          const day = { ...(newWa[b.dow] || { available: true, windows: [] }) };
          const windows = [...(day.windows || [])];
          const w = windows[b.winIdx];
          if (w) {
            const ns = Math.max(toMin(w.start) - 15, 0);
            const ne = Math.max(toMin(w.end) - 15, 30);
            windows[b.winIdx] = { start: minToTime(ns), end: minToTime(ne) };
          }
          newWa[b.dow] = { ...day, windows };
        });
        onUpdate({ weeklyAvailability: newWa });
      }},
    ];
  };

  const allOn = DAY_ORDER.every(d => (wa[d] || { available: true }).available);
  const weekdaysOn = [1,2,3,4,5].every(d => (wa[d] || { available: true }).available);
  const weekendsOn = [0,6].every(d => (wa[d] || { available: true }).available);

  // ── Keyboard shortcuts: Delete, Undo/Redo, Arrow nudge, Escape ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';

      // Ctrl+Z: Undo (restores both wa + commitments in a SINGLE update)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey && !isInput) {
        e.preventDefault();
        if (undoStack.current.length > 0) {
          redoStack.current.push({ wa: JSON.stringify(wa), cm: JSON.stringify(commitments) });
          const prev = undoStack.current.pop();
          // Single combined update to avoid race condition between two setPc calls
          onUpdate({ weeklyAvailability: JSON.parse(prev.wa), commitments: JSON.parse(prev.cm) });
        }
        return;
      }
      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey)) && !isInput) {
        e.preventDefault();
        if (redoStack.current.length > 0) {
          undoStack.current.push({ wa: JSON.stringify(wa), cm: JSON.stringify(commitments) });
          const next = redoStack.current.pop();
          onUpdate({ weeklyAvailability: JSON.parse(next.wa), commitments: JSON.parse(next.cm) });
        }
        return;
      }

      // Escape: deselect
      if (e.key === 'Escape') { setSelectedBlock(null); setSelectedBlocks([]); setEditingTimes(null); setCtxMenu(null); return; }

      if (isInput) return;

      // Delete/Backspace: remove block(s)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedBlocks.length > 0) {
          e.preventDefault();
          pushUndo();
          let newWa = { ...wa };
          const mStudy = selectedBlocks.filter(b => b.type === 'study');
          const mComm = selectedBlocks.filter(b => b.type === 'commitment');
          const byDay = {};
          mStudy.forEach(b => { if (!byDay[b.dow]) byDay[b.dow] = []; byDay[b.dow].push(b.winIdx); });
          for (const [d, indices] of Object.entries(byDay)) {
            const day = { ...(newWa[d] || { available: true, windows: [] }) };
            const sorted = [...indices].sort((a, b) => b - a);
            const windows = [...(day.windows || [])];
            for (const idx of sorted) windows.splice(idx, 1);
            newWa[d] = { ...day, windows, available: windows.length > 0 };
          }
          onUpdate({ weeklyAvailability: newWa });
          if (mComm.length > 0 && onUpdateCommitments) {
            const idsToRemove = new Set(mComm.map(b => b.commitmentId));
            onUpdateCommitments(commitments.filter(c => !idsToRemove.has(c.id)));
          }
          setSelectedBlocks([]);
          setSelectedBlock(null);
          return;
        }
        const target = drag || selectedBlock || hoveredBlock;
        if (!target) return;
        e.preventDefault();
        if ((target.type === 'commitment' || target.blockType === 'commitment') && (target.commitmentId)) {
          removeCommitment(target.commitmentId);
        } else if (target.type === 'study' || target.blockType === 'study') {
          removeWindow(target.dow, target.winIdx);
        }
        if (drag) { document.body.style.userSelect = ''; setDrag(null); }
        setSelectedBlock(null);
        setHoveredBlock(null);
        return;
      }

      // Arrow keys: nudge selected blocks (multi or single)
      if (selectedBlocks.length > 0 && ['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        pushUndo();
        const delta = e.key === 'ArrowLeft' ? -15 : 15;
        const newWa = { ...wa };
        selectedBlocks.filter(b => b.type === 'study').forEach(b => {
          const day = { ...(newWa[b.dow] || { available: true, windows: [] }) };
          const windows = [...(day.windows || [])];
          const w = windows[b.winIdx];
          if (w) {
            const ns = clampMin(toMin(w.start) + delta);
            const ne = clampMin(toMin(w.end) + delta);
            if (ne - ns >= MIN_DURATION) windows[b.winIdx] = { start: minToTime(ns), end: minToTime(ne) };
          }
          newWa[b.dow] = { ...day, windows };
        });
        onUpdate({ weeklyAvailability: newWa });
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const target = selectedBlock || hoveredBlock;
        if (!target || target.type !== 'study') return;
        e.preventDefault();
        const day = wa[target.dow];
        if (!day?.windows?.[target.winIdx]) return;
        const w = day.windows[target.winIdx];
        const s = toMin(w.start), en = toMin(w.end);

        if (e.key === 'ArrowLeft') {
          // Move block 15min earlier
          const ns = Math.max(0, s - SNAP);
          updateWindowBoth(target.dow, target.winIdx, minToTime(ns), minToTime(ns + (en - s)));
        } else if (e.key === 'ArrowRight') {
          // Move block 15min later
          const ne = Math.min(1440, en + SNAP);
          updateWindowBoth(target.dow, target.winIdx, minToTime(ne - (en - s)), minToTime(ne));
        } else if (e.key === 'ArrowUp') {
          // Shrink block by 15min from end
          if (en - s > MIN_DURATION) updateWindowBoth(target.dow, target.winIdx, w.start, minToTime(en - SNAP));
        } else if (e.key === 'ArrowDown') {
          // Grow block by 15min at end
          const ne = Math.min(1440, en + SNAP);
          updateWindowBoth(target.dow, target.winIdx, w.start, minToTime(ne));
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drag, hoveredBlock, selectedBlock, selectedBlocks, wa, commitments]);

  // ── Conflict detection ──
  const getConflicts = (dow) => {
    const day = wa[dow] || { available: true, windows: [] };
    const dc = commitments.filter(c => c.days?.includes(dow));
    const conflicts = [];
    for (let a = 0; a < dc.length; a++) for (let b = a + 1; b < dc.length; b++)
      if (toMin(dc[a].start) < toMin(dc[b].end) && toMin(dc[b].start) < toMin(dc[a].end))
        conflicts.push({ type: 'overlap', msg: `"${dc[a].label}" and "${dc[b].label}" overlap` });
    for (const w of (day.windows || [])) for (const c of dc)
      if (toMin(c.start) <= toMin(w.start) && toMin(c.end) >= toMin(w.end))
        conflicts.push({ type: 'blocked', msg: `"${c.label}" completely blocks ${w.start}-${w.end}` });
    // Study window overlaps with commitments (partial)
    for (const w of (day.windows || [])) for (const c of dc) {
      const oS = Math.max(toMin(w.start), toMin(c.start)), oE = Math.min(toMin(w.end), toMin(c.end));
      if (oE > oS && !(toMin(c.start) <= toMin(w.start) && toMin(c.end) >= toMin(w.end)))
        conflicts.push({ type: 'warn', msg: `Study ${w.start}-${w.end} overlaps "${c.label}" by ${Math.round((oE - oS) / 60 * 10) / 10}h` });
    }
    // Study window to study window overlaps
    const wins = day.windows || [];
    for (let a = 0; a < wins.length; a++) for (let b = a + 1; b < wins.length; b++)
      if (toMin(wins[a].start) < toMin(wins[b].end) && toMin(wins[b].start) < toMin(wins[a].end))
        conflicts.push({ type: 'warn', msg: `Study windows overlap: ${wins[a].start}-${wins[a].end} and ${wins[b].start}-${wins[b].end}` });
    const hrs = getEffectiveHours(plannerConfig, dow);
    if (day.available && hrs > 0 && hrs < 1) conflicts.push({ type: 'tiny', msg: `Only ${hrs}h remaining` });
    return conflicts;
  };

  // ── Drag handling (study windows + commitments) ──
  const handleBlockMouseDown = (e, dow, winIdx, mode, blockType, commitmentId) => {
    e.stopPropagation(); e.preventDefault();
    // Capture undo snapshot before any drag operation
    pushUndo();
    const barEl = barRefs.current[dow]; if (!barEl) return;
    const barRect = barEl.getBoundingClientRect();
    const day = wa[dow] || { available: true, windows: [] };
    const dayComm = commitments.filter(c => c.days?.includes(dow));

    let origStart, origEnd;
    if (blockType === 'commitment') {
      const c = dayComm[winIdx];
      origStart = toMin(c.start); origEnd = toMin(c.end);
    } else {
      const w = day.windows[winIdx];
      origStart = toMin(w.start); origEnd = toMin(w.end);
    }

    // Build "others" list — all blocks on this day except the one being dragged
    const others = [];
    (day.windows || []).forEach((w, i) => { if (blockType !== 'study' || i !== winIdx) others.push({ start: toMin(w.start), end: toMin(w.end) }); });
    dayComm.forEach((c, i) => { if (blockType !== 'commitment' || i !== winIdx) others.push({ start: toMin(c.start), end: toMin(c.end) }); });

    document.body.style.userSelect = 'none';
    // Capture original positions of all selected blocks for multi-drag
    const multiOriginals = selectedBlocks.length > 1 ? selectedBlocks.filter(b => b.type === 'study').map(b => {
      const d = wa[b.dow] || { available: true, windows: [] };
      const w = (d.windows || [])[b.winIdx];
      return w ? { ...b, origStart: toMin(w.start), origEnd: toMin(w.end) } : null;
    }).filter(Boolean) : [];
    setDrag({ dow, winIdx, mode, startX: e.clientX, barWidth: barRect.width, origStart, origEnd, others, blockType, commitmentId, multiOriginals });
  };

  useEffect(() => {
    if (!drag) return;
    const handleMouseMove = (e) => {
      const deltaMin = snapMin(((e.clientX - drag.startX) / drag.barWidth) * 1440);

      // If this block is part of a multi-selection and we're in move mode, move ALL selected blocks
      const isPartOfMultiSelect = selectedBlocks.length > 1 && drag.mode === 'move' &&
        selectedBlocks.some(b => b.dow === drag.dow && b.winIdx === drag.winIdx && b.type === drag.blockType);

      if (isPartOfMultiSelect && drag.multiOriginals?.length > 0) {
        // Move all selected study blocks by the same absolute delta from their original positions
        const newWa = { ...wa };
        for (const orig of drag.multiOriginals) {
          const day = { ...(newWa[orig.dow] || { available: true, windows: [] }) };
          const windows = [...(day.windows || [])];
          const dur = orig.origEnd - orig.origStart;
          let ns = clampMin(snapMin(orig.origStart + deltaMin));
          let ne = ns + dur;
          if (ne > 1440) { ne = 1440; ns = ne - dur; }
          if (ns < 0) { ns = 0; ne = dur; }
          windows[orig.winIdx] = { ...windows[orig.winIdx], start: minToTime(ns), end: minToTime(ne) };
          newWa[orig.dow] = { ...day, windows };
        }
        onUpdate({ weeklyAvailability: newWa });
        return;
      }

      // Single block drag (existing logic)
      let newStart, newEnd;
      if (drag.mode === 'move') {
        const dur = drag.origEnd - drag.origStart;
        newStart = snapMin(drag.origStart + deltaMin); newEnd = newStart + dur;
        if (newEnd > 1440) { newEnd = 1440; newStart = newEnd - dur; }
        if (newStart < 0) { newStart = 0; newEnd = dur; }
      } else if (drag.mode === 'resize-start') {
        newStart = snapMin(drag.origStart + deltaMin); newEnd = drag.origEnd;
        if (newEnd - newStart < MIN_DURATION) newStart = newEnd - MIN_DURATION;
      } else {
        newStart = drag.origStart; newEnd = snapMin(drag.origEnd + deltaMin);
        if (newEnd - newStart < MIN_DURATION) newEnd = newStart + MIN_DURATION;
      }
      newStart = clampMin(newStart); newEnd = clampMin(newEnd);
      if (newEnd - newStart < MIN_DURATION) return;

      if (drag.blockType === 'commitment' && onUpdateCommitment) {
        onUpdateCommitment(drag.commitmentId, minToTime(newStart), minToTime(newEnd));
      } else {
        const day = { ...(wa[drag.dow] || { available: true, windows: [] }) };
        const windows = [...(day.windows || [])];
        windows[drag.winIdx] = { ...windows[drag.winIdx], start: minToTime(newStart), end: minToTime(newEnd) };
        onUpdate({ weeklyAvailability: { ...wa, [drag.dow]: { ...day, windows } } });
      }
    };
    const handleMouseUp = () => { document.body.style.userSelect = ''; setDrag(null); };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [drag]);

  // ── Selection box drag (unified rectangle across days) ──
  useEffect(() => {
    if (!selectionBox) return;
    const handleMouseMove = (e) => {
      const wrapRect = wrapperRef.current?.getBoundingClientRect();
      if (!wrapRect) return;
      setSelectionBox(prev => prev ? {
        ...prev,
        currentX: e.clientX - wrapRect.left,
        currentY: e.clientY - wrapRect.top,
      } : null);
    };
    const handleMouseUp = () => {
      document.body.style.userSelect = '';
      if (selectionBox && wrapperRef.current) {
        const wrapRect = wrapperRef.current.getBoundingClientRect();
        // Convert pixel rectangle to block selection
        const selLeft = Math.min(selectionBox.startX, selectionBox.currentX);
        const selRight = Math.max(selectionBox.startX, selectionBox.currentX);
        const selTop = Math.min(selectionBox.startY, selectionBox.currentY);
        const selBottom = Math.max(selectionBox.startY, selectionBox.currentY);
        // Only select if dragged at least 5px in any direction
        if (selRight - selLeft > 5 || selBottom - selTop > 5) {
          const selected = [];
          for (const d of DAY_ORDER) {
            const barEl = barRefs.current[d];
            if (!barEl) continue;
            const barRect = barEl.getBoundingClientRect();
            const barTop = barRect.top - wrapRect.top;
            const barBottom = barRect.bottom - wrapRect.top;
            const barLeft = barRect.left - wrapRect.left;
            const barWidth = barRect.width;
            // Check if this day's bar overlaps the selection vertically
            if (barBottom < selTop || barTop > selBottom) continue;
            // Convert horizontal pixel range to time range
            const timeStart = Math.max(0, ((selLeft - barLeft) / barWidth) * 1440);
            const timeEnd = Math.min(1440, ((selRight - barLeft) / barWidth) * 1440);
            const day = wa[d] || { available: true, windows: [] };
            const dayComm = commitments.filter(c => c.days?.includes(d));
            (day.windows || []).forEach((w, wi) => {
              const ws = toMin(w.start), we = toMin(w.end);
              if (ws < timeEnd && we > timeStart) selected.push({ dow: d, winIdx: wi, type: 'study' });
            });
            dayComm.forEach((c, ci) => {
              const cs = toMin(c.start), ce = toMin(c.end);
              if (cs < timeEnd && ce > timeStart) selected.push({ dow: d, winIdx: ci, type: 'commitment', commitmentId: c.id });
            });
          }
          setSelectedBlocks(selected);
        }
      }
      setSelectionBox(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp); };
  }, [selectionBox]);

  // ── Double-click to add a new study window ──
  const handleBarDoubleClick = (e, dow) => {
    const day = wa[dow] || { available: true, windows: [] };
    const barEl = barRefs.current[dow]; if (!barEl) return;
    const rect = barEl.getBoundingClientRect();
    const clickMin = e._forceMin != null ? e._forceMin : snapMin(((e.clientX - rect.left) / rect.width) * 1440);
    const dayComm = commitments.filter(c => c.days?.includes(dow));
    let ns = snapMin(clickMin - 60), ne = snapMin(clickMin + 60);
    ns = Math.max(0, ns); ne = Math.min(1440, ne);
    if (ne - ns < MIN_DURATION) ne = ns + MIN_DURATION;
    const windows = [...(day.windows || []), { start: minToTime(ns), end: minToTime(ne) }].sort((a, b) => toMin(a.start) - toMin(b.start));
    wrappedOnUpdate({ weeklyAvailability: { ...wa, [dow]: { ...day, windows, available: true } } });
  };

  // ── Weekly totals ──
  let weeklyHours = 0, studyDays = 0;
  for (let d = 0; d < 7; d++) { const hrs = getEffectiveHours(plannerConfig, d); if (hrs > 0) { weeklyHours += hrs; studyDays++; } }

  return (
    <div>
      {/* Toggle switches */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <ToggleSwitch label="All" isOn={allOn} onClick={() => setAllDays(!allOn)} T={T} />
        <ToggleSwitch label="Weekdays" isOn={weekdaysOn} onClick={() => setAllWeekdays(!weekdaysOn)} T={T} />
        <ToggleSwitch label="Weekends" isOn={weekendsOn} onClick={() => setAllWeekends(!weekendsOn)} T={T} />
        <span style={{ fontSize: fs(10), color: T.dim, marginLeft: 'auto' }}>Double-click to add {'\u00B7'} Right-click for options</span>
      </div>

      {/* Time axis header — aligned with day rows using same flex structure */}
      <div style={{ display: 'flex', alignItems: 'flex-end', marginBottom: 4, padding: '0 10px' }}>
        <div style={{ width: 18, flexShrink: 0 }} /><div style={{ width: 8 }} />
        <div style={{ width: 40, flexShrink: 0 }} /><div style={{ width: 8 }} />
        <div style={{ flex: 1, height: 22, position: 'relative', background: T.bg2 + '88', borderRadius: 4, borderBottom: `1px solid ${T.border}`, cursor: 'context-menu' }}
          onContextMenu={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const clickMin = snapMin(((e.clientX - rect.left) / rect.width) * 1440);
            openCtx(e, buildAxisCtx(clickMin));
          }}>
          {TIME_LABELS.map((h, idx) => {
            const isFirst = idx === 0;
            const isLast = idx === TIME_LABELS.length - 1;
            const isMajor = h % 6 === 0;
            const isMid = h % 3 === 0 && !isMajor;
            const isMinor = !isMajor && !isMid;
            return (
              <div key={h} style={{
                position: 'absolute', left: `${(h / 24) * 100}%`, bottom: 2,
                transform: isFirst ? 'translateX(0)' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
                fontSize: isMajor ? fs(9) : fs(7),
                color: isMajor ? T.soft : isMid ? T.dim : T.dim + '88',
                fontWeight: isMajor ? 700 : isMid ? 600 : 400,
                fontFamily: "'JetBrains Mono', monospace",
              }}>{isMinor ? `${h % 12 || 12}` : fmtHour(h)}</div>
            );
          })}
        </div>
        <div style={{ width: 8 }} /><div style={{ width: 36, flexShrink: 0 }} />
        <div style={{ width: 8 }} /><div style={{ width: 20, flexShrink: 0 }} />
      </div>

      {/* Day rows wrapper — unified selection overlay renders here */}
      <div ref={wrapperRef} style={{ position: 'relative' }}>
      {/* Unified selection rectangle */}
      {selectionBox && (() => {
        const left = Math.min(selectionBox.startX, selectionBox.currentX);
        const top = Math.min(selectionBox.startY, selectionBox.currentY);
        const width = Math.abs(selectionBox.currentX - selectionBox.startX);
        const height = Math.abs(selectionBox.currentY - selectionBox.startY);
        return <div style={{ position: 'absolute', left, top, width, height, background: T.accent + '12', border: `1px solid ${T.accent}55`, borderRadius: 3, pointerEvents: 'none', zIndex: 20 }} />;
      })()}
      {DAY_ORDER.map(dow => {
        const day = wa[dow] || { available: true, windows: [{ start: '09:00', end: '17:00' }] };
        const hrs = getEffectiveHours(plannerConfig, dow);
        const isOff = !day.available || hrs === 0;
        const dayCommitments = commitments.filter(c => c.days?.includes(dow));
        const conflicts = day.available ? getConflicts(dow) : [];
        const hasConflict = conflicts.length > 0;

        return (
          <div key={dow} style={{ marginBottom: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px' }}>
              {/* Day toggle */}
              <button onClick={() => setDayAvailable(dow, !day.available)}
                style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${day.available ? T.accent : T.border}`, background: day.available ? T.accent + '22' : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(10), color: T.accent, flexShrink: 0 }}>
                {day.available ? '\u2713' : ''}
              </button>

              {/* Day name + conflict dot */}
              <div onContextMenu={(e) => openCtx(e, buildDayCtx(dow))}
                style={{ width: 40, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, cursor: 'context-menu' }}>
                <span style={{ fontSize: fs(12), fontWeight: 700, color: isOff ? T.dim : T.text }}>{DAY_NAMES[dow]}</span>
                {hasConflict && <div title={conflicts[0].msg} style={{ width: 6, height: 6, borderRadius: '50%', background: conflicts[0].type === 'overlap' || conflicts[0].type === 'blocked' ? T.red : conflicts[0].type === 'warn' ? T.orange : T.yellow, flexShrink: 0 }} />}
              </div>

              {/* Timeline bar — height grows with block density */}
              <div ref={el => { if (el) barRefs.current[dow] = el; }}
                style={{ flex: 1, height: Math.max(32, ((day.windows || []).length + dayCommitments.length) > 3 ? 44 : (day.windows || []).length + dayCommitments.length > 1 ? 36 : 32), background: T.bg2, borderRadius: 5, overflow: 'hidden', position: 'relative', cursor: 'default', transition: 'height .2s ease' }}
                onClick={(e) => { if (e.target === barRefs.current[dow]) { setSelectedBlock(null); setSelectedBlocks([]); } }}
                onMouseDown={(e) => {
                  if (e.target !== barRefs.current[dow]) return;
                  if (e.detail >= 2) return;
                  const wrapRect = wrapperRef.current?.getBoundingClientRect();
                  if (!wrapRect) return;
                  const barEl = barRefs.current[dow];
                  const barRect = barEl.getBoundingClientRect();
                  const clickMin = snapMin(((e.clientX - barRect.left) / barRect.width) * 1440);
                  setSelectionBox({
                    startX: e.clientX - wrapRect.left, startY: e.clientY - wrapRect.top,
                    currentX: e.clientX - wrapRect.left, currentY: e.clientY - wrapRect.top,
                    startDow: dow, startMin: clickMin,
                  });
                  setSelectedBlocks([]);
                  document.body.style.userSelect = 'none';
                }}
                onDoubleClick={(e) => handleBarDoubleClick(e, dow)}
                onContextMenu={(e) => {
                  if (selectedBlocks.length > 1) { openCtx(e, buildMultiSelectCtx()); return; }
                  const barEl = barRefs.current[dow]; if (!barEl) return;
                  const rect = barEl.getBoundingClientRect();
                  const clickMin = snapMin(((e.clientX - rect.left) / rect.width) * 1440);
                  if (isOff) {
                    openCtx(e, [
                      { label: 'Turn day on', action: () => setDayAvailable(dow, true) },
                      { label: `Add study window at ${fmtTime(clickMin)}`, action: () => handleBarDoubleClick({ clientX: e.clientX, _forceMin: clickMin, preventDefault: () => {} }, dow) },
                      { divider: true },
                      { label: 'Add commitment here...', action: () => { setCommitmentPrefill({ days: [dow], start: minToTime(clickMin), end: minToTime(Math.min(clickMin + 120, 1440)) }); setShowCommitmentForm(true); } },
                    ]);
                  } else {
                    openCtx(e, buildEmptyCtx(dow, clickMin));
                  }
                }}>
                {/* Hourly grid lines */}
                {GRID_HOURS.map(h => {
                  const isMajor = h % 6 === 0; const isMid = h % 3 === 0 && !isMajor;
                  return <div key={h} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(h / 24) * 100}%`, width: h === 12 ? 1.5 : 1, background: isMajor ? T.soft + '55' : isMid ? T.border + '44' : T.border + '22' }} />;
                })}
                {/* Study windows — draggable + resizable */}
                {!isOff && (day.windows || []).map((w, wi) => {
                  const sMin = toMin(w.start), eMin = toMin(w.end);
                  const left = (sMin / 1440) * 100, width = ((eMin - sMin) / 1440) * 100;
                  const barW = barRefs.current[dow]?.offsetWidth || 600;
                  const pxW = (eMin - sMin) / 1440 * barW;
                  const timeStr = `${fmtTime(sMin)}-${fmtTime(eMin)}`;
                  const isDragging = drag?.blockType === 'study' && drag?.dow === dow && drag?.winIdx === wi;
                  const isSelected = (selectedBlock?.type === 'study' && selectedBlock?.dow === dow && selectedBlock?.winIdx === wi) || isMultiSelected(dow, wi, 'study');
                  return (
                    <div key={wi} title={`Study: ${w.start} - ${w.end}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const blockRef = { dow, winIdx: wi, type: 'study' };
                        if (e.shiftKey) {
                          setSelectedBlocks(prev => {
                            const exists = prev.some(b => b.dow === dow && b.winIdx === wi && b.type === 'study');
                            return exists ? prev.filter(b => !(b.dow === dow && b.winIdx === wi && b.type === 'study')) : [...prev, blockRef];
                          });
                        } else {
                          setSelectedBlock(blockRef);
                          setSelectedBlocks([blockRef]);
                          handleBlockMouseDown(e, dow, wi, 'move', 'study');
                        }
                      }}
                      onContextMenu={(e) => {
                        if (selectedBlocks.length > 1 && isMultiSelected(dow, wi, 'study')) { openCtx(e, buildMultiSelectCtx()); return; }
                        openCtx(e, buildStudyCtx(dow, wi, w));
                      }}
                      onMouseEnter={e => { if (!drag) { e.currentTarget.style.filter = 'brightness(1.3)'; setHoveredBlock({ dow, winIdx: wi, type: 'study' }); } }}
                      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; setHoveredBlock(null); }}
                      style={{ position: 'absolute', top: 3, bottom: 3, left: `${left}%`, width: `${Math.max(2, width)}%`, background: T.accent + (isDragging ? '55' : isSelected ? '66' : '44'), borderRadius: 3, border: isDragging || isSelected ? `2px solid ${T.accent}` : `1px solid ${T.accent}66`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'visible', padding: '0 3px', cursor: drag ? (drag.mode === 'move' ? 'grabbing' : 'col-resize') : 'grab', opacity: isDragging ? 0.85 : 1, zIndex: isDragging ? 10 : isSelected ? 5 : 1, userSelect: 'none', transition: isDragging ? 'none' : 'all .15s', boxShadow: isSelected ? `0 0 8px ${T.accent}44` : 'none' }}>
                      <div onMouseDown={(e) => handleBlockMouseDown(e, dow, wi, 'resize-start', 'study')} style={{ position: 'absolute', left: -2, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 2 }} />
                      <div onMouseDown={(e) => handleBlockMouseDown(e, dow, wi, 'resize-end', 'study')} style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 2 }} />
                      {pxW >= 48 && <span style={{ fontSize: fs(8), color: T.accent, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap', opacity: 0.85, textShadow: '0 1px 2px rgba(0,0,0,0.6)', pointerEvents: 'none' }}>{timeStr}</span>}
                    </div>
                  );
                })}
                {/* Commitment blocks — also draggable + resizable */}
                {dayCommitments.map((c, ci) => {
                  const sMin = toMin(c.start), eMin = toMin(c.end);
                  const left = (sMin / 1440) * 100, width = ((eMin - sMin) / 1440) * 100;
                  const barW = barRefs.current[dow]?.offsetWidth || 600;
                  const pxW = (eMin - sMin) / 1440 * barW;
                  const color = CATEGORY_COLORS[c.category] || CATEGORY_COLORS.other;
                  const timeStr = `${fmtTime(sMin)}-${fmtTime(eMin)}`;
                  const isDragging = drag?.blockType === 'commitment' && drag?.commitmentId === c.id && drag?.dow === dow;
                  const isSelected = (selectedBlock?.type === 'commitment' && selectedBlock?.commitmentId === c.id) || isMultiSelected(dow, ci, 'commitment', c.id);
                  const showBoth = pxW >= 100, showTime = pxW >= 56, showLabel = pxW >= 36;
                  return (
                    <div key={'c' + ci} title={`${c.label}: ${c.start}-${c.end}`}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const blockRef = { dow, winIdx: ci, type: 'commitment', commitmentId: c.id };
                        if (e.shiftKey) {
                          setSelectedBlocks(prev => {
                            const exists = prev.some(b => b.dow === dow && b.winIdx === ci && b.type === 'commitment' && b.commitmentId === c.id);
                            return exists ? prev.filter(b => !(b.dow === dow && b.winIdx === ci && b.type === 'commitment' && b.commitmentId === c.id)) : [...prev, blockRef];
                          });
                        } else {
                          setSelectedBlock(blockRef);
                          setSelectedBlocks([blockRef]);
                          handleBlockMouseDown(e, dow, ci, 'move', 'commitment', c.id);
                        }
                      }}
                      onContextMenu={(e) => {
                        if (selectedBlocks.length > 1 && isMultiSelected(dow, ci, 'commitment', c.id)) { openCtx(e, buildMultiSelectCtx()); return; }
                        openCtx(e, buildCommitmentCtx(c, dow));
                      }}
                      onMouseEnter={e => { if (!drag) { e.currentTarget.style.filter = 'brightness(1.25)'; setHoveredBlock({ dow, winIdx: ci, type: 'commitment', commitmentId: c.id }); } }}
                      onMouseLeave={e => { e.currentTarget.style.filter = 'none'; setHoveredBlock(null); }}
                      style={{ position: 'absolute', top: 3, bottom: 3, left: `${left}%`, width: `${Math.max(2, width)}%`, background: color + (isDragging ? '66' : isSelected ? '77' : '55'), borderRadius: 3, border: isDragging || isSelected ? `2px solid ${color}` : `1px solid ${color}88`, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: '0 3px', gap: 3, cursor: drag ? (drag.mode === 'move' ? 'grabbing' : 'col-resize') : 'grab', opacity: isDragging ? 0.85 : 1, zIndex: isDragging ? 10 : isSelected ? 5 : 2, userSelect: 'none', transition: isDragging ? 'none' : 'all .15s', boxShadow: isSelected ? `0 0 8px ${color}44` : 'none' }}>
                      <div onMouseDown={(e) => handleBlockMouseDown(e, dow, ci, 'resize-start', 'commitment', c.id)} style={{ position: 'absolute', left: -2, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 3 }} />
                      <div onMouseDown={(e) => handleBlockMouseDown(e, dow, ci, 'resize-end', 'commitment', c.id)} style={{ position: 'absolute', right: -2, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 3 }} />
                      {showBoth ? <span style={{ fontSize: fs(9), color, fontWeight: 700, whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.5)', pointerEvents: 'none' }}>{c.label} {timeStr}</span>
                        : showTime ? <span style={{ fontSize: fs(8), color, fontWeight: 700, whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.5)', fontFamily: "'JetBrains Mono', monospace", pointerEvents: 'none' }}>{timeStr}</span>
                        : showLabel ? <span style={{ fontSize: fs(9), color, fontWeight: 700, whiteSpace: 'nowrap', textShadow: '0 1px 2px rgba(0,0,0,0.5)', pointerEvents: 'none' }}>{c.label}</span>
                        : null}
                    </div>
                  );
                })}
                {/* Conflict overlay */}
                {conflicts.filter(c => c.type === 'overlap').length > 0 && dayCommitments.length >= 2 && (() => {
                  const overlaps = [];
                  for (let a = 0; a < dayCommitments.length; a++) for (let b = a + 1; b < dayCommitments.length; b++) {
                    const oS = Math.max(toMin(dayCommitments[a].start), toMin(dayCommitments[b].start));
                    const oE = Math.min(toMin(dayCommitments[a].end), toMin(dayCommitments[b].end));
                    if (oE > oS) overlaps.push({ start: oS, end: oE });
                  }
                  return overlaps.map((o, oi) => <div key={'ov' + oi} style={{ position: 'absolute', top: 3, bottom: 3, left: `${(o.start / 1440) * 100}%`, width: `${((o.end - o.start) / 1440) * 100}%`, background: `repeating-linear-gradient(135deg, ${T.red}44, ${T.red}44 2px, transparent 2px, transparent 6px)`, borderRadius: 3, border: `1px solid ${T.red}66` }} />);
                })()}
                {/* OFF */}
                {isOff && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(10), color: T.dim, fontWeight: 600, background: `repeating-linear-gradient(135deg, transparent, transparent 4px, ${T.border}22 4px, ${T.border}22 8px)` }}>OFF</div>}
              </div>

              {/* Hours label */}
              <span style={{ fontSize: fs(11), color: isOff ? T.dim : T.accent, width: 36, textAlign: 'right', fontWeight: 700, flexShrink: 0 }}>
                {isOff ? '\u2014' : `${hrs}h`}
              </span>

              {/* Overflow menu */}
              <div style={{ position: 'relative', flexShrink: 0, width: 20 }}>
                <button onClick={() => setContextDay(contextDay === dow ? null : dow)}
                  style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: '2px 4px', fontSize: fs(13) }}>{'\u22EF'}</button>
                {contextDay === dow && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', zIndex: 20, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, minWidth: 140, boxShadow: '0 4px 12px rgba(0,0,0,.3)' }}>
                    <button onClick={() => { copyDayToAll(dow); setContextDay(null); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', color: T.text, fontSize: fs(11), cursor: 'pointer', borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.background = T.input} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Copy to all days</button>
                    <button onClick={() => { clearDayWindows(dow); setContextDay(null); }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: 'none', border: 'none', color: T.red, fontSize: fs(11), cursor: 'pointer', borderRadius: 4 }}
                      onMouseEnter={e => e.currentTarget.style.background = T.input} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Clear all windows</button>
                  </div>
                )}
              </div>
            </div>

            {/* Conflict warning */}
            {hasConflict && (
              <div style={{ padding: '2px 10px 2px 76px', fontSize: fs(10), color: conflicts[0].type === 'overlap' || conflicts[0].type === 'blocked' ? T.red : T.orange }}>
                {conflicts[0].msg}
              </div>
            )}
          </div>
        );
      })}

      </div>{/* end wrapper */}

      {/* Weekly summary */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, padding: '6px 10px', background: T.input, borderRadius: 8 }}>
        <span style={{ fontSize: fs(11), color: T.soft }}>{Math.round(weeklyHours * 10) / 10}h/week across {studyDays} day{studyDays !== 1 ? 's' : ''}</span>
        <span style={{ fontSize: fs(11), color: T.text, fontWeight: 600 }}>Avg {studyDays > 0 ? Math.round((weeklyHours / studyDays) * 10) / 10 : 0}h/study day</span>
      </div>

      {/* Inline commitment chips + editor */}
      <div style={{ marginTop: 10, padding: '8px 10px', background: T.input, borderRadius: 8 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: fs(10), color: T.dim, fontWeight: 600 }}>Commitments:</span>
          {commitments.map(c => {
            const color = CATEGORY_COLORS[c.category] || CATEGORY_COLORS.other;
            return (
              <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 16, border: `1px solid ${color}44`, background: color + '18', fontSize: fs(10) }}>
                <span style={{ fontWeight: 600, color }}>{c.label}</span>
                <span style={{ color: T.dim, fontFamily: "'JetBrains Mono',monospace", fontSize: fs(9) }}>{fmtTime(toMin(c.start))}-{fmtTime(toMin(c.end))}</span>
              </span>
            );
          })}
          <button onClick={() => setShowCommitmentForm(!showCommitmentForm)}
            style={{ padding: '3px 10px', borderRadius: 16, border: `1px dashed ${T.border}`, background: 'transparent', color: T.dim, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>
            {showCommitmentForm ? 'Close' : '+ Add'}
          </button>
        </div>
        {showCommitmentForm && (
          <div style={{ marginTop: 8 }}>
            <CommitmentEditor commitments={commitments} onUpdate={updated => { wrappedOnUpdateCommitments(updated); setCommitmentPrefill(null); }} prefill={commitmentPrefill} autoEditId={editingCommitmentId} onAutoEditDone={() => setEditingCommitmentId(null)} />
          </div>
        )}
      </div>

      {/* Set exact times popover */}
      {editingTimes && (
        <div style={{ background: T.panel, border: `1px solid ${T.accent}44`, borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 8 }}>Set Exact Times</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 2 }}>Start</div>
              <input type="time" value={editingTimes.start} onChange={e => setEditingTimes(p => ({ ...p, start: e.target.value }))}
                style={{ padding: '6px 8px', fontSize: fs(12), fontFamily: "'JetBrains Mono', monospace" }} />
            </div>
            <span style={{ fontSize: fs(12), color: T.dim, marginTop: 14 }}>{'\u2192'}</span>
            <div>
              <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 2 }}>End</div>
              <input type="time" value={editingTimes.end} onChange={e => setEditingTimes(p => ({ ...p, end: e.target.value }))}
                style={{ padding: '6px 8px', fontSize: fs(12), fontFamily: "'JetBrains Mono', monospace" }} />
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 6 }}>
              <Btn small onClick={() => { updateWindowBoth(editingTimes.dow, editingTimes.winIdx, editingTimes.start, editingTimes.end); setEditingTimes(null); }}>Apply</Btn>
              <Btn small v="ghost" onClick={() => setEditingTimes(null)}>Cancel</Btn>
            </div>
          </div>
          <div style={{ fontSize: fs(10), color: T.dim }}>{DAY_NAMES[editingTimes.dow]} {'\u00B7'} Window {editingTimes.winIdx + 1}</div>
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && <CtxMenu x={ctxMenu.x} y={ctxMenu.y} items={ctxMenu.items} onClose={() => setCtxMenu(null)} T={T} />}
    </div>
  );
};

export default WeeklyAvailabilityEditor;
