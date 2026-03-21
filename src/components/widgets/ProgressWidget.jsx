// ProgressWidget — Degree progress with CU bar and pace indicator
import { useTheme, fs } from '../../styles/tokens.js';
import { todayStr, diffDays } from '../../utils/helpers.js';
import { ProgressBar } from '../../components/ui/ProgressBar.jsx';

const ProgressWidget = ({ data }) => {
  const T = useTheme();
  const courses = data.courses || [];
  const totalCU = courses.reduce((s, c) => s + (c.credits || 0), 0);
  const doneCU = courses.filter(c => c.status === 'completed').reduce((s, c) => s + (c.credits || 0), 0);
  const pctComplete = totalCU > 0 ? Math.round((doneCU / totalCU) * 100) : 0;
  const completedCount = courses.filter(c => c.status === 'completed').length;
  const totalCount = courses.length;

  // Days remaining
  const goalDate = data.targetCompletionDate || data.targetDate || null;
  const daysLeft = goalDate ? Math.max(0, diffDays(todayStr(), goalDate)) : null;

  // Pace: compare progress % to time % elapsed
  const startDate = data.studyStartDate || null;
  let paceLabel = 'Unknown';
  let paceColor = T.dim;
  if (startDate && goalDate) {
    const totalSpan = diffDays(startDate, goalDate);
    const elapsed = diffDays(startDate, todayStr());
    if (totalSpan > 0) {
      const timePct = Math.round((elapsed / totalSpan) * 100);
      if (pctComplete >= timePct + 5) {
        paceLabel = 'Ahead';
        paceColor = T.accent;
      } else if (pctComplete >= timePct - 5) {
        paceLabel = 'On Track';
        paceColor = T.blue;
      } else {
        paceLabel = 'Behind';
        paceColor = T.orange;
      }
    }
  }

  return (
    <div>
      {/* Progress ring (inline SVG) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14 }}>
        <svg width="72" height="72" viewBox="0 0 72 72">
          <circle cx="36" cy="36" r="30" fill="none" stroke={T.bg2} strokeWidth="6" />
          <circle cx="36" cy="36" r="30" fill="none" stroke={T.accent} strokeWidth="6" strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 30 * pctComplete / 100} ${2 * Math.PI * 30}`}
            transform="rotate(-90 36 36)" style={{ transition: 'stroke-dasharray .5s' }}
          />
          <text x="36" y="34" textAnchor="middle" fill={T.text} fontSize="16" fontWeight="800" fontFamily="Outfit,sans-serif">{pctComplete}%</text>
          <text x="36" y="46" textAnchor="middle" fill={T.dim} fontSize="8">{doneCU}/{totalCU} CU</text>
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 6 }}>
            {completedCount}/{totalCount} courses done
          </div>
          <ProgressBar value={doneCU} max={totalCU || 1} color={T.accent} h={6} />
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: T.input, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: fs(16), fontWeight: 800, color: daysLeft !== null && daysLeft < 60 ? T.red : T.blue, fontFamily: "'Outfit',sans-serif" }}>
            {daysLeft !== null ? daysLeft : '\u2014'}
          </div>
          <div style={{ fontSize: fs(9), color: T.dim }}>Days Left</div>
        </div>
        <div style={{ background: T.input, borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: fs(16), fontWeight: 800, color: paceColor, fontFamily: "'Outfit',sans-serif" }}>
            {paceLabel}
          </div>
          <div style={{ fontSize: fs(9), color: T.dim }}>Pace</div>
        </div>
      </div>
    </div>
  );
};

export { ProgressWidget };
export default ProgressWidget;
