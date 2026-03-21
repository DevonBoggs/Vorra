// UpcomingWidget — Next 5 tasks across future dates
import { useTheme, fs } from '../../styles/tokens.js';
import { todayStr, parseTime } from '../../utils/helpers.js';
import { getCAT } from '../../constants/categories.js';
import { Badge } from '../../components/ui/Badge.jsx';
import { safeArr } from '../../utils/toolExecution.js';

const UpcomingWidget = ({ data, setPage, setDate }) => {
  const T = useTheme();
  const CAT = getCAT(T);
  const tasks = data.tasks || {};
  const today = todayStr();

  // Gather next 5 undone tasks from today onwards
  const upcoming = [];
  const sortedDates = Object.keys(tasks).filter(d => d >= today).sort();
  for (const d of sortedDates) {
    if (upcoming.length >= 5) break;
    const dayTasks = safeArr(tasks[d])
      .filter(t => !t.done)
      .sort((a, b) => (parseTime(a.time)?.mins ?? 9999) - (parseTime(b.time)?.mins ?? 9999));
    for (const t of dayTasks) {
      if (upcoming.length >= 5) break;
      upcoming.push({ ...t, date: d });
    }
  }

  if (upcoming.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: T.dim, fontSize: fs(12) }}>
        No upcoming tasks found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {upcoming.map((t, i) => {
        const c = CAT[t.category] || CAT.other;
        const isToday = t.date === today;
        const dateLabel = isToday
          ? 'Today'
          : new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        return (
          <button
            key={t.id || i}
            onClick={() => { setDate(t.date); setPage('daily'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
              borderRadius: 8, background: T.input, cursor: 'pointer', border: 'none',
              textAlign: 'left', transition: 'background .15s', width: '100%'
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.cardH; }}
            onMouseLeave={e => { e.currentTarget.style.background = T.input; }}
          >
            <div style={{ width: 3, height: 24, borderRadius: 2, background: c.fg, flexShrink: 0 }} />
            <span style={{
              fontSize: fs(10), color: isToday ? T.accent : T.dim, minWidth: 56,
              fontFamily: "'JetBrains Mono',monospace", fontWeight: isToday ? 600 : 400
            }}>
              {dateLabel}
            </span>
            <span style={{
              fontSize: fs(10), color: T.blue, minWidth: 40,
              fontFamily: "'JetBrains Mono',monospace"
            }}>
              {t.time || '\u2014'}
            </span>
            <span style={{
              flex: 1, fontSize: fs(11), color: T.text, fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {t.title}
            </span>
            <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
          </button>
        );
      })}
    </div>
  );
};

export { UpcomingWidget };
export default UpcomingWidget;
