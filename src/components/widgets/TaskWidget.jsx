// TaskWidget — Today's tasks with completion status
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, parseTime } from '../../utils/helpers.js';
import { getCAT } from '../../constants/categories.js';
import { Badge } from '../../components/ui/Badge.jsx';
import { safeArr } from '../../utils/toolExecution.js';

const TaskWidget = ({ data, setData, setPage, setDate }) => {
  const T = useTheme();
  const CAT = getCAT(T);
  const today = todayStr();
  const tasks = safeArr((data.tasks || {})[today])
    .sort((a, b) => (parseTime(a.time)?.mins ?? 9999) - (parseTime(b.time)?.mins ?? 9999));
  const done = tasks.filter(t => t.done).length;

  const toggleDone = (taskId) => {
    const dayTasks = safeArr((data.tasks || {})[today]);
    const updated = dayTasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t);
    setData(prev => ({ ...prev, tasks: { ...prev.tasks, [today]: updated } }));
  };

  if (tasks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: T.dim, fontSize: fs(12) }}>
        No tasks scheduled for today.
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => { setDate(today); setPage('daily'); }}
            style={{ background: T.accentD, border: `1px solid ${T.accent}44`, borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: fs(11), color: T.accent, fontWeight: 600 }}
          >
            Add Tasks
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: fs(11), color: done === tasks.length ? T.accent : T.soft }}>
          {done}/{tasks.length} done
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {tasks.slice(0, 8).map(t => {
          const c = CAT[t.category] || CAT.other;
          return (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', borderRadius: 8, background: t.done ? T.bg2 : T.input, opacity: t.done ? 0.5 : 1 }}>
              <button
                onClick={() => toggleDone(t.id)}
                style={{
                  width: 18, height: 18, borderRadius: 5, border: `1.5px solid ${t.done ? T.accent : T.border}`,
                  background: t.done ? T.accentD : 'transparent', cursor: 'pointer', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', flexShrink: 0, padding: 0
                }}
              >
                {t.done && <Ic.IcCheck s={10} c={T.accent} />}
              </button>
              <div style={{ width: 3, height: 20, borderRadius: 2, background: c.fg, flexShrink: 0 }} />
              <span style={{ fontSize: fs(10), color: T.dim, minWidth: 40, fontFamily: "'JetBrains Mono',monospace" }}>{t.time || '\u2014'}</span>
              <span style={{
                flex: 1, fontSize: fs(11), color: t.done ? T.dim : T.text, fontWeight: 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                textDecoration: t.done ? 'line-through' : 'none'
              }}>{t.title}</span>
              <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
            </div>
          );
        })}
        {tasks.length > 8 && (
          <div style={{ fontSize: fs(10), color: T.dim, textAlign: 'center', padding: 4 }}>
            +{tasks.length - 8} more tasks
          </div>
        )}
      </div>
    </div>
  );
};

export { TaskWidget };
export default TaskWidget;
