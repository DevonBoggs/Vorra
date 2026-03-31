// FocusMode — full-page overlay for deep work sessions
// Shows only the active task, a large timer, and next-up preview
// Activated by clicking "Start" on a task, exited via Escape or Done

import { useState, useEffect, useCallback } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import { parseTime, fmtTime, minsToStr, nowMins } from '../../utils/helpers.js';
import { useTimer, timerStart, timerStop, timerPause } from '../../systems/timer.js';
import { Badge } from '../ui/Badge.jsx';
import Ic from '../icons/index.jsx';

export const FocusMode = ({ task, nextTask, onDone, onExit, courses }) => {
  const T = useTheme();
  const timer = useTimer();
  const [now, setNow] = useState(nowMins());
  const [showCelebration, setShowCelebration] = useState(false);

  // Update current time every second in focus mode
  useEffect(() => {
    const iv = setInterval(() => setNow(nowMins()), 1000);
    return () => clearInterval(iv);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onExit();
      if (e.key === ' ' && !e.target.closest('input,textarea')) { e.preventDefault(); handleDone(); }
      if (e.key === 'p' || e.key === 'P') {
        if (timer.running) timerPause();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [task]);

  // Start timer for the task on mount
  useEffect(() => {
    if (task && !timer.running) {
      const match = (courses || []).find(c =>
        task.title?.toLowerCase().includes(c.name?.toLowerCase().split(' - ')[0].split(' \u2013 ')[0]) ||
        (c.courseCode && task.title?.toLowerCase().includes(c.courseCode.toLowerCase()))
      );
      const st = parseTime(task.time);
      const et = parseTime(task.endTime);
      const durationMins = st && et ? Math.max(0, et.mins - st.mins) : 25;
      timerStart(task.title, match?.name || '', durationMins);
    }
  }, [task?.id]);

  const handleDone = () => {
    timerStop();
    setShowCelebration(true);
    onDone(task.id);
    // Auto-advance after celebration
    setTimeout(() => {
      setShowCelebration(false);
      if (!nextTask) onExit();
    }, 2000);
  };

  const handlePause = () => {
    if (timer.running) timerPause();
    else {
      const match = (courses || []).find(c =>
        task.title?.toLowerCase().includes(c.name?.toLowerCase().split(' - ')[0]) ||
        (c.courseCode && task.title?.toLowerCase().includes(c.courseCode.toLowerCase()))
      );
      const st = parseTime(task.time);
      const et = parseTime(task.endTime);
      const remaining = st && et ? Math.max(0, et.mins - now) : 25;
      timerStart(task.title, match?.name || '', remaining);
    }
  };

  if (!task) return null;

  const st = parseTime(task.time);
  const et = parseTime(task.endTime);
  const totalMins = st && et ? et.mins - st.mins : 0;
  const elapsedMins = st ? Math.max(0, now - st.mins) : 0;
  const pct = totalMins > 0 ? Math.min(100, Math.round((elapsedMins / totalMins) * 100)) : 0;

  // Timer display
  const timerMins = timer.running ? Math.floor(timer.remaining / 60000) : 0;
  const timerSecs = timer.running ? Math.floor((timer.remaining % 60000) / 1000) : 0;

  const catColors = { study: T.accent, review: T.blue || T.accent, 'exam-prep': T.orange, 'exam-day': T.red, break: T.dim, project: T.purple };
  const color = catColors[task.category] || T.accent;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: T.bg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '40px 20px',
    }}>
      {/* Celebration overlay */}
      {showCelebration && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
          <div className="plan-reveal" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 12 }}>&#10003;</div>
            <div style={{ fontSize: fs(20), fontWeight: 800, color: T.accent }}>Nice work!</div>
            {nextTask && <div style={{ fontSize: fs(12), color: T.dim, marginTop: 8 }}>Next up: {nextTask.title?.split(/[\u2014\-:]/)[0]?.trim()}</div>}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 16, right: 16, display: 'flex', gap: 8 }}>
        <button onClick={onExit} style={{ padding: '6px 16px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.soft, fontSize: fs(11), cursor: 'pointer' }}>
          Exit Focus Mode (Esc)
        </button>
      </div>

      {/* Category badge */}
      <Badge color={color} bg={color + '22'} style={{ marginBottom: 12 }}>{task.category}</Badge>

      {/* Task title */}
      <div style={{ fontSize: fs(22), fontWeight: 800, color: T.text, textAlign: 'center', maxWidth: 600, marginBottom: 8, lineHeight: 1.3 }}>
        {task.title}
      </div>

      {/* Time window */}
      <div style={{ fontSize: fs(13), color: T.dim, marginBottom: 24 }}>
        {st && fmtTime(st.h, st.m)} {et && `\u2192 ${fmtTime(et.h, et.m)}`} ({totalMins > 0 ? minsToStr(totalMins) : '?'})
      </div>

      {/* Large timer */}
      <div style={{ fontSize: fs(56), fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: timer.running ? color : T.dim, marginBottom: 8, letterSpacing: -2 }}>
        {timer.running ? `${timerMins}:${String(timerSecs).padStart(2, '0')}` : minsToStr(Math.max(0, totalMins - elapsedMins))}
      </div>

      {/* Progress bar */}
      <div style={{ width: 300, height: 6, borderRadius: 3, background: T.input, marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: `linear-gradient(90deg, ${color}, ${T.accent})`, transition: 'width 1s linear' }} />
      </div>

      {/* Task notes */}
      {task.notes && (
        <div style={{ fontSize: fs(12), color: T.soft, textAlign: 'center', maxWidth: 500, marginBottom: 24, lineHeight: 1.5, opacity: 0.8 }}>
          {task.notes}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={handleDone}
          style={{ padding: '12px 32px', borderRadius: 10, border: 'none', background: `linear-gradient(135deg, ${T.accent}, ${color})`, color: '#fff', fontSize: fs(14), fontWeight: 700, cursor: 'pointer', boxShadow: `0 4px 16px ${color}44` }}>
          Done (Space)
        </button>
        <button onClick={handlePause}
          style={{ padding: '12px 24px', borderRadius: 10, border: `1.5px solid ${T.border}`, background: T.card, color: T.text, fontSize: fs(14), fontWeight: 600, cursor: 'pointer' }}>
          {timer.running ? 'Pause (P)' : 'Resume (P)'}
        </button>
      </div>

      {/* Next up preview */}
      {nextTask && !showCelebration && (
        <div style={{ position: 'absolute', bottom: 40, textAlign: 'center' }}>
          <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 4 }}>NEXT UP</div>
          <div style={{ fontSize: fs(12), color: T.soft }}>
            {nextTask.title} {parseTime(nextTask.time) && `at ${fmtTime(parseTime(nextTask.time).h, parseTime(nextTask.time).m)}`}
          </div>
        </div>
      )}

      {/* Keyboard shortcut hint */}
      <div style={{ position: 'absolute', bottom: 12, fontSize: fs(9), color: T.dim }}>
        Space = Done | P = Pause/Resume | Esc = Exit
      </div>
    </div>
  );
};

export default FocusMode;
