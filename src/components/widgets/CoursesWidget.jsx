// CoursesWidget — Active courses overview with quick status change
import { useState } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import { getSTATUS_C, STATUS_L } from '../../constants/categories.js';
import { Badge } from '../../components/ui/Badge.jsx';
import { safeArr } from '../../utils/toolExecution.js';

const CoursesWidget = ({ data, setData, setPage }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const courses = data.courses || [];
  const active = courses.filter(c => c.status !== 'completed');
  const [editingId, setEditingId] = useState(null);

  const hasCtx = c => safeArr(c.competencies).length > 0 || safeArr(c.topicBreakdown).length > 0 || safeArr(c.examTips).length > 0;

  const changeStatus = (courseId, newStatus) => {
    setData(prev => ({
      ...prev,
      courses: (prev.courses || []).map(c =>
        c.id === courseId ? { ...c, status: newStatus } : c
      )
    }));
    setEditingId(null);
  };

  if (active.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '20px 0', color: T.dim, fontSize: fs(12) }}>
        All courses completed! {courses.length === 0 && (
          <span
            style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }}
            onClick={() => setPage('planner')}
          >
            Add courses
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {active.slice(0, 6).map(c => (
        <div key={c.id} style={{
          background: T.input, borderRadius: 8, padding: '8px 12px',
          display: 'flex', alignItems: 'center', gap: 8
        }}>
          <div style={{ width: 3, height: 28, borderRadius: 2, background: STATUS_C[c.status] || T.dim, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontSize: fs(11), fontWeight: 600, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text
              }}>
                {c.name}
              </span>
              {hasCtx(c) && <Badge color={T.accent} bg={T.accentD}>ENRICHED</Badge>}
            </div>
            <div style={{ fontSize: fs(9), color: T.dim, display: 'flex', gap: 8, marginTop: 2 }}>
              <span>{c.credits || 0} CU</span>
              <span>{'\u2605'.repeat(c.difficulty || 0)}{'\u2606'.repeat(5 - (c.difficulty || 0))}</span>
            </div>
          </div>
          {/* Status dropdown or badge */}
          {editingId === c.id ? (
            <select
              value={c.status}
              onChange={e => changeStatus(c.id, e.target.value)}
              onBlur={() => setEditingId(null)}
              autoFocus
              style={{
                fontSize: fs(10), padding: '4px 8px', borderRadius: 6,
                background: T.card, border: `1px solid ${T.border}`, color: T.text,
                cursor: 'pointer', width: 'auto', minWidth: 90
              }}
            >
              <option value="not_started">Not Started</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          ) : (
            <button
              onClick={() => setEditingId(c.id)}
              style={{
                background: (STATUS_C[c.status] || T.dim) + '22',
                color: STATUS_C[c.status] || T.dim,
                border: 'none', borderRadius: 5, padding: '3px 9px',
                fontSize: fs(10), fontWeight: 600, cursor: 'pointer',
                letterSpacing: 0.3
              }}
            >
              {STATUS_L[c.status] || c.status}
            </button>
          )}
        </div>
      ))}
      {active.length > 6 && (
        <div style={{ fontSize: fs(10), color: T.dim, textAlign: 'center', padding: 4 }}>
          +{active.length - 6} more courses
        </div>
      )}
    </div>
  );
};

export { CoursesWidget };
export default CoursesWidget;
