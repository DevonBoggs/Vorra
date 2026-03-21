// TimerWidget — Countdown study timer with presets and custom duration
import { useState } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, minsToStr } from '../../utils/helpers.js';
import { useTimer, timerStart, timerPause, timerStop, fmtElapsed } from '../../systems/timer.js';

const TimerWidget = ({ data }) => {
  const T = useTheme();
  const timer = useTimer();
  const sessions = data.studySessions || [];
  const todaySessions = sessions.filter(s => s.date === todayStr());
  const todayMins = todaySessions.reduce((s, x) => s + (x.mins || 0), 0);
  const [customMins, setCustomMins] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const quickDurations = [
    { label: '25m', mins: 25 },
    { label: '45m', mins: 45 },
    { label: '60m', mins: 60 },
  ];

  const startCustom = () => {
    const mins = parseInt(customMins, 10);
    if (!mins || mins < 1) return;
    timerStart(`${mins}m Focus Session`, '', mins);
    setShowCustom(false);
    setCustomMins('');
  };

  // Calculate progress percentage for countdown
  const countdownPct = timer.durationMs > 0
    ? Math.max(0, Math.min(100, ((timer.durationMs - timer.remaining) / timer.durationMs) * 100))
    : 0;

  return (
    <div>
      {timer.running ? (
        /* Active timer display */
        <div style={{ textAlign: 'center' }}>
          {/* Countdown display */}
          <div style={{
            fontSize: fs(36), fontWeight: 800,
            color: timer.remaining <= 60000 && timer.durationMs > 0 ? T.orange : T.accent,
            fontFamily: "'JetBrains Mono',monospace", marginBottom: 2
          }}>
            {timer.durationMs > 0 ? fmtElapsed(timer.remaining) : fmtElapsed(timer.elapsed)}
          </div>
          {/* Progress bar for countdown */}
          {timer.durationMs > 0 && (
            <div style={{
              width: '100%', height: 4, borderRadius: 2,
              background: T.bg2, marginBottom: 8, overflow: 'hidden'
            }}>
              <div style={{
                width: `${countdownPct}%`, height: '100%',
                background: timer.remaining <= 60000 ? T.orange : T.accent,
                borderRadius: 2, transition: 'width 1s linear'
              }} />
            </div>
          )}
          {/* Label */}
          <div style={{
            fontSize: fs(11), color: T.soft, marginBottom: 12,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {timer.taskTitle || 'Study Session'}
            {timer.durationMs > 0 && (
              <span style={{ color: T.dim, marginLeft: 6 }}>
                ({Math.ceil(timer.elapsed / 60000)}/{Math.round(timer.durationMs / 60000)}m)
              </span>
            )}
          </div>
          {/* Controls */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
            <button
              onClick={timerPause}
              style={{
                background: T.input, border: `1px solid ${T.border}`, borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: fs(11), color: T.soft, fontWeight: 600
              }}
            >
              {timer.paused ? <Ic.IcPlay s={12} c={T.accent} /> : <Ic.IcPause s={12} c={T.soft} />}
              {timer.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={timerStop}
              style={{
                background: T.redD, border: `1px solid ${T.red}33`, borderRadius: 8,
                padding: '8px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: fs(11), color: T.red, fontWeight: 600
              }}
            >
              <Ic.IcStop s={12} c={T.red} />
              Stop
            </button>
          </div>
        </div>
      ) : (
        /* Quick start buttons */
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            {quickDurations.map(d => (
              <button
                key={d.label}
                onClick={() => timerStart(`${d.label} Focus Session`, '', d.mins)}
                style={{
                  flex: 1, background: T.input, border: `1px solid ${T.border}`, borderRadius: 10,
                  padding: '12px 8px', cursor: 'pointer', textAlign: 'center',
                  transition: 'all .2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accentD; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.input; }}
              >
                <div style={{ fontSize: fs(18), fontWeight: 800, color: T.accent, fontFamily: "'Outfit',sans-serif" }}>
                  {d.label}
                </div>
                <div style={{ fontSize: fs(9), color: T.dim, marginTop: 2 }}>Start</div>
              </button>
            ))}
          </div>
          {/* Custom Timer */}
          {showCustom ? (
            <div style={{
              display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center'
            }}>
              <input
                type="number"
                min="1"
                max="480"
                placeholder="Minutes"
                value={customMins}
                onChange={e => setCustomMins(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') startCustom(); if (e.key === 'Escape') setShowCustom(false); }}
                autoFocus
                style={{
                  flex: 1, padding: '10px 14px', borderRadius: 8,
                  background: T.input, border: `1px solid ${T.accent}44`,
                  color: T.text, fontSize: fs(14), fontWeight: 700,
                  fontFamily: "'JetBrains Mono',monospace", textAlign: 'center'
                }}
              />
              <button
                onClick={startCustom}
                disabled={!customMins || parseInt(customMins, 10) < 1}
                style={{
                  padding: '10px 18px', borderRadius: 8,
                  background: `linear-gradient(135deg, ${T.accent}, ${T.accent}dd)`,
                  color: '#060e09', fontSize: fs(12), fontWeight: 700, cursor: 'pointer',
                  opacity: (!customMins || parseInt(customMins, 10) < 1) ? 0.4 : 1
                }}
              >
                Start
              </button>
              <button
                onClick={() => { setShowCustom(false); setCustomMins(''); }}
                style={{
                  padding: '10px 12px', borderRadius: 8, background: T.input,
                  border: `1px solid ${T.border}`, color: T.dim, fontSize: fs(11),
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowCustom(true)}
              style={{
                width: '100%', background: `linear-gradient(135deg, ${T.accent}, ${T.accent}dd)`,
                color: '#060e09', borderRadius: 10, padding: '10px 16px', cursor: 'pointer',
                fontSize: fs(12), fontWeight: 700, fontFamily: "'Outfit',sans-serif",
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                border: 'none'
              }}
            >
              <Ic.Clock s={14} c="#060e09" />
              Custom Timer
            </button>
          )}
        </div>
      )}

      {/* Today's total */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6,
        marginTop: 14, paddingTop: 10, borderTop: `1px solid ${T.border}`
      }}>
        <Ic.Clock s={12} />
        <span style={{ fontSize: fs(11), color: T.soft }}>
          Today: <strong style={{ color: todayMins > 0 ? T.accent : T.dim }}>{minsToStr(todayMins)}</strong>
        </span>
      </div>
    </div>
  );
};

export { TimerWidget };
export default TimerWidget;
