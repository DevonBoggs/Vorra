// ProgressHeader — thin progress bar always visible under the page title
// Shows: tasks done/total, hours done/planned, percentage

import { useTheme, fs } from '../../styles/tokens.js';
import { parseTime } from '../../utils/helpers.js';
import { safeArr } from '../../utils/toolExecution.js';

export function useDayProgress(tasks, data) {
  const lastPlan = (data.planHistory || []).slice(-1)[0] || null;
  const planTasks = lastPlan ? safeArr(tasks).filter(t => t.planId === lastPlan.planId) : [];
  const allTasks = safeArr(tasks);

  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter(t => t.done).length;
  const planTotal = planTasks.length;
  const planDone = planTasks.filter(t => t.done).length;

  let totalMins = 0, doneMins = 0;
  for (const t of allTasks) {
    const st = parseTime(t.time), et = parseTime(t.endTime);
    const mins = st && et ? Math.max(0, et.mins - st.mins) : 0;
    totalMins += mins;
    if (t.done) doneMins += mins;
  }

  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const totalHrs = Math.round(totalMins / 60 * 10) / 10;
  const doneHrs = Math.round(doneMins / 60 * 10) / 10;
  const allDone = totalTasks > 0 && doneTasks >= totalTasks;

  return { totalTasks, doneTasks, planTotal, planDone, totalMins, doneMins, totalHrs, doneHrs, pct, allDone, lastPlan };
}

export const ProgressHeader = ({ progress }) => {
  const T = useTheme();
  const { totalTasks, doneTasks, doneHrs, totalHrs, pct } = progress;

  if (totalTasks === 0) return null;

  const barColor = pct >= 100 ? T.accent : pct >= 50 ? T.blue || T.accent : T.soft;

  return (
    <div style={{ padding: '0 0 8px', marginBottom: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{ fontSize: fs(10), color: T.dim }}>
          {doneTasks}/{totalTasks} tasks
        </span>
        <span style={{ fontSize: fs(10), color: barColor, fontWeight: 600 }}>
          {doneHrs}h / {totalHrs}h — {pct}%
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: T.input, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 2, background: `linear-gradient(90deg, ${T.accent}, ${barColor})`, transition: 'width .4s ease' }} />
      </div>
    </div>
  );
};

export default ProgressHeader;
