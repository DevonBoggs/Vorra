// NowStrip — persistent banner showing current/next task with integrated timer
// Only renders on today's date when there are tasks

import { useTheme, fs } from '../../styles/tokens.js';
import { parseTime, fmtTime, minsToStr } from '../../utils/helpers.js';
import Ic from '../icons/index.jsx';
import { Btn } from '../ui/Btn.jsx';
import { Badge } from '../ui/Badge.jsx';

export const NowStrip = ({ tasks, currentId, now, timerState, onToggleTask, onStartTimer, onNavigateDaily }) => {
  const T = useTheme();

  if (!tasks || tasks.length === 0) return null;

  // Find current task (actively in its time window)
  const current = currentId ? tasks.find(t => t.id === currentId) : null;

  // Find next upcoming undone task
  const nextUp = tasks.find(t => !t.done && t.id !== currentId && parseTime(t.time)?.mins >= now);

  // Find the task to display (current takes priority, then next upcoming)
  const displayTask = current || nextUp;
  if (!displayTask) {
    // All tasks may be done or past
    const allDone = tasks.every(t => t.done);
    if (allDone && tasks.length > 0) {
      return (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: T.accentD, border: `1px solid ${T.accent}33`, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: fs(16) }}>&#10003;</span>
          <span style={{ fontSize: fs(12), fontWeight: 600, color: T.accent }}>All tasks complete for today!</span>
        </div>
      );
    }
    return null;
  }

  const st = parseTime(displayTask.time);
  const et = parseTime(displayTask.endTime);
  const isCurrent = displayTask.id === currentId;
  const isTimerRunning = timerState?.running && timerState?.taskTitle === displayTask.title;
  const timeRemaining = et ? Math.max(0, et.mins - now) : 0;

  // Course color from category
  const catColors = { study: T.accent, review: T.blue || T.accent, 'exam-prep': T.orange, 'exam-day': T.red, break: T.dim, project: T.purple };
  const color = catColors[displayTask.category] || T.accent;

  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, marginBottom: 10,
      background: isCurrent ? `linear-gradient(135deg, ${color}18, ${color}08)` : T.card,
      border: `1.5px solid ${isCurrent ? color + '55' : T.border}`,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      {/* Status indicator */}
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isCurrent ? color : T.dim, flexShrink: 0, boxShadow: isCurrent ? `0 0 8px ${color}66` : 'none' }} />

      {/* Task info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isCurrent ? '' : 'Next: '}{displayTask.title}
        </div>
        <div style={{ fontSize: fs(10), color: T.dim, display: 'flex', gap: 8, alignItems: 'center' }}>
          {st && <span>{fmtTime(st.h, st.m)}{et ? ` - ${fmtTime(et.h, et.m)}` : ''}</span>}
          {isCurrent && timeRemaining > 0 && <span style={{ color }}>{minsToStr(timeRemaining)} remaining</span>}
          {!isCurrent && st && <span>starts {st.mins > now ? `in ${minsToStr(st.mins - now)}` : 'now'}</span>}
          {displayTask.category !== 'study' && <Badge color={color} bg={color + '22'}>{displayTask.category}</Badge>}
        </div>
      </div>

      {/* Timer display if running */}
      {isTimerRunning && (
        <span style={{ fontSize: fs(14), fontWeight: 700, color, fontFamily: "'JetBrains Mono', monospace" }}>
          {Math.floor(timerState.remaining / 60000)}:{String(Math.floor((timerState.remaining % 60000) / 1000)).padStart(2, '0')}
        </span>
      )}

      {/* Actions */}
      {!displayTask.done && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!isTimerRunning && (
            <Btn small v="secondary" onClick={() => onStartTimer(displayTask)}>Start</Btn>
          )}
          <Btn small v="ai" onClick={() => onToggleTask(displayTask.id)}>Done</Btn>
        </div>
      )}

      {/* Next up preview */}
      {isCurrent && nextUp && (
        <div style={{ fontSize: fs(9), color: T.dim, flexShrink: 0, textAlign: 'right' }}>
          <div>Next:</div>
          <div style={{ color: T.soft }}>{nextUp.title?.split(/[\u2014\-:]/)[0]?.trim()}</div>
        </div>
      )}
    </div>
  );
};

export default NowStrip;
