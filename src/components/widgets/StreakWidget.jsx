// StreakWidget — Study streak display with calendar dots
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, diffDays } from '../../utils/helpers.js';

const StreakWidget = ({ data }) => {
  const T = useTheme();
  const streak = data.studyStreak || { lastStudyDate: '', currentStreak: 0, longestStreak: 0 };
  const sessions = data.studySessions || [];

  // Build last 7 days for calendar dots
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const ds = d.toISOString().split('T')[0];
    const hasStudy = sessions.some(s => s.date === ds);
    last7.push({ date: ds, day: d.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0), hasStudy });
  }

  // Motivational message
  const getMessage = (s) => {
    if (s >= 30) return 'Incredible dedication!';
    if (s >= 14) return 'Two weeks strong!';
    if (s >= 7) return 'One full week!';
    if (s >= 3) return 'Building momentum!';
    if (s >= 1) return 'Keep it going!';
    return 'Start your streak today!';
  };

  // Days since last study
  const daysSince = streak.lastStudyDate
    ? diffDays(streak.lastStudyDate, todayStr())
    : null;

  return (
    <div style={{ textAlign: 'center' }}>
      {/* Big streak number */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 4 }}>
        <Ic.IcFire s={28} c={streak.currentStreak >= 3 ? T.orange : T.dim} />
        <span style={{
          fontSize: fs(40), fontWeight: 900, color: streak.currentStreak > 0 ? T.accent : T.dim,
          fontFamily: "'Outfit',sans-serif", lineHeight: 1
        }}>
          {streak.currentStreak}
        </span>
      </div>
      <div style={{ fontSize: fs(11), color: T.soft, marginBottom: 12 }}>
        day{streak.currentStreak !== 1 ? 's' : ''} current streak
      </div>

      {/* Motivational message */}
      <div style={{
        fontSize: fs(11), color: streak.currentStreak >= 7 ? T.accent : T.soft,
        fontWeight: 600, marginBottom: 14, fontStyle: 'italic'
      }}>
        {getMessage(streak.currentStreak)}
      </div>

      {/* 7-day calendar dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
        {last7.map((d, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%',
              background: d.hasStudy ? T.accent : T.input,
              border: `1.5px solid ${d.hasStudy ? T.accent : T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .2s'
            }}>
              {d.hasStudy && <Ic.IcCheck s={12} c={T.bg} />}
            </div>
            <span style={{ fontSize: fs(9), color: d.date === todayStr() ? T.accent : T.dim, fontWeight: d.date === todayStr() ? 700 : 400 }}>
              {d.day}
            </span>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
        <div>
          <div style={{ fontSize: fs(16), fontWeight: 800, color: T.purple, fontFamily: "'Outfit',sans-serif" }}>
            {streak.longestStreak}
          </div>
          <div style={{ fontSize: fs(9), color: T.dim }}>Longest</div>
        </div>
        <div style={{ width: 1, background: T.border }} />
        <div>
          <div style={{ fontSize: fs(16), fontWeight: 800, color: T.blue, fontFamily: "'Outfit',sans-serif" }}>
            {daysSince !== null && daysSince >= 0 ? (daysSince === 0 ? 'Today' : `${daysSince}d ago`) : '\u2014'}
          </div>
          <div style={{ fontSize: fs(9), color: T.dim }}>Last Study</div>
        </div>
      </div>
    </div>
  );
};

export { StreakWidget };
export default StreakWidget;
