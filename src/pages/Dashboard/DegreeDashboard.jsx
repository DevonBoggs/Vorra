import { useState, useEffect, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, diffDays, minsToStr, parseTime } from "../../utils/helpers.js";
import { getSTATUS_C, STATUS_L, STUDY_CATS } from "../../constants/categories.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { toast } from "../../systems/toast.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { safeArr } from "../../utils/toolExecution.js";
import { hasCtx } from "../../utils/courseHelpers.js";
import { CourseDetail } from "../../components/course/CourseDetail.jsx";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary.jsx";
import { computeProgress } from "../../utils/studyQueue.js";

/* ── SVG Progress Ring ───────────────────────────────────────── */
const Ring = ({ pct, size = 80, stroke = 7, color, label, value, T }) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(Math.max(pct, 0), 100) / 100) * circ;
  return (
    <div style={{ textAlign: 'center', position: 'relative' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', display: 'block' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.border} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position: 'absolute', top: 0, left: 0, width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: fs(18), fontWeight: 800, color }}>{value}</div>
      </div>
      <div style={{ fontSize: fs(12), color: T.dim, marginTop: 6, fontWeight: 600 }}>{label}</div>
    </div>
  );
};

/* ── 7-Day Velocity Bars (Sunday–Saturday) ───────────────────── */
const WeekBars = ({ sessions, T }) => {
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun
  const days = [];
  for (let dow = 0; dow <= 6; dow++) {
    const offset = dow - todayDow;
    const d = new Date(today); d.setDate(d.getDate() + offset);
    const ds = d.toISOString().split('T')[0];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const mins = (sessions || []).filter(s => s.date === ds).reduce((s, x) => s + (x.mins || 0), 0);
    days.push({ day: dayNames[dow], mins, isToday: offset === 0, ds });
  }
  const maxMins = Math.max(...days.map(d => d.mins), 60);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 56 }}>
      {days.map((d, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
          <div style={{ width: '100%', maxWidth: 28, height: 40, borderRadius: 4, background: T.input,
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
            <div style={{ width: '100%', borderRadius: 4,
              height: `${Math.max(d.mins > 0 ? 8 : 0, (d.mins / maxMins) * 100)}%`,
              background: d.isToday ? T.accent : d.mins > 0 ? T.blue : 'transparent',
              transition: 'height .4s ease' }} />
          </div>
          <span style={{ fontSize: fs(10), color: d.isToday ? T.accent : T.dim, fontWeight: d.isToday ? 700 : 500 }}>{d.day}</span>
        </div>
      ))}
    </div>
  );
};

/* ── Study Days Dots (Sunday–Saturday) ───────────────────────── */
const StudyDots = ({ sessions, T }) => {
  const today = new Date();
  const todayDow = today.getDay(); // 0=Sun
  const dots = [];
  for (let dow = 0; dow <= 6; dow++) {
    const offset = dow - todayDow;
    const d = new Date(today); d.setDate(d.getDate() + offset);
    const ds = d.toISOString().split('T')[0];
    const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    const studied = (sessions || []).some(s => s.date === ds && s.mins > 0);
    dots.push({ day: dayNames[dow], studied, isToday: offset === 0 });
  }
  const studyDays = dots.filter(d => d.studied).length;
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
      {dots.map((d, i) => (
        <div key={i} style={{ textAlign: 'center' }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%',
            background: d.studied ? T.accent : 'transparent',
            border: `2px solid ${d.studied ? T.accent : d.isToday ? T.accent + '66' : T.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: d.studied ? '#fff' : T.dim, fontSize: fs(10), fontWeight: 700 }}>
            {d.studied ? '✓' : ''}
          </div>
          <div style={{ fontSize: fs(9), color: d.isToday ? T.accent : T.dim, marginTop: 3, fontWeight: d.isToday ? 700 : 400 }}>{d.day}</div>
        </div>
      ))}
      <div style={{ marginLeft: 12, fontSize: fs(13), fontWeight: 700, color: T.text }}>{studyDays}/7</div>
    </div>
  );
};

/* ── Main Dashboard ──────────────────────────────────────────── */
const DegreeDashboard = ({ data, setData, setPage, setDate }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const [filter, setFilter] = useState('all');
  const [expanded, setExpanded] = useState({});
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  const courses = data.courses || [];
  const sessions = data.studySessions || [];
  const streak = data.studyStreak || { lastStudyDate: '', currentStreak: 0, longestStreak: 0 };
  const queue = data.taskQueue || [];
  const examHistory = data.examHistory || [];
  const activeCourses = courses.filter(c => c.status !== 'completed');
  const completedCourses = courses.filter(c => c.status === 'completed');
  const totalCU = courses.reduce((s, c) => s + (c.credits || 0), 0);
  const doneCU = completedCourses.reduce((s, c) => s + (c.credits || 0), 0);

  // Queue-based progress
  const progress = useMemo(() => computeProgress(queue, {
    targetDate: data.targetCompletionDate || data.targetDate,
    startDate: data.studyStartDate,
    weeklyHours: data.plannerConfig?.weeklyHours || (data.studyHoursPerDay || 4) * 7,
  }), [queue, data.targetCompletionDate, data.targetDate, data.studyStartDate]);

  // Today's study stats
  const todayMins = sessions.filter(s => s.date === todayStr()).reduce((s, x) => s + (x.mins || 0), 0);
  const todayHrs = Math.round(todayMins / 60 * 10) / 10;
  const dailyGoalHrs = progress.dailyNeedHrs || (data.studyHoursPerDay || 4);
  const todayPct = Math.min(100, Math.round((todayHrs / dailyGoalHrs) * 100));

  // Today's tasks from queue
  const todayStr_ = todayStr();
  const todayQueueDone = queue.filter(t => t.done && t.doneDate === todayStr_ && t.category !== 'break').length;
  const todayTarget = (() => {
    let filled = 0;
    let count = 0;
    for (const t of queue) {
      if (t.done && t.doneDate === todayStr_) { count++; continue; }
      if (!t.done) { count++; filled += t.estimatedMins || 60; }
      if (filled >= dailyGoalHrs * 60) break;
    }
    return count;
  })();
  const todayTaskPct = todayTarget > 0 ? Math.min(100, Math.round((todayQueueDone / todayTarget) * 100)) : 0;

  // Next task from queue
  const nextTask = queue.find(t => !t.done && t.category !== 'break');

  // Time of day greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Week stats
  const weekMins = (() => {
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
    return sessions.filter(s => new Date(s.date + 'T12:00:00') >= weekAgo).reduce((s, x) => s + (x.mins || 0), 0);
  })();

  // Status color/label
  const statusColor = { ahead: T.accent, 'on-track': T.blue, behind: T.orange, 'at-risk': T.red }[progress.status] || T.dim;
  const statusLabel = { ahead: 'Ahead of pace', 'on-track': 'On track', behind: 'Slightly behind', 'at-risk': 'At risk' }[progress.status] || '';

  // Determine dashboard state
  const isNewUser = courses.length === 0;
  const isCompleting = activeCourses.length > 0 && completedCourses.length > 0 && progress.pct >= 80;
  const hasQueue = queue.length > 0;

  // Course filter
  const filtered = filter === 'all' ? courses : courses.filter(c => c.status === filter);

  /* ── NEW USER STATE ──────────────────────────────────────── */
  if (isNewUser) return (
    <div className="fade" style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
      <div style={{ marginBottom: 12 }}><Ic.Grad s={48} c={T.accent} /></div>
      <h1 style={{ fontSize: fs(28), fontWeight: 800, marginBottom: 8 }}>Welcome to Vorra</h1>
      <p style={{ fontSize: fs(15), color: T.soft, marginBottom: 32 }}>Set up your study command center in 3 steps</p>
      {[
        { label: 'Add your courses', desc: 'Import your degree plan or add courses manually', page: 'courses', Icon: Ic.Book, color: T.accent },
        { label: 'Set your target date', desc: 'When do you want to finish your degree?', page: 'settings', Icon: Ic.IcCal, color: T.blue },
        { label: 'Generate a study plan', desc: 'AI creates a lesson plan tailored to your schedule', page: 'planner', Icon: Ic.AI, color: T.purple },
      ].map((step, i) => (
        <div key={i} onClick={() => setPage(step.page)} style={{ display: 'flex', alignItems: 'center', gap: 16,
          padding: '16px 20px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12,
          marginBottom: 10, cursor: 'pointer', textAlign: 'left', transition: 'border-color .2s' }}
          onMouseEnter={e => e.currentTarget.style.borderColor = step.color}
          onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
          <step.Icon s={28} c={step.color} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: fs(15), fontWeight: 700, color: T.text }}>{i + 1}. {step.label}</div>
            <div style={{ fontSize: fs(13), color: T.soft, marginTop: 2 }}>{step.desc}</div>
          </div>
          <span style={{ color: T.accent, fontSize: fs(16) }}>→</span>
        </div>
      ))}
      <p style={{ fontSize: fs(12), color: T.dim, marginTop: 20 }}>Most students are ready in under 5 minutes.</p>
    </div>
  );

  /* ── ACTIVE / COMPLETING USER STATE ──────────────────────── */
  return (
    <div className="fade">

      {/* ── 1. HERO ACTION ZONE ──────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h1 style={{ fontSize: fs(26), fontWeight: 800, marginBottom: 4 }}>{greeting}</h1>
            <p style={{ color: T.soft, fontSize: fs(14), margin: 0 }}>
              {hasQueue
                ? `${todayQueueDone}/${todayTarget} tasks today · ${todayHrs}h studied · ${streak.currentStreak > 0 ? `${streak.currentStreak}-day streak 🔥` : 'Start a streak today'}`
                : `${activeCourses.length} active course${activeCourses.length !== 1 ? 's' : ''} · ${Math.round(progress.totalHrs || 0)}h estimated`
              }
            </p>
          </div>
          <Btn v="ghost" onClick={() => setPage('courses')} style={{ flexShrink: 0 }}><Ic.Edit s={14} /> My Courses</Btn>
        </div>

        {/* Completing state celebration */}
        {isCompleting && (
          <div className="fade" style={{ background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1.5px solid ${T.accent}55`,
            borderRadius: 14, padding: '16px 22px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: fs(16), fontWeight: 700 }}>🎉 Almost there!</div>
              <div style={{ fontSize: fs(13), color: T.soft, marginTop: 2 }}>
                {completedCourses.length} of {courses.length} courses complete · {progress.daysRemaining != null ? `${progress.daysRemaining} days left` : ''}
              </div>
            </div>
          </div>
        )}

        {/* Welcome back banner */}
        {(() => {
          const daysSince = streak.lastStudyDate ? diffDays(streak.lastStudyDate, todayStr()) : null;
          if (daysSince !== null && daysSince >= 3) return (
            <div className="fade" style={{ background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1.5px solid ${T.accent}55`,
              borderRadius: 14, padding: '16px 22px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <div style={{ fontSize: fs(15), fontWeight: 700 }}>Welcome back!</div>
                <div style={{ fontSize: fs(13), color: T.soft, marginTop: 2 }}>You've been away {daysSince} days. Pick up where you left off.</div>
              </div>
              <Btn small v="primary" onClick={() => setPage('daily')}>Start Studying →</Btn>
            </div>
          );
          return null;
        })()}

        {/* Next task CTA — THE primary action */}
        {nextTask && (
          <div style={{ background: `linear-gradient(135deg, ${T.accentD}, ${T.accent}11)`, border: `1.5px solid ${T.accent}44`,
            borderRadius: 14, padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: fs(12), color: T.accent, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Next Up</div>
              <div style={{ fontSize: fs(16), fontWeight: 700, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nextTask.title}</div>
              <div style={{ fontSize: fs(12), color: T.soft, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <span>~{Math.round((nextTask.estimatedMins || 60) / 60 * 10) / 10}h</span>
                {nextTask.unitTitle && <span>Unit: {nextTask.unitTitle}</span>}
                {nextTask.course_code && <Badge color={T.accent} bg={T.accentD}>{nextTask.course_code}</Badge>}
              </div>
            </div>
            <Btn v="primary" onClick={() => { setDate(todayStr()); setPage('daily'); }}>Start Studying →</Btn>
          </div>
        )}

        {/* No queue — prompt to generate plan */}
        {!nextTask && hasQueue && (
          <div style={{ background: T.card, border: `1px solid ${T.accent}44`, borderRadius: 14, padding: '18px 22px', textAlign: 'center' }}>
            <div style={{ fontSize: fs(16), fontWeight: 700, marginBottom: 4 }}>🎉 All caught up!</div>
            <div style={{ fontSize: fs(13), color: T.soft }}>You've completed all tasks in your queue.</div>
            <Btn v="primary" onClick={() => setPage('planner')} style={{ marginTop: 12 }}>Generate New Plan</Btn>
          </div>
        )}

        {!hasQueue && courses.length > 0 && (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '18px 22px', textAlign: 'center' }}>
            <div style={{ fontSize: fs(16), fontWeight: 700, marginBottom: 4 }}>Ready to plan your studies?</div>
            <div style={{ fontSize: fs(13), color: T.soft }}>Generate an AI lesson plan to get started.</div>
            <Btn v="primary" onClick={() => setPage('planner')} style={{ marginTop: 12 }}>Open Study Planner →</Btn>
          </div>
        )}

        {/* School profile nudge */}
        {courses.length > 0 && !data.universityProfile?.name && (
          <div style={{ padding: '10px 16px', borderRadius: 10, background: `linear-gradient(135deg, ${T.purpleD}, ${T.blueD})`,
            border: `1px solid ${T.purple}33`, marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: fs(13), fontWeight: 700 }}>Set your school profile</div>
              <div style={{ fontSize: fs(11), color: T.soft }}>Get personalized study recommendations for your institution.</div>
            </div>
            <Btn small v="ghost" onClick={() => setPage('settings')} style={{ flexShrink: 0 }}>Set Up →</Btn>
          </div>
        )}
      </div>

      {/* ── 2. DAILY VITALS ──────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: bp.sm ? '1fr' : '1fr 1fr', gap: 14, marginBottom: 20 }}>
        {/* Left: Progress rings */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 16px',
          display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          <Ring pct={todayPct} color={T.accent} label="Hours" value={`${todayHrs}h`} T={T} />
          <Ring pct={todayTaskPct} color={T.blue} label="Tasks" value={`${todayQueueDone}`} T={T} />
          <Ring pct={progress.pct} color={T.purple} label="Progress" value={`${progress.pct}%`} T={T} />
        </div>

        {/* Right: Week bars + stats */}
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '20px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: fs(14), fontWeight: 700 }}>This Week</span>
            <span style={{ fontSize: fs(13), color: T.accent, fontWeight: 700 }}>{Math.round(weekMins / 60 * 10) / 10}h</span>
          </div>
          <WeekBars sessions={sessions} T={T} />
          <div style={{ marginTop: 12 }}>
            <StudyDots sessions={sessions} T={T} />
          </div>
        </div>
      </div>

      {/* ── 3. PACE STATUS BANNER ────────────────────────────── */}
      {hasQueue && progress.daysRemaining != null && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 120, padding: '12px 16px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: fs(22), fontWeight: 800, color: T.text }}>{progress.daysRemaining}</div>
            <div style={{ fontSize: fs(12), color: T.dim }}>days left</div>
          </div>
          <div style={{ flex: 1, minWidth: 120, padding: '12px 16px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: fs(22), fontWeight: 800, color: T.text }}>{progress.dailyNeedHrs}h</div>
            <div style={{ fontSize: fs(12), color: T.dim }}>needed / day</div>
          </div>
          <div style={{ flex: 1, minWidth: 120, padding: '12px 16px', background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: fs(22), fontWeight: 800, color: T.text }}>{progress.remainingHrs}h</div>
            <div style={{ fontSize: fs(12), color: T.dim }}>remaining</div>
          </div>
          <div style={{ flex: 1, minWidth: 120, padding: '12px 16px', background: T.card, border: `1px solid ${statusColor}44`, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: fs(16), fontWeight: 800, color: statusColor }}>{statusLabel}</div>
            <div style={{ fontSize: fs(12), color: T.dim }}>SPI: {progress.spi}</div>
          </div>
        </div>
      )}

      {/* ── 4. QUICK ACTIONS ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { label: 'Practice Exam', Icon: Ic.Quiz, page: 'quiz', color: T.orange },
          { label: 'Calendar', Icon: Ic.IcCal, page: 'calendar', color: T.blue },
          { label: 'Study Chat', Icon: Ic.Chat, page: 'chat', color: T.purple },
          { label: 'Weekly Report', Icon: Ic.Report, page: 'report', color: T.accent },
          { label: 'Study Radio', Icon: Ic.Music, page: 'ambient', color: T.blue },
        ].map(a => (
          <button key={a.page} onClick={() => setPage(a.page)} style={{ flex: '1 1 0', minWidth: 90, padding: '12px 8px',
            background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, transition: 'border-color .2s' }}
            onMouseEnter={e => e.currentTarget.style.borderColor = a.color}
            onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
            <a.Icon s={20} c={a.color} />
            <span style={{ fontSize: fs(11), color: T.soft, fontWeight: 600 }}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* ── 5. COURSE PROGRESS ───────────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: fs(16), fontWeight: 700, margin: 0 }}>Course Progress</h3>
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'not_started', 'in_progress', 'completed'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{ padding: '4px 10px', borderRadius: 6, border: 'none',
                fontSize: fs(11), fontWeight: f === filter ? 700 : 400, cursor: 'pointer',
                background: f === filter ? T.accentD : 'transparent', color: f === filter ? T.accent : T.dim }}>
                {f === 'all' ? 'All' : f === 'not_started' ? 'Not Started' : f === 'in_progress' ? 'In Progress' : 'Done'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: T.dim, fontSize: fs(13) }}>
            No courses match this filter.{' '}
            <span style={{ color: T.accent, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setFilter('all')}>Show all</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(c => {
              const cp = progress.courseProgress?.[c.courseCode] || {};
              const totalHrs = Math.round((cp.total || 0) / 60 * 10) / 10;
              const doneHrs = Math.round((cp.done || 0) / 60 * 10) / 10;
              const pct = cp.total > 0 ? Math.round(cp.done / cp.total * 100) : 0;
              const estHrs = c.averageStudyHours || ([0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50);
              const examDate = c.examDate;
              const daysToExam = examDate ? Math.max(0, diffDays(todayStr(), examDate)) : null;

              return (
                <div key={c.id} style={{ background: T.bg2, borderRadius: 10, overflow: 'hidden',
                  border: `1px solid ${expanded[c.id] ? T.accent + '44' : T.border}`, transition: 'border-color .2s' }}>
                  <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    onClick={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}>
                    <div style={{ width: 4, height: 36, borderRadius: 2, background: STATUS_C[c.status] || T.dim, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: fs(14), fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <Badge color={STATUS_C[c.status] || T.dim} bg={(STATUS_C[c.status] || T.dim) + '22'}>{STATUS_L[c.status] || c.status}</Badge>
                        {c.assessmentType && <Badge color={T.dim} bg={T.input}>{c.assessmentType}</Badge>}
                        {daysToExam != null && daysToExam <= 30 && (
                          <Badge color={daysToExam <= 7 ? T.red : daysToExam <= 14 ? T.orange : T.blue}
                            bg={(daysToExam <= 7 ? T.red : daysToExam <= 14 ? T.orange : T.blue) + '22'}>
                            Exam in {daysToExam}d
                          </Badge>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ flex: 1, height: 7, borderRadius: 4, background: T.input, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4,
                            background: pct >= 80 ? T.accent : pct >= 40 ? T.blue : T.orange, transition: 'width .6s' }} />
                        </div>
                        <span style={{ fontSize: fs(12), fontWeight: 700, color: pct >= 80 ? T.accent : T.text, minWidth: 40, textAlign: 'right' }}>{pct}%</span>
                        <span style={{ fontSize: fs(11), color: T.dim, minWidth: 70, textAlign: 'right' }}>{doneHrs}h / {totalHrs || estHrs}h</span>
                      </div>
                      <div style={{ fontSize: fs(11), color: T.dim, marginTop: 4, display: 'flex', gap: 10 }}>
                        <span>{c.credits || 0} CU</span>
                        <span>{'★'.repeat(c.difficulty || 0)}{'☆'.repeat(5 - (c.difficulty || 0))}</span>
                        {cp.tasksDone != null && <span>{cp.tasksDone}/{cp.tasks} tasks</span>}
                      </div>
                    </div>
                    <span style={{ fontSize: fs(12), color: T.dim, transition: 'transform .2s', transform: expanded[c.id] ? 'rotate(180deg)' : 'rotate(0)', flexShrink: 0 }}>▼</span>
                  </div>
                  {expanded[c.id] && (
                    <div style={{ padding: '0 16px 14px', borderTop: `1px solid ${T.border}` }}>
                      <ErrorBoundary><CourseDetail c={c} /></ErrorBoundary>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 6. ALERTS ────────────────────────────────────────── */}
      {(() => {
        const alerts = [];
        const tasks = data.tasks || {};
        const today = todayStr();

        // Global conflicts
        const futureDatesWithTasks = Object.keys(tasks).filter(d => d >= today).sort();
        let totalConflicts = 0;
        const conflictDates = [];
        for (const d of futureDatesWithTasks) {
          const dt = safeArr(tasks[d]).sort((a, b) => (parseTime(a.time)?.mins ?? 9999) - (parseTime(b.time)?.mins ?? 9999));
          let dayConf = 0;
          for (let i = 0; i < dt.length; i++) {
            const as = parseTime(dt[i].time), ae = parseTime(dt[i].endTime);
            if (!as || !ae) continue;
            for (let j = i + 1; j < dt.length; j++) {
              const bs = parseTime(dt[j].time), be = parseTime(dt[j].endTime);
              if (!bs || !be) continue;
              if (as.mins < be.mins && ae.mins > bs.mins) { totalConflicts++; dayConf++; }
            }
          }
          if (dayConf > 0) conflictDates.push({ date: d, count: dayConf });
        }

        if (totalConflicts > 0) alerts.push(
          <div key="conflicts" style={{ padding: '12px 14px', borderRadius: 10, background: T.redD, border: `1px solid ${T.red}33`, marginBottom: 8 }}>
            <div style={{ fontSize: fs(12), color: T.red, fontWeight: 700 }}>⚠️ {totalConflicts} time overlap{totalConflicts > 1 ? 's' : ''} across {conflictDates.length} day{conflictDates.length > 1 ? 's' : ''}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              {conflictDates.slice(0, 5).map(cd => (
                <button key={cd.date} onClick={() => { setDate(cd.date); setPage('daily'); }} style={{ padding: '5px 10px', borderRadius: 6,
                  border: `1px solid ${T.red}55`, background: T.red + '22', color: T.red, fontSize: fs(11), fontWeight: 600, cursor: 'pointer' }}>
                  {new Date(cd.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ({cd.count})
                </button>
              ))}
            </div>
          </div>
        );

        // Velocity warning
        const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
        const recentMins = sessions.filter(s => new Date(s.date + 'T12:00:00') >= twoWeeksAgo).reduce((s, x) => s + (x.mins || 0), 0);
        const avgHrsPerDay14 = Math.round((recentMins / 60 / 14) * 10) / 10;
        const hrsPerDay = data.studyHoursPerDay || 4;
        if (avgHrsPerDay14 > 0 && avgHrsPerDay14 < hrsPerDay * 0.8) {
          alerts.push(
            <div key="velocity" style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(12), color: T.orange, marginBottom: 8 }}>
              ⚠️ Your 14-day average ({avgHrsPerDay14}h/day) is below target ({hrsPerDay}h/day).
            </div>
          );
        }

        if (alerts.length === 0) return null;
        const visible = alertsExpanded ? alerts : [alerts[0]];
        return (
          <div style={{ marginBottom: 16 }}>
            {visible}
            {alerts.length > 1 && (
              <button onClick={() => setAlertsExpanded(!alertsExpanded)} style={{ background: 'none', border: `1px solid ${T.border}`,
                borderRadius: 8, padding: '6px 14px', fontSize: fs(12), color: T.soft, cursor: 'pointer', fontWeight: 600, width: '100%', textAlign: 'center', marginTop: 2 }}>
                {alertsExpanded ? 'Show less ▲' : `${alerts.length - 1} more alert${alerts.length > 2 ? 's' : ''} ▼`}
              </button>
            )}
          </div>
        );
      })()}

      {/* ── 7. EXAM READINESS ────────────────────────────────── */}
      {examHistory.length > 0 && (() => {
        const byCourse = {};
        examHistory.forEach(e => {
          if (!byCourse[e.courseId]) byCourse[e.courseId] = [];
          byCourse[e.courseId].push(e);
        });
        const entries = Object.entries(byCourse).map(([cid, exams]) => {
          const course = courses.find(c => c.id === cid);
          const sorted = exams.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
          const latest = sorted[sorted.length - 1];
          const trend = sorted.length >= 2 ? (latest.score > sorted[sorted.length - 2].score ? 'up' : latest.score < sorted[sorted.length - 2].score ? 'down' : 'flat') : null;
          return { course, sorted, latest, trend, cid };
        });
        if (entries.length === 0) return null;
        return (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: fs(16), fontWeight: 700, margin: 0 }}>Exam Readiness</h3>
              <Btn small v="ghost" onClick={() => setPage('quiz')}>Take Practice Exam →</Btn>
            </div>
            {entries.map(({ course, sorted, latest, trend, cid }) => {
              const pct = Math.round((latest.score || 0) * 100);
              return (
                <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: fs(13), fontWeight: 600, minWidth: 60 }}>{course?.courseCode || 'Unknown'}</span>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {sorted.slice(-4).map((e, i) => (
                      <span key={i} style={{ fontSize: fs(12), color: Math.round(e.score * 100) >= 80 ? T.accent : T.dim, fontWeight: 600 }}>
                        {Math.round(e.score * 100)}%{i < sorted.slice(-4).length - 1 ? ' →' : ''}
                      </span>
                    ))}
                  </div>
                  <Badge color={trend === 'up' ? T.accent : trend === 'down' ? T.orange : T.dim}
                    bg={(trend === 'up' ? T.accent : trend === 'down' ? T.orange : T.dim) + '22'}>
                    {trend === 'up' ? '▲ Improving' : trend === 'down' ? '▼ Declining' : 'Stable'}
                  </Badge>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── 8. STREAK + ACHIEVEMENTS ─────────────────────────── */}
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: '14px 18px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Ic.IcFire s={26} />
          <div>
            <div style={{ fontSize: fs(16), fontWeight: 800 }}>{streak.currentStreak}-day streak</div>
            <div style={{ fontSize: fs(12), color: T.dim }}>Best: {streak.longestStreak} days</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fs(16), fontWeight: 800, color: T.accent }}>{Math.round(sessions.reduce((s, x) => s + (x.mins || 0), 0) / 60)}h</div>
            <div style={{ fontSize: fs(11), color: T.dim }}>total studied</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fs(16), fontWeight: 800, color: T.purple }}>{completedCourses.length}</div>
            <div style={{ fontSize: fs(11), color: T.dim }}>courses done</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: fs(16), fontWeight: 800, color: T.blue }}>{doneCU}</div>
            <div style={{ fontSize: fs(11), color: T.dim }}>CU earned</div>
          </div>
        </div>
      </div>

    </div>
  );
};

export { DegreeDashboard };
export default DegreeDashboard;
