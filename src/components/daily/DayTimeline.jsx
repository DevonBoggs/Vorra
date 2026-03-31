// DayTimeline — vertical timeline with time ruler, proportional task blocks, and now-line
// Replaces the flat task list with a visual schedule

import { useState, useEffect, useRef } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import { parseTime, fmtTime, minsToStr, nowMins, todayStr } from '../../utils/helpers.js';
import { Badge } from '../ui/Badge.jsx';
import Ic from '../icons/index.jsx';

const PIXELS_PER_MIN = 1.5; // 90px per hour
const HOUR_HEIGHT = 60 * PIXELS_PER_MIN;

const TimeRuler = ({ startHour, endHour, T }) => {
  const hours = [];
  for (let h = startHour; h <= endHour; h++) {
    hours.push(h);
  }
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: 45, height: (endHour - startHour + 1) * HOUR_HEIGHT }}>
      {hours.map(h => (
        <div key={h} style={{ position: 'absolute', top: (h - startHour) * HOUR_HEIGHT, width: '100%', display: 'flex', alignItems: 'flex-start' }}>
          <span style={{ fontSize: fs(11), color: T.dim, fontFamily: "'JetBrains Mono', monospace", width: 40, textAlign: 'right', paddingRight: 4, marginTop: -5 }}>
            {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
          </span>
        </div>
      ))}
    </div>
  );
};

const NowLine = ({ now, startHour, T, isToday }) => {
  if (!isToday) return null;
  const top = (now / 60 - startHour) * HOUR_HEIGHT;
  if (top < 0) return null;
  return (
    <div style={{ position: 'absolute', left: 40, right: 0, top, zIndex: 10, display: 'flex', alignItems: 'center', pointerEvents: 'none' }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.red || T.accent, flexShrink: 0 }} />
      <div style={{ flex: 1, height: 2, background: T.red || T.accent, opacity: 0.6 }} />
    </div>
  );
};

const TimelineBlock = ({ task, startHour, isActive, isOverdue, isDone, isUpcoming, now, T, onToggle, onEdit, onDelete, onExpand, expanded, deleteConfirmId, setDeleteConfirmId }) => {
  const st = parseTime(task.time);
  const et = parseTime(task.endTime);
  if (!st || !et) return null;

  const top = (st.mins / 60 - startHour) * HOUR_HEIGHT;
  const height = Math.max(20, (et.mins - st.mins) / 60 * HOUR_HEIGHT);
  const isBreak = task.category === 'break';

  const catColors = { study: T.accent, review: T.blue || T.accent, 'exam-prep': T.orange, 'exam-day': T.red, break: T.dim, project: T.purple, class: T.blue, health: '#4ecdc4', work: '#f7b731', personal: '#e88bb3' };
  const color = catColors[task.category] || T.accent;

  const stateStyle = isDone ? { opacity: 0.4, borderLeftColor: color }
    : isActive ? { borderLeftColor: color, boxShadow: `0 0 12px ${color}33`, background: `${color}12` }
    : isOverdue ? { borderLeftColor: T.red || T.orange, opacity: 0.8 }
    : isUpcoming ? { borderLeftColor: color, background: `${color}08` }
    : { borderLeftColor: color };

  return (
    <div
      onClick={() => onExpand(task.id)}
      style={{
        position: 'absolute', left: 50, right: 8, top, height: expanded ? 'auto' : height, minHeight: height,
        borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
        background: expanded ? T.card : isBreak ? `repeating-linear-gradient(135deg, ${T.input}, ${T.input} 4px, transparent 4px, transparent 8px)` : T.card,
        border: `1px solid ${expanded ? color + '66' : isDone ? T.border : isActive ? color + '55' : T.border}`,
        borderLeft: `3px solid ${stateStyle.borderLeftColor}`,
        opacity: stateStyle.opacity || 1,
        boxShadow: expanded ? `0 8px 24px rgba(0,0,0,.3), 0 0 0 1px ${color}22` : stateStyle.boxShadow || 'none',
        transition: 'all .15s ease',
        zIndex: expanded ? 20 : isActive ? 5 : 1,
        overflow: 'hidden',
      }}
    >
      {/* Compact view */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Checkbox */}
        <button onClick={e => { e.stopPropagation(); onToggle(task.id); }}
          style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${isDone ? T.accent : T.border}`, background: isDone ? T.accentD : 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0 }}>
          {isDone && <Ic.Check s={10} />}
        </button>

        <span style={{ fontSize: fs(13), fontWeight: 600, color: isDone ? T.dim : T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isDone ? 'line-through' : 'none' }}>
          {task.title}
        </span>

        <span style={{ fontSize: fs(11), color: T.dim, fontFamily: "'JetBrains Mono', monospace", flexShrink: 0 }}>
          {minsToStr(et.mins - st.mins)}
        </span>

        {isActive && <Badge color={color} bg={color + '22'}>NOW</Badge>}
        {isOverdue && !isDone && <Badge color={T.red} bg={T.red + '22'}>OVERDUE</Badge>}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }} className="plan-reveal">
          <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 6 }}>
            {fmtTime(st.h, st.m)} - {fmtTime(et.h, et.m)} ({minsToStr(et.mins - st.mins)})
            {task.category !== 'study' && <Badge color={color} bg={color + '22'} style={{ marginLeft: 6 }}>{task.category}</Badge>}
          </div>
          {task.notes && <div style={{ fontSize: fs(10), color: T.soft, marginBottom: 6, lineHeight: 1.4 }}>{task.notes}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            {!isDone && <button onClick={e => { e.stopPropagation(); onToggle(task.id); }} style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>{isDone ? 'Undo' : 'Mark Done'}</button>}
            {isDone && <button onClick={e => { e.stopPropagation(); onToggle(task.id); }} style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${T.orange}`, background: T.orangeD, color: T.orange, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>Undo Done</button>}
            {onEdit && <button onClick={e => { e.stopPropagation(); onEdit(task); }} style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.soft, fontSize: fs(10), cursor: 'pointer' }}>Edit</button>}
            {onDelete && (deleteConfirmId === task.id ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={e => { e.stopPropagation(); onDelete(task.id); }} style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${T.red}`, background: T.redD, color: T.red, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>Confirm Delete</button>
                <button onClick={e => { e.stopPropagation(); setDeleteConfirmId && setDeleteConfirmId(null); }} style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.dim, fontSize: fs(10), cursor: 'pointer' }}>Cancel</button>
              </div>
            ) : (
              <button onClick={e => { e.stopPropagation(); onDelete(task.id); }} style={{ padding: '4px 12px', borderRadius: 5, border: `1px solid ${T.red}44`, background: T.redD, color: T.red, fontSize: fs(10), cursor: 'pointer' }}>Delete</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const DayTimeline = ({ tasks, date, now, currentId, onToggle, onEdit, onDelete }) => {
  const T = useTheme();
  const containerRef = useRef(null);
  const [expandedId, setExpandedId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const isToday = date === todayStr();

  // Compute time range
  const allTimes = tasks.map(t => parseTime(t.time)).filter(Boolean);
  const allEnds = tasks.map(t => parseTime(t.endTime)).filter(Boolean);
  if (allTimes.length === 0) return null;

  const startHour = Math.max(0, Math.floor(Math.min(...allTimes.map(t => t.mins)) / 60) - 1);
  const endHour = Math.min(24, Math.ceil(Math.max(...allEnds.map(t => t.mins)) / 60) + 1);
  const totalHeight = (endHour - startHour + 1) * HOUR_HEIGHT;

  // Find the "next upcoming" task for styling
  const nextUpId = (() => {
    for (const t of tasks) {
      if (!t.done && t.id !== currentId) {
        const st = parseTime(t.time);
        if (st && st.mins > now) return t.id;
      }
    }
    return null;
  })();

  // Auto-scroll to now on mount
  useEffect(() => {
    if (isToday && containerRef.current) {
      const nowTop = (now / 60 - startHour) * HOUR_HEIGHT;
      containerRef.current.scrollTop = Math.max(0, nowTop - 150);
    }
  }, [date]);

  return (
    <div ref={containerRef} style={{ position: 'relative', height: totalHeight, minHeight: 300, marginTop: 8 }}>
      {/* Hour grid lines */}
      {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
        <div key={i} style={{ position: 'absolute', left: 45, right: 0, top: i * HOUR_HEIGHT, borderTop: `1px solid ${T.border}22`, pointerEvents: 'none' }} />
      ))}

      <TimeRuler startHour={startHour} endHour={endHour} T={T} />
      <NowLine now={now} startHour={startHour} T={T} isToday={isToday} />

      {/* Task blocks */}
      {tasks.map(t => {
        const st = parseTime(t.time);
        const et = parseTime(t.endTime);
        const isOverdue = isToday && !t.done && et && et.mins < now;
        const isActive = t.id === currentId;
        const isUpcoming = t.id === nextUpId;

        return (
          <TimelineBlock
            key={t.id}
            task={t}
            startHour={startHour}
            isActive={isActive}
            isOverdue={isOverdue}
            isDone={t.done}
            isUpcoming={isUpcoming}
            now={now}
            T={T}
            onToggle={onToggle}
            onEdit={onEdit}
            onDelete={onDelete}
            onExpand={(id) => setExpandedId(expandedId === id ? null : id)}
            expanded={expandedId === t.id}
            deleteConfirmId={deleteConfirmId}
            setDeleteConfirmId={setDeleteConfirmId}
          />
        );
      })}
    </div>
  );
};

export default DayTimeline;
