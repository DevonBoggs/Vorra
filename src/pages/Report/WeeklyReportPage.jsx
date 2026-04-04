// WeeklyReportPage — The Study Pulse
// Hero visual + week verdict + queue-aware progress + exam trends + next step CTA

import { useState, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, minsToStr, pad, diffDays, parseTime } from "../../utils/helpers.js";
import { getCAT, STUDY_CATS } from "../../constants/categories.js";
import { Badge } from "../../components/ui/Badge.jsx";

const PLAN_COLORS = ['#6366f1', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#4ecdc4', '#f7b731', '#e88bb3'];

const WeeklyReportPage = ({ data, Btn, setPage }) => {
  const T = useTheme();
  const CAT = getCAT(T);
  const [weekOffset, setWeekOffset] = useState(0);

  // ── Week date computation ──
  const getWeekDates = (offset) => {
    const now = new Date(); now.setDate(now.getDate() + offset * 7);
    const day = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const dates = [];
    const d = new Date(mon);
    for (let i = 0; i < 7; i++) { dates.push(d.toISOString().split("T")[0]); d.setDate(d.getDate() + 1); }
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { dates, monStr: mon.toLocaleDateString("en-US", { month: "short", day: "numeric" }), sunStr: sun.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) };
  };

  const week = getWeekDates(weekOffset);
  const prevWeek = getWeekDates(weekOffset - 1);
  const courses = data.courses || [];
  const sessions = data.studySessions || [];
  const streak = data.studyStreak || { currentStreak: 0, longestStreak: 0 };
  const queue = data.taskQueue || [];

  // ── Queue-based stats (primary) ──
  const queueStudy = queue.filter(t => t.category !== 'break');
  const queueDone = queueStudy.filter(t => t.done);
  const queueDoneThisWeek = queueStudy.filter(t => t.done && t.doneDate && week.dates.includes(t.doneDate));
  const queueHrsThisWeek = Math.round(queueDoneThisWeek.reduce((s, t) => s + (t.estimatedMins || 60), 0) / 60 * 10) / 10;
  const queueHrsPrevWeek = Math.round(queueStudy.filter(t => t.done && t.doneDate && prevWeek.dates.includes(t.doneDate)).reduce((s, t) => s + (t.estimatedMins || 60), 0) / 60 * 10) / 10;
  const hrsDelta = Math.round((queueHrsThisWeek - queueHrsPrevWeek) * 10) / 10;
  const tasksThisWeek = queueDoneThisWeek.length;
  const overallPct = queueStudy.length > 0 ? Math.round(queueDone.length / queueStudy.length * 100) : 0;

  // Legacy task fallback
  const legacyTasks = data.tasks || {};
  const weekLegacy = week.dates.flatMap(d => (legacyTasks[d] || []).map(t => ({ ...t, date: d })));
  const legacyDone = weekLegacy.filter(t => t.done).length;
  const legacyTotal = weekLegacy.length;

  // Use queue if available, otherwise legacy
  const hasQueue = queue.length > 0;
  const weekCompletionPct = hasQueue ? (queueDoneThisWeek.length > 0 ? Math.min(100, Math.round(queueHrsThisWeek / Math.max(1, queueHrsThisWeek + 1) * 100)) : 0) : (legacyTotal > 0 ? Math.round(legacyDone / legacyTotal * 100) : 0);

  // Session hours
  const weekSessions = sessions.filter(s => week.dates.includes(s.date));
  const weekSessionHrs = Math.round(weekSessions.reduce((s, x) => s + (x.mins || 0), 0) / 60 * 10) / 10;

  // Total study hours (queue + sessions)
  const totalHrsThisWeek = hasQueue ? queueHrsThisWeek : weekSessionHrs;

  // By day breakdown
  const byDay = week.dates.map(d => {
    const qDone = queueStudy.filter(t => t.done && t.doneDate === d);
    const qHrs = Math.round(qDone.reduce((s, t) => s + (t.estimatedMins || 60), 0) / 60 * 10) / 10;
    const daySessions = weekSessions.filter(s => s.date === d);
    const sessionHrs = Math.round(daySessions.reduce((s, x) => s + (x.mins || 0), 0) / 60 * 10) / 10;
    const hrs = hasQueue ? qHrs : sessionHrs;
    const didStudy = qDone.length > 0 || daySessions.length > 0;
    return { date: d, dayName: new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }), dayNum: new Date(d + "T12:00:00").getDate(), hrs, tasks: qDone.length, didStudy, isToday: d === todayStr() };
  });
  const studyDays = byDay.filter(d => d.didStudy).length;

  // 4-week trend (sparkline data)
  const weekTrend = useMemo(() => {
    return [-3, -2, -1, 0].map(offset => {
      const w = getWeekDates(weekOffset + offset);
      if (hasQueue) {
        return Math.round(queueStudy.filter(t => t.done && t.doneDate && w.dates.includes(t.doneDate)).reduce((s, t) => s + (t.estimatedMins || 60), 0) / 60 * 10) / 10;
      }
      return Math.round(sessions.filter(s => w.dates.includes(s.date)).reduce((s, x) => s + (x.mins || 0), 0) / 60 * 10) / 10;
    });
  }, [weekOffset, queue, sessions]);

  // Course progress from queue
  const courseProgress = useMemo(() => {
    if (!hasQueue) return [];
    const map = {};
    for (const t of queueStudy) {
      const k = t.course_code || 'Other';
      if (!map[k]) map[k] = { total: 0, done: 0, thisWeek: 0, name: t.course_name || k };
      map[k].total++;
      if (t.done) map[k].done++;
      if (t.done && t.doneDate && week.dates.includes(t.doneDate)) map[k].thisWeek++;
    }
    return Object.entries(map).sort((a, b) => b[1].thisWeek - a[1].thisWeek);
  }, [queue, week.dates]);

  // Exam history this week
  const weekExams = (data.examHistory || []).filter(h => week.dates.includes(h.date));
  const recentExams = (data.examHistory || []).filter(e => e.score > 0).slice(-5);

  // Week verdict
  const verdict = (() => {
    if (totalHrsThisWeek >= 20 && studyDays >= 5) return { label: 'Strong Week', color: T.accent, emoji: '🔥' };
    if (totalHrsThisWeek >= 10 || studyDays >= 4) return { label: 'Solid Progress', color: T.blue || T.accent, emoji: '📈' };
    if (totalHrsThisWeek >= 4 || studyDays >= 2) return { label: 'Getting There', color: T.orange, emoji: '⏳' };
    if (totalHrsThisWeek > 0 || studyDays > 0) return { label: 'Light Week', color: T.soft, emoji: '💡' };
    return { label: 'Fresh Start', color: T.dim, emoji: '🌱' };
  })();

  // Next task from queue
  const nextTask = hasQueue ? queue.find(t => !t.done && t.category !== 'break') : null;

  // Highlights
  const highlights = useMemo(() => {
    const h = [];
    const bestDay = byDay.filter(d => d.hrs > 0).sort((a, b) => b.hrs - a.hrs)[0];
    if (bestDay) h.push(`Best day: ${bestDay.dayName} (${bestDay.hrs}h, ${bestDay.tasks} tasks)`);
    if (hasQueue) {
      const unitsDone = [...new Set(queueDoneThisWeek.map(t => `${t.course_code}-U${t.unitNumber}`))].length;
      if (unitsDone > 0) h.push(`Completed ${unitsDone} study units this week`);
    }
    if (weekExams.length > 0) {
      const best = weekExams.sort((a, b) => b.score - a.score)[0];
      h.push(`Practice exam: ${Math.round(best.score * 100)}% on ${best.courseName}`);
    }
    if (streak.currentStreak >= 7) h.push(`${streak.currentStreak}-day study streak!`);
    if (hrsDelta > 0) h.push(`+${hrsDelta}h vs last week`);
    const perfectDays = byDay.filter(d => d.didStudy && d.hrs >= 4);
    if (perfectDays.length >= 3) h.push(`${perfectDays.length} days with 4+ hours of study`);
    return h.slice(0, 4);
  }, [byDay, queueDoneThisWeek, weekExams, streak, hrsDelta]);

  // SVG Progress Ring
  const ProgressRing = ({ percent, size = 110, stroke = 10, color }) => {
    const r = (size - stroke) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (Math.min(percent, 100) / 100) * circ;
    return (
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.border} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color || T.accent} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
    );
  };

  return (
    <div className="fade" style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header + Nav */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: fs(22), fontWeight: 800, marginBottom: 2 }}>Weekly Report</h1>
          <p style={{ color: T.dim, fontSize: fs(13), margin: 0 }}>{week.monStr} — {week.sunStr}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Btn small v="ghost" onClick={() => setWeekOffset(w => w - 1)}>←</Btn>
          <Btn small v={weekOffset === 0 ? "primary" : "ghost"} onClick={() => setWeekOffset(0)}>This Week</Btn>
          <Btn small v="ghost" onClick={() => setWeekOffset(w => w + 1)}>→</Btn>
        </div>
      </div>

      {/* ═══ HERO ZONE ═══ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', background: `linear-gradient(135deg, ${T.card}, ${T.panel})`, border: `1px solid ${T.border}`, borderRadius: 14, marginBottom: 14, flexWrap: 'wrap' }}>
        {/* Progress Ring */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <ProgressRing percent={overallPct} color={verdict.color} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: fs(18), fontWeight: 900, color: verdict.color }}>{overallPct}%</span>
            <span style={{ fontSize: fs(10), color: T.dim }}>overall</span>
          </div>
        </div>
        {/* Verdict + stats */}
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: fs(16), fontWeight: 800, color: verdict.color, marginBottom: 4 }}>{verdict.emoji} {verdict.label}</div>
          <div style={{ fontSize: fs(13), color: T.text, marginBottom: 2 }}>{totalHrsThisWeek}h studied this week</div>
          {hrsDelta !== 0 && (
            <span style={{ fontSize: fs(11), fontWeight: 600, color: hrsDelta > 0 ? T.accent : T.orange, padding: '2px 8px', borderRadius: 4, background: (hrsDelta > 0 ? T.accent : T.orange) + '18' }}>
              {hrsDelta > 0 ? '+' : ''}{hrsDelta}h vs last week
            </span>
          )}
          <div style={{ fontSize: fs(12), color: T.dim, marginTop: 4 }}>{tasksThisWeek} tasks completed · {studyDays}/7 study days</div>
        </div>
      </div>

      {/* ═══ STUDY DAYS DOTS ═══ */}
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 14, padding: '10px 12px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, flexWrap: 'wrap' }}>
        {byDay.map((d, i) => (
          <div key={i} style={{ textAlign: 'center', flex: '1 1 0', minWidth: 36 }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', margin: '0 auto 4px',
              background: d.didStudy ? T.accent : 'transparent',
              border: `2px solid ${d.isToday ? T.accent : d.didStudy ? T.accent : T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: d.didStudy ? '#fff' : T.dim, fontSize: fs(12), fontWeight: 700,
              boxShadow: d.isToday ? `0 0 8px ${T.accent}44` : 'none',
            }}>
              {d.didStudy ? '✓' : d.dayNum}
            </div>
            <div style={{ fontSize: fs(11), color: d.isToday ? T.accent : T.dim, fontWeight: d.isToday ? 700 : 500 }}>{d.dayName}</div>
            {d.hrs > 0 && <div style={{ fontSize: fs(10), color: T.accent, fontWeight: 600 }}>{d.hrs}h</div>}
          </div>
        ))}
      </div>

      {/* ═══ KEY STATS (4 cards) ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, marginBottom: 14 }}>
        {/* Hours */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 8px', textAlign: 'center', overflow: 'hidden' }}>
          <div style={{ fontSize: fs(18), fontWeight: 800, color: T.accent }}>{totalHrsThisWeek}h</div>
          <div style={{ fontSize: fs(11), color: T.dim, marginBottom: 4 }}>studied</div>
          {/* 4-week sparkline */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, justifyContent: 'center', height: 20 }}>
            {weekTrend.map((v, i) => {
              const max = Math.max(...weekTrend, 1);
              return <div key={i} style={{ width: 8, height: `${Math.max(3, (v / max) * 20)}px`, borderRadius: 2, background: i === 3 ? T.accent : T.border }} />;
            })}
          </div>
        </div>
        {/* Tasks */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 8px', textAlign: 'center', overflow: 'hidden' }}>
          <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{tasksThisWeek}</div>
          <div style={{ fontSize: fs(11), color: T.dim }}>tasks done</div>
          {hasQueue && <div style={{ fontSize: fs(10), color: T.dim, marginTop: 2 }}>{queueDone.length}/{queueStudy.length} total</div>}
        </div>
        {/* Streak */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 8px', textAlign: 'center', overflow: 'hidden' }}>
          <div style={{ fontSize: fs(18), fontWeight: 800, color: streak.currentStreak >= 7 ? '#f59e0b' : streak.currentStreak >= 3 ? T.accent : T.dim }}>{streak.currentStreak}d</div>
          <div style={{ fontSize: fs(11), color: T.dim }}>streak</div>
          <div style={{ fontSize: fs(10), color: T.dim, marginTop: 2 }}>best: {streak.longestStreak || 0}d</div>
        </div>
        {/* Exam readiness */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '10px 8px', textAlign: 'center', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          {recentExams.length > 0 ? (() => {
            const last = recentExams[recentExams.length - 1];
            const color = last.score >= 0.8 ? T.accent : last.score >= 0.6 ? T.orange : T.red;
            return <>
              <div style={{ fontSize: fs(18), fontWeight: 800, color }}>{Math.round(last.score * 100)}%</div>
              <div style={{ fontSize: fs(11), color: T.dim }}>last exam</div>
              <div style={{ fontSize: fs(9), color: T.soft, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                {last.courseName || 'Unknown'}
              </div>
              {/* Mini trend dots if 2+ exams */}
              {recentExams.length >= 2 && (
                <div style={{ display: 'flex', gap: 3, marginTop: 4, alignItems: 'flex-end', height: 16 }}>
                  {recentExams.slice(-5).map((e, i) => (
                    <div key={i} style={{ width: 4, borderRadius: 2, background: e.score >= 0.8 ? T.accent : e.score >= 0.6 ? T.orange : T.red, height: `${Math.max(4, e.score * 16)}px` }} />
                  ))}
                </div>
              )}
            </>;
          })() : (
            <>
              <div style={{ fontSize: fs(18), fontWeight: 800, color: T.dim }}>—</div>
              <div style={{ fontSize: fs(11), color: T.dim }}>no exams yet</div>
            </>
          )}
        </div>
      </div>

      {/* ═══ COURSE PROGRESS ═══ */}
      {courseProgress.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: fs(15), fontWeight: 700, color: T.text, marginBottom: 10 }}>Course Progress</div>
          {courseProgress.map(([code, c], i) => {
            const pct = c.total > 0 ? Math.round(c.done / c.total * 100) : 0;
            const color = PLAN_COLORS[i % PLAN_COLORS.length];
            return (
              <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span style={{ minWidth: 55, fontSize: fs(14), fontWeight: 700, color: T.text, flexShrink: 0 }}>{code}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: T.input, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .5s' }} />
                </div>
                <span style={{ fontSize: fs(15), color: T.dim, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                {c.thisWeek > 0 && <span style={{ fontSize: fs(15), color: T.accent, fontWeight: 600 }}>+{c.thisWeek}</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* ═══ HIGHLIGHTS ═══ */}
      {highlights.length > 0 && (
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: fs(15), fontWeight: 700, color: T.text, marginBottom: 8 }}>Highlights</div>
          {highlights.map((h, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: fs(16), color: T.soft }}>
              <span style={{ color: T.accent }}>✦</span> {h}
            </div>
          ))}
        </div>
      )}

      {/* ═══ EXAM TREND ═══ */}
      {recentExams.length >= 2 && (() => {
        const chartW = 500, chartH = 140, padL = 36, padR = 24, padT = 14, padB = 28;
        const plotW = chartW - padL - padR, plotH = chartH - padT - padB;
        const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
        return (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 16px', marginBottom: 14 }}>
            <div style={{ fontSize: fs(13), fontWeight: 700, color: T.text, marginBottom: 8 }}>Practice Exam Trend</div>
            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 160 }}>
              {/* Y-axis labels */}
              {yTicks.map(v => {
                const y = padT + (1 - v) * plotH;
                return <g key={v}>
                  <text x={padL - 4} y={y + 3} textAnchor="end" fontSize={9} fill={T.dim}>{Math.round(v * 100)}%</text>
                  <line x1={padL} x2={padL + plotW} y1={y} y2={y} stroke={T.border} strokeWidth={0.5} />
                </g>;
              })}
              {/* 80% passing threshold */}
              <line x1={padL} x2={padL + plotW} y1={padT + (1 - 0.8) * plotH} y2={padT + (1 - 0.8) * plotH} stroke={T.accent} strokeDasharray="4,3" opacity={0.4} />
              <text x={padL + plotW + 2} y={padT + (1 - 0.8) * plotH + 3} fontSize={8} fill={T.accent} opacity={0.6}>pass</text>
              {/* Score line */}
              <path d={recentExams.map((h, i) => `${i === 0 ? 'M' : 'L'} ${padL + i / (recentExams.length - 1) * plotW} ${padT + (1 - h.score) * plotH}`).join(' ')} fill="none" stroke={T.accent} strokeWidth={2} />
              {/* Score dots */}
              {recentExams.map((h, i) => (
                <circle key={i} cx={padL + i / Math.max(1, recentExams.length - 1) * plotW} cy={padT + (1 - h.score) * plotH} r={4}
                  fill={h.score >= 0.8 ? T.accent : h.score >= 0.6 ? T.orange : T.red} stroke={T.card} strokeWidth={1.5} />
              ))}
              {/* X-axis labels (dates) */}
              {recentExams.map((h, i) => {
                const x = padL + i / Math.max(1, recentExams.length - 1) * plotW;
                // Only show first, last, and middle labels to avoid overlap
                if (recentExams.length > 3 && i > 0 && i < recentExams.length - 1 && i !== Math.floor(recentExams.length / 2)) return null;
                return <text key={i} x={x} y={chartH - 2} textAnchor="middle" fontSize={8} fill={T.dim}>{h.date?.slice(5)}</text>;
              })}
            </svg>
            {/* Per-exam details */}
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {recentExams.map((h, i) => (
                <div key={i} style={{ fontSize: fs(9), color: T.dim, padding: '2px 6px', borderRadius: 4, background: T.input }}>
                  <span style={{ fontWeight: 700, color: h.score >= 0.8 ? T.accent : h.score >= 0.6 ? T.orange : T.red }}>{Math.round(h.score * 100)}%</span>
                  {' '}{h.courseName?.split(' – ')[0]?.split(' - ')[0] || '?'}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ═══ NEXT STEP CTA ═══ */}
      {nextTask && (
        <div style={{ background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD || T.accentD})`, border: `1px solid ${T.accent}33`, borderRadius: 12, padding: '16px 20px', marginBottom: 14 }}>
          <div style={{ fontSize: fs(16), fontWeight: 700, color: T.accent, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Next Move</div>
          <div style={{ fontSize: fs(16), fontWeight: 700, color: T.text, marginBottom: 4 }}>{nextTask.title}</div>
          <div style={{ fontSize: fs(16), color: T.dim, marginBottom: 8 }}>~{minsToStr(nextTask.estimatedMins || 60)} · {nextTask.course_name || nextTask.course_code}</div>
          {setPage && <button onClick={() => setPage('daily')} style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: T.accent, color: '#fff', fontSize: fs(16), fontWeight: 700, cursor: 'pointer' }}>Start Studying →</button>}
        </div>
      )}

      {/* ═══ WEEK MESSAGE ═══ */}
      <div style={{ padding: '12px 16px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, textAlign: 'center' }}>
        <div style={{ fontSize: fs(16), color: T.soft, lineHeight: 1.5 }}>
          {totalHrsThisWeek >= 15 && studyDays >= 5 ? 'Excellent consistency this week. Keep this pace and you\'ll hit your target.' :
           totalHrsThisWeek >= 8 ? 'Solid effort. A few more study days next week would make a big difference.' :
           totalHrsThisWeek > 0 ? 'A lighter week — that\'s okay. Consistency matters more than any single week. Pick up where you left off.' :
           'No study tracked this week. When you\'re ready, start small — even 15 minutes counts.'}
        </div>
      </div>
    </div>
  );
};

export { WeeklyReportPage };
export default WeeklyReportPage;
