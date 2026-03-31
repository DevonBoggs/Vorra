// CalendarPage — The Study Hub
// Three-view calendar (Month/Week/Day) with heatmap, streaks, exam markers,
// queue integration, and course progress.

import { useState, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, pad, fmtDateLong, diffDays, parseTime, minsToStr } from "../../utils/helpers.js";
import { getCAT } from "../../constants/categories.js";
import { Badge } from "../../components/ui/Badge.jsx";

function safeArr(v) { return Array.isArray(v) ? v : []; }

const PLAN_COLORS = ['#6366f1', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#4ecdc4', '#f7b731', '#e88bb3'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const CalendarPage = ({ date, setDate, tasks, setPage, Btn, data }) => {
  const T = useTheme();
  const CAT = getCAT(T);
  const d = new Date(date + "T12:00:00");
  const [vm, setVm] = useState(d.getMonth());
  const [vy, setVy] = useState(d.getFullYear());
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'week' | 'day'
  const [showPicker, setShowPicker] = useState(false);
  const [calSearch, setCalSearch] = useState("");
  const [hovDay, setHovDay] = useState(null);
  const today = todayStr();
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Queue data
  const queue = data.taskQueue || [];
  const hasQueue = queue.length > 0;

  // Build queue lookup by doneDate for heatmap
  const queueByDate = useMemo(() => {
    const map = {};
    for (const t of queue) {
      if (t.done && t.doneDate) {
        if (!map[t.doneDate]) map[t.doneDate] = [];
        map[t.doneDate].push(t);
      }
    }
    return map;
  }, [queue]);

  // Merge legacy tasks + queue completions for display
  const getTasksForDate = (ds) => {
    const legacy = safeArr(tasks[ds]);
    const qDone = safeArr(queueByDate[ds]);
    return [...legacy, ...qDone];
  };

  // Study hours for a date (from queue completions)
  const getStudyHours = (ds) => {
    const qDone = safeArr(queueByDate[ds]);
    return Math.round(qDone.reduce((s, t) => s + (t.estimatedMins || 0), 0) / 60 * 10) / 10;
  };

  // Heatmap intensity
  const getHeatBg = (hrs) => {
    if (hrs <= 0) return 'transparent';
    if (hrs < 1.5) return `${T.accent}10`;
    if (hrs < 3) return `${T.accent}18`;
    if (hrs < 5) return `${T.accent}28`;
    return `${T.accent}40`;
  };

  // Streak calculation
  const streak = useMemo(() => {
    let count = 0;
    const d = new Date(today + 'T12:00:00');
    for (let i = 0; i < 365; i++) {
      const ds = d.toISOString().split('T')[0];
      const hasStudy = queueByDate[ds]?.length > 0 || safeArr(tasks[ds]).some(t => t.done);
      if (ds === today && !hasStudy) { d.setDate(d.getDate() - 1); continue; } // today hasn't happened yet
      if (hasStudy) { count++; d.setDate(d.getDate() - 1); }
      else break;
    }
    return count;
  }, [queueByDate, tasks, today]);
  const studiedToday = (queueByDate[today]?.length || 0) > 0 || safeArr(tasks[today]).some(t => t.done);

  // Exam dates from courses
  const examDates = useMemo(() => {
    const map = {};
    for (const c of (data.courses || [])) {
      if (c.examDate) map[c.examDate] = c.courseCode || c.name;
    }
    return map;
  }, [data.courses]);

  // Course colors
  const courseColorMap = useMemo(() => {
    const map = {};
    (data.courses || []).forEach((c, i) => { map[c.courseCode || c.name] = PLAN_COLORS[i % PLAN_COLORS.length]; });
    return map;
  }, [data.courses]);

  // Navigation
  const nav = (delta) => {
    if (viewMode === 'month') {
      let m = vm + delta, y = vy;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      setVm(m); setVy(y);
    } else if (viewMode === 'week') {
      const wd = new Date(date + 'T12:00:00');
      wd.setDate(wd.getDate() + delta * 7);
      setDate(wd.toISOString().split('T')[0]);
    } else {
      const dd = new Date(date + 'T12:00:00');
      dd.setDate(dd.getDate() + delta);
      setDate(dd.toISOString().split('T')[0]);
    }
  };

  // Search
  const searchResults = useMemo(() => {
    if (!calSearch.trim()) return null;
    const q = calSearch.trim().toLowerCase();
    const results = [];
    for (const [dt, dayTasks] of Object.entries(tasks)) {
      for (const t of safeArr(dayTasks)) {
        if (t.title?.toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q)) {
          results.push({ ...t, date: dt });
        }
      }
    }
    // Also search queue
    for (const t of queue) {
      if (t.title?.toLowerCase().includes(q) || (t.course_code || "").toLowerCase().includes(q)) {
        results.push({ ...t, date: t.doneDate || 'queued' });
      }
    }
    return results.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }, [calSearch, tasks, queue]);

  // Month grid data
  const f = new Date(vy, vm, 1).getDay();
  const dim = new Date(vy, vm + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < f; i++) cells.push(null);
  for (let i = 1; i <= dim; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);
  const numRows = cells.length / 7;

  // Week view dates
  const getWeekDates = () => {
    const wd = new Date(date + 'T12:00:00');
    const dow = wd.getDay();
    const start = new Date(wd); start.setDate(start.getDate() - dow);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  };

  // Queue progress for day view
  const getQueueForDay = (ds) => {
    if (!hasQueue) return { todayQ: [], aheadQ: [] };
    const frontierIdx = queue.findIndex(t => !t.done && t.category !== 'break');
    const todayQ = [], aheadQ = [];
    const dailyTarget = 5 * 60; // fallback 5h
    let filled = 0, met = false;

    const ctxStart = Math.max(0, frontierIdx - 3);
    for (let i = ctxStart; i < frontierIdx && i >= 0; i++) {
      if (queue[i].done && queue[i].category !== 'break') todayQ.push(queue[i]);
    }
    for (let i = Math.max(0, frontierIdx); i < queue.length; i++) {
      const t = queue[i];
      if (t.done) { todayQ.push(t); continue; }
      if (!met) { todayQ.push(t); filled += t.estimatedMins || 0; if (filled >= dailyTarget) met = true; }
      else if (aheadQ.length < 5) aheadQ.push(t);
    }
    return { todayQ, aheadQ };
  };

  // ═══ HEADER ═══
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
      <h1 style={{ fontSize: fs(24), fontWeight: 800, margin: 0 }}>Calendar</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* View switcher */}
        <div style={{ display: 'flex', background: T.input, borderRadius: 8, padding: 2 }}>
          {['month', 'week', 'day'].map(v => (
            <button key={v} onClick={() => setViewMode(v)} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: viewMode === v ? T.accent : 'transparent',
              color: viewMode === v ? '#fff' : T.soft,
              fontWeight: viewMode === v ? 700 : 500, fontSize: fs(10), transition: 'all .12s',
            }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        {/* Navigation */}
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', color: T.soft, cursor: 'pointer' }}><Ic.ChevL /></button>
        <button onClick={() => setShowPicker(!showPicker)} style={{ fontSize: fs(14), fontWeight: 700, minWidth: 150, textAlign: 'center', background: 'transparent', border: 'none', cursor: 'pointer', color: T.text }}>
          {viewMode === 'day' ? fmtDateLong(date) : viewMode === 'week' ? `Week of ${new Date(getWeekDates()[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : `${months[vm]} ${vy}`}
        </button>
        <button onClick={() => nav(1)} style={{ background: 'none', border: 'none', color: T.soft, cursor: 'pointer' }}><Ic.ChevR /></button>
        <button onClick={() => { const t = new Date(); setVm(t.getMonth()); setVy(t.getFullYear()); setDate(todayStr()); }} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, cursor: 'pointer', fontSize: fs(10), fontWeight: 600, color: T.accent }}>Today</button>
      </div>
    </div>
  );

  // ═══ STREAK BANNER ═══
  const streakBanner = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, marginBottom: 10, flexShrink: 0 }}>
      <span style={{ fontSize: fs(20), fontWeight: 900, color: streak >= 7 ? '#f59e0b' : T.accent }}>{streak}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>day study streak</div>
        <div style={{ fontSize: fs(9), color: T.dim }}>{streak >= 14 ? 'Incredible consistency!' : streak >= 7 ? 'One full week!' : streak >= 3 ? 'Building momentum' : 'Every day counts'}</div>
      </div>
      {!studiedToday && streak > 0 && (
        <Badge color={T.orange} bg={`${T.orange}22`}>At risk</Badge>
      )}
      {/* Course progress mini-bars */}
      {hasQueue && (
        <div style={{ display: 'flex', gap: 6 }}>
          {(data.courses || []).filter(c => c.status !== 'completed').slice(0, 4).map((c, i) => {
            const code = c.courseCode || c.name;
            const total = queue.filter(t => t.course_code === code && t.category !== 'break').length;
            const done = queue.filter(t => t.course_code === code && t.done && t.category !== 'break').length;
            const pct = total > 0 ? Math.round(done / total * 100) : 0;
            return (
              <div key={code} style={{ textAlign: 'center', minWidth: 40 }}>
                <div style={{ fontSize: fs(8), color: T.dim, fontWeight: 600 }}>{code}</div>
                <div style={{ height: 3, borderRadius: 2, background: T.input, overflow: 'hidden', marginTop: 2 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: PLAN_COLORS[i % PLAN_COLORS.length], borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: fs(7), color: T.dim }}>{pct}%</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ═══ MONTH VIEW ═══
  const monthView = (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gridTemplateRows: `auto repeat(${numRows},1fr)`, gap: 2, borderRadius: 14, overflow: 'hidden', border: `1px solid ${T.border}` }}>
      {DAY_NAMES.map(d => <div key={d} style={{ background: T.panel, padding: '8px', fontSize: fs(10), fontWeight: 700, color: T.dim, textAlign: 'center', textTransform: 'uppercase' }}>{d}</div>)}
      {cells.map((day, i) => {
        if (!day) return <div key={i} style={{ background: T.bg2 }} />;
        const ds = `${vy}-${pad(vm + 1)}-${pad(day)}`;
        const isT = ds === today;
        const isPast = ds < today;
        const isHov = hovDay === ds;
        const dt = getTasksForDate(ds);
        const studyHrs = getStudyHours(ds);
        const hasTasks = dt.length > 0 || studyHrs > 0;
        const doneCount = dt.filter(t => t.done).length;
        const pct = dt.length > 0 ? Math.round(doneCount / dt.length * 100) : (studyHrs > 0 ? 100 : 0);
        const examCourse = examDates[ds];
        const examInDays = examCourse ? diffDays(today, ds) : null;

        // Course dots
        const coursesOnDay = [...new Set(dt.filter(t => t.course_code || t.courseId).map(t => t.course_code || ''))].filter(Boolean);

        return (
          <div key={i} onClick={() => { setDate(ds); setPage('daily'); }} onMouseEnter={() => setHovDay(ds)} onMouseLeave={() => setHovDay(null)}
            style={{
              background: isHov && !isT ? `${T.accent}14` : isT ? `${T.accent}15` : getHeatBg(studyHrs) || T.bg2,
              padding: '6px 6px 4px', cursor: 'pointer',
              borderLeft: isT ? `3px solid ${T.accent}` : examCourse ? `3px solid ${T.red}` : '3px solid transparent',
              opacity: isPast && !isT ? 0.55 : 1, position: 'relative', minHeight: 80,
              display: 'flex', flexDirection: 'column',
              transition: 'all .15s ease', transform: isHov ? 'scale(1.02)' : 'scale(1)',
              boxShadow: isHov ? `0 4px 12px rgba(0,0,0,.15), inset 0 0 0 1px ${T.accent}33` : 'none',
              zIndex: isHov ? 5 : 1,
            }}>
            {/* Date header */}
            <div style={{ fontSize: fs(12), fontWeight: isT ? 800 : 500, color: isT ? T.accent : isPast ? T.dim : T.text, marginBottom: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {isT && <span style={{ width: 5, height: 5, borderRadius: '50%', background: T.accent }} />}
                {day}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                {studyHrs > 0 && <span style={{ fontSize: fs(8), color: T.accent, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace" }}>{studyHrs}h</span>}
                {examCourse && <span style={{ fontSize: fs(7), fontWeight: 800, padding: '1px 4px', borderRadius: 3, background: examInDays <= 3 ? T.red : examInDays <= 7 ? T.orange : `${T.red}33`, color: examInDays <= 7 ? '#fff' : T.red }}>{examInDays > 0 ? `${examInDays}d` : 'EXAM'}</span>}
              </span>
            </div>
            {/* Exam banner */}
            {examCourse && (
              <div style={{ fontSize: fs(8), padding: '2px 4px', borderRadius: 3, background: `${T.red}20`, color: T.red, fontWeight: 700, textAlign: 'center', marginBottom: 2 }}>{examCourse} Exam</div>
            )}
            {/* Task previews */}
            <div style={{ flex: 1 }}>
              {dt.filter(t => t.category !== 'break').slice(0, 2).map((t, j) => {
                const cc = courseColorMap[t.course_code] || (CAT[t.category] || CAT.other).fg;
                return (
                  <div key={j} style={{ fontSize: fs(9), padding: '1px 4px', borderRadius: 3, marginBottom: 1, borderLeft: `2px solid ${cc}`, color: t.done ? T.dim : T.soft, textDecoration: t.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title?.replace(/^[A-Z]\d{3}\s*[—–-]\s*/, '').slice(0, 30)}
                  </div>
                );
              })}
              {dt.length > 2 && <div style={{ fontSize: fs(8), color: T.dim }}>+{dt.length - 2}</div>}
            </div>
            {/* Course dots + progress */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {coursesOnDay.slice(0, 4).map((cc, ci) => (
                  <div key={ci} style={{ width: 5, height: 5, borderRadius: '50%', background: courseColorMap[cc] || T.accent }} />
                ))}
              </div>
              {pct > 0 && (
                <div style={{ width: 24, height: 3, borderRadius: 2, background: T.input, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: pct >= 100 ? T.accent : T.blue }} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ═══ WEEK VIEW ═══
  const weekDates = getWeekDates();
  const weekView = (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Week header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2 }}>
        {weekDates.map(ds => {
          const isT = ds === today;
          const wd = new Date(ds + 'T12:00:00');
          const hrs = getStudyHours(ds);
          return (
            <div key={ds} onClick={() => { setDate(ds); setPage('daily'); }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 4px 12px rgba(0,0,0,.15)`; e.currentTarget.style.borderColor = T.accent; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = isT ? T.accent : T.border; }}
              style={{ padding: '8px', background: isT ? `${T.accent}15` : T.panel, borderRadius: 8, cursor: 'pointer', textAlign: 'center', border: isT ? `2px solid ${T.accent}` : `1px solid ${T.border}`, transition: 'all .15s ease' }}>
              <div style={{ fontSize: fs(9), fontWeight: 700, color: T.dim, textTransform: 'uppercase' }}>{DAY_NAMES[wd.getDay()]}</div>
              <div style={{ fontSize: fs(16), fontWeight: isT ? 800 : 600, color: isT ? T.accent : T.text }}>{wd.getDate()}</div>
              {hrs > 0 && <div style={{ fontSize: fs(9), color: T.accent, fontWeight: 700 }}>{hrs}h</div>}
            </div>
          );
        })}
      </div>
      {/* Week task columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, flex: 1, overflow: 'hidden' }}>
        {weekDates.map(ds => {
          const dt = getTasksForDate(ds);
          const isPast = ds < today;
          const isT = ds === today;
          const examCourse = examDates[ds];
          return (
            <div key={ds} onClick={() => { setDate(ds); setPage('daily'); }}
              onMouseEnter={e => { e.currentTarget.style.background = `${T.accent}10`; e.currentTarget.style.borderColor = `${T.accent}44`; }}
              onMouseLeave={e => { e.currentTarget.style.background = T.bg2; e.currentTarget.style.borderColor = 'transparent'; }}
              style={{ background: T.bg2, borderRadius: 8, padding: 6, overflow: 'auto', opacity: isPast && !isT ? 0.5 : 1, cursor: 'pointer', border: '1px solid transparent', transition: 'all .12s ease' }}>
              {examCourse && <div style={{ fontSize: fs(8), padding: '2px 4px', borderRadius: 3, background: `${T.red}20`, color: T.red, fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>{examCourse}</div>}
              {dt.filter(t => t.category !== 'break').slice(0, 8).map((t, j) => {
                const cc = courseColorMap[t.course_code] || T.accent;
                return (
                  <div key={j} style={{ fontSize: fs(9), padding: '3px 4px', borderRadius: 4, marginBottom: 2, borderLeft: `2px solid ${cc}`, background: t.done ? 'transparent' : `${cc}08`, color: t.done ? T.dim : T.text, textDecoration: t.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.done ? '✓ ' : ''}{t.title?.replace(/^[A-Z]\d{3}\s*[—–-]\s*/, '').slice(0, 25)}
                  </div>
                );
              })}
              {dt.length > 8 && <div style={{ fontSize: fs(8), color: T.dim, textAlign: 'center' }}>+{dt.length - 8}</div>}
              {dt.length === 0 && <div style={{ fontSize: fs(9), color: T.dim, textAlign: 'center', padding: 8 }}>—</div>}
            </div>
          );
        })}
      </div>
      {/* Week summary */}
      <div style={{ display: 'flex', gap: 12, padding: '8px 12px', background: T.card, borderRadius: 8, border: `1px solid ${T.border}`, fontSize: fs(10), color: T.dim, justifyContent: 'center' }}>
        <span style={{ fontWeight: 700, color: T.text }}>{weekDates.reduce((s, ds) => s + getStudyHours(ds), 0).toFixed(1)}h studied</span>
        <span>{weekDates.reduce((s, ds) => s + getTasksForDate(ds).filter(t => t.done).length, 0)} tasks done</span>
        {streak > 0 && <span style={{ color: '#f59e0b' }}>{streak}-day streak</span>}
      </div>
    </div>
  );

  // ═══ DAY VIEW ═══
  const dayViewContent = (() => {
    const ds = date;
    const isT = ds === today;
    const dt = getTasksForDate(ds);
    const studyHrs = getStudyHours(ds);
    const examCourse = examDates[ds];
    const { todayQ, aheadQ } = getQueueForDay(ds);

    // Use queue if available and viewing today, otherwise show legacy tasks
    const showQueue = hasQueue && isT && todayQ.length > 0;

    return (
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Day stats */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{studyHrs || 0}h</div>
            <div style={{ fontSize: fs(9), color: T.dim }}>studied</div>
          </div>
          <div style={{ flex: 1, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: '10px 14px' }}>
            <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{dt.filter(t => t.done).length}/{dt.length}</div>
            <div style={{ fontSize: fs(9), color: T.dim }}>tasks done</div>
          </div>
          {examCourse && (
            <div style={{ flex: 1, background: `${T.red}15`, border: `1px solid ${T.red}44`, borderRadius: 8, padding: '10px 14px' }}>
              <div style={{ fontSize: fs(14), fontWeight: 800, color: T.red }}>{examCourse}</div>
              <div style={{ fontSize: fs(9), color: T.red }}>Exam Day</div>
            </div>
          )}
        </div>

        {/* Queue tasks (today) or legacy tasks (other days) */}
        {showQueue ? (
          <div>
            <div style={{ fontSize: fs(10), fontWeight: 600, color: T.dim, marginBottom: 6 }}>STUDY QUEUE</div>
            {todayQ.filter(t => t.category !== 'break' || !t.done).map((t, i) => {
              const cc = courseColorMap[t.course_code] || T.accent;
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 3, borderRadius: 6, background: t.done ? `${T.card}88` : T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${t.done ? T.dim : cc}`, opacity: t.done ? 0.5 : 1, cursor: 'pointer' }}
                  onClick={() => setPage('daily')}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${t.done ? T.accent : T.border}`, background: t.done ? T.accentD : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {t.done && <Ic.Check s={9} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: fs(11), fontWeight: 600, color: t.done ? T.dim : T.text, textDecoration: t.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</div>
                    {t.subtitle && !t.done && <div style={{ fontSize: fs(9), color: T.soft, marginTop: 1 }}>{t.subtitle}</div>}
                  </div>
                  <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>{minsToStr(t.estimatedMins || 60)}</span>
                </div>
              );
            })}
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <button onClick={() => setPage('daily')} style={{ padding: '6px 16px', borderRadius: 6, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(10), fontWeight: 600, cursor: 'pointer' }}>Open Daily Planner</button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: fs(10), fontWeight: 600, color: T.dim, marginBottom: 6 }}>{dt.length > 0 ? 'TASKS' : 'NO TASKS'}</div>
            {dt.map((t, i) => {
              const c = CAT[t.category] || CAT.other;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', marginBottom: 3, borderRadius: 6, background: T.card, border: `1px solid ${T.border}`, borderLeft: `3px solid ${c.fg}`, opacity: t.done ? 0.5 : 1 }}>
                  <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace", minWidth: 40 }}>{t.time || '—'}</span>
                  <span style={{ flex: 1, fontSize: fs(11), color: t.done ? T.dim : T.text, textDecoration: t.done ? 'line-through' : 'none' }}>{t.title}</span>
                  <Badge color={c.fg} bg={c.bg}>{c.l || t.category}</Badge>
                </div>
              );
            })}
            {dt.length === 0 && !showQueue && (
              <div style={{ padding: '40px 0', textAlign: 'center' }}>
                <div style={{ fontSize: fs(30), marginBottom: 8, opacity: 0.3 }}>📅</div>
                <p style={{ color: T.dim, fontSize: fs(12) }}>No tasks for this day</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  })();

  // ═══ MONTH PICKER ═══
  const picker = showPicker && (
    <div className="fade" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 12, boxShadow: '0 4px 16px rgba(0,0,0,.15)', maxWidth: 320, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <button onClick={() => setVy(vy - 1)} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: fs(11), color: T.soft }}>◀</button>
        <span style={{ flex: 1, textAlign: 'center', fontSize: fs(14), fontWeight: 700, color: T.text }}>{vy}</span>
        <button onClick={() => setVy(vy + 1)} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: fs(11), color: T.soft }}>▶</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
        {months.map((m, i) => (
          <button key={i} onClick={() => { setVm(i); setShowPicker(false); }} style={{ padding: '6px 4px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: fs(12), fontWeight: vm === i ? 700 : 400, background: vm === i ? T.accentD : 'transparent', color: vm === i ? T.accent : T.soft }}>{m}</button>
        ))}
      </div>
    </div>
  );

  // ═══ SEARCH ═══
  const searchBar = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexShrink: 0 }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <input value={calSearch} onChange={e => setCalSearch(e.target.value)} placeholder="Search tasks..." style={{ width: '100%', padding: '7px 12px 7px 30px', fontSize: fs(11), borderRadius: 8, border: `1px solid ${T.border}`, background: T.input, color: T.text }} />
        <Ic.IcSearch s={13} c={T.dim} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
      </div>
      {calSearch && <Btn small v="ghost" onClick={() => setCalSearch("")}>Clear</Btn>}
    </div>
  );

  const searchView = searchResults && (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 10, maxHeight: 250, overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ fontSize: fs(10), fontWeight: 700, color: T.soft, marginBottom: 6 }}>{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</div>
      {searchResults.slice(0, 20).map((t, i) => {
        const c = CAT[t.category] || CAT.other;
        return (
          <div key={i} onClick={() => { setDate(t.date || todayStr()); setPage('daily'); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 5, cursor: 'pointer', fontSize: fs(10), marginBottom: 2, background: T.input }}>
            <span style={{ color: T.dim, fontFamily: "'JetBrains Mono',monospace", minWidth: 55, fontSize: fs(9) }}>{t.date === 'queued' ? 'queued' : new Date((t.date || '') + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span style={{ flex: 1, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
            <Badge color={c.fg} bg={c.bg}>{c.l || t.category}</Badge>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="fade" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 56px)' }}>
      {header}
      {streakBanner}
      {searchBar}
      {searchView}
      {picker}
      {viewMode === 'month' && monthView}
      {viewMode === 'week' && weekView}
      {viewMode === 'day' && dayViewContent}
    </div>
  );
};

export { CalendarPage };
export default CalendarPage;
