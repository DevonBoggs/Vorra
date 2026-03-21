import { useState, useMemo, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, diffDays, parseTime } from '../../utils/helpers.js';
import { getSTATUS_C } from '../../constants/categories.js';
import { useBreakpoint } from '../../systems/breakpoint.js';
import { dlog } from '../../systems/debug.js';
import { toast } from '../../systems/toast.js';
import { buildSystemPrompt, runAILoop } from '../../systems/api.js';
import { useBgTask, bgSet, bgLog, getBgState } from '../../systems/background.js';
import { executeTools, safeArr } from '../../utils/toolExecution.js';
import { Badge } from '../../components/ui/Badge.jsx';
import { Label } from '../../components/ui/Label.jsx';
import { BufferedInput } from '../../components/ui/BufferedInput.jsx';
import { Btn } from '../../components/ui/Btn.jsx';
import { LogLine } from '../../components/ui/LogLine.jsx';
import { hasCtx } from '../../utils/courseHelpers.js';
import {
  MAX_STUDY_HRS,
  calcTotalEstHours,
  calcStudyDays,
  calcMinHrsWithDates,
  calcEstCompletion,
} from '../../utils/planCalculations.js';

const StudyPlannerPage = ({ data, setData, profile, setPage }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const [pendingPlan, setPendingPlan] = useState(null);
  const [planPrompt, setPlanPrompt] = useState('');
  const [newExDate, setNewExDate] = useState('');
  const [manualStepOpen, setManualStepOpen] = useState({});

  // Global background task state
  const bg = useBgTask();

  const courses = data.courses || [];
  const activeCourses = courses.filter(c => c.status !== 'completed');
  const totalEstHours = calcTotalEstHours(courses);
  const hrsPerDay = data.studyHoursPerDay || 4;
  const exceptionDates = safeArr(data.exceptionDates);
  const startDate = data.studyStartDate || todayStr();
  const startTime = data.studyStartTime || '08:00';

  // Two-date system
  const goalDate = data.targetCompletionDate || data.targetDate || null;
  const effectiveTarget = goalDate;
  const effectiveDaysLeft = effectiveTarget ? Math.max(0, diffDays(todayStr(), effectiveTarget)) : null;

  // Hours on first day (from start time to ~10 PM)
  const startTimeParts = startTime.split(':').map(Number);
  const firstDayHours = Math.max(0, Math.min(hrsPerDay, 22 - (startTimeParts[0] || 8) - (startTimeParts[1] || 0) / 60));
  const adjustedHours = firstDayHours < hrsPerDay ? totalEstHours - firstDayHours + hrsPerDay : totalEstHours;
  const rawDaysNeeded = Math.ceil(adjustedHours / hrsPerDay);

  // Estimated completion
  const estCompletionDate = calcEstCompletion(startDate, rawDaysNeeded, exceptionDates);

  // Min hrs/day to hit target
  const minHrsPerDay = (() => {
    if (!effectiveTarget || !startDate) return null;
    const availDays = calcStudyDays(startDate, effectiveTarget, exceptionDates);
    if (availDays <= 0) return null;
    return Math.ceil((totalEstHours / availDays) * 10) / 10;
  })();

  // Feasibility calculator
  const localCalcMinHrsWithDates = (extraDates) => {
    return calcMinHrsWithDates(startDate, effectiveTarget, totalEstHours, exceptionDates, extraDates);
  };

  // Exception dates management
  const addExDate = () => {
    if (!newExDate || exceptionDates.includes(newExDate)) return;
    if (!data.overrideSafeguards) {
      const projected = localCalcMinHrsWithDates([newExDate]);
      if (projected !== null && projected > MAX_STUDY_HRS) {
        toast(`Can't add \u2014 would require ${projected}h/day (max ${MAX_STUDY_HRS}h). Enable override in settings to bypass.`, 'error');
        return;
      }
    }
    setData(d => ({ ...d, exceptionDates: [...safeArr(d.exceptionDates), newExDate].sort() }));
    setNewExDate('');
  };
  const removeExDate = (dt) => setData(d => ({ ...d, exceptionDates: safeArr(d.exceptionDates).filter(x => x !== dt) }));

  const addRecurringDayOff = (dayIndices) => {
    const start = data.studyStartDate || todayStr();
    const end = data.targetCompletionDate || data.targetDate;
    if (!end) { toast('Set a target completion or term end date first', 'warn'); return; }
    const newDates = [];
    const d = new Date(start + 'T12:00:00');
    const endD = new Date(end + 'T12:00:00');
    while (d <= endD) {
      if (dayIndices.includes(d.getDay())) {
        const ds = d.toISOString().split('T')[0];
        if (!exceptionDates.includes(ds)) newDates.push(ds);
      }
      d.setDate(d.getDate() + 1);
    }
    if (newDates.length === 0) { toast('No new dates to add', 'info'); return; }
    if (!data.overrideSafeguards) {
      const projected = localCalcMinHrsWithDates(newDates);
      if (projected !== null && projected > MAX_STUDY_HRS) {
        toast(`Can't add ${newDates.length} days off \u2014 would require ${projected}h/day (max ${MAX_STUDY_HRS}h). Enable override to bypass.`, 'error');
        return;
      }
    }
    setData(dd => ({ ...dd, exceptionDates: [...safeArr(dd.exceptionDates), ...newDates].sort() }));
    const projected = localCalcMinHrsWithDates(newDates);
    const projLabel = projected !== null ? ` (\u2192 ${projected}h/day needed)` : '';
    toast(`Added ${newDates.length} day${newDates.length > 1 ? 's' : ''} off${projLabel}`, 'success');
  };
  const clearRecurringDayOff = (dayIndices) => {
    setData(dd => ({ ...dd, exceptionDates: safeArr(dd.exceptionDates).filter(dt => !dayIndices.includes(new Date(dt + 'T12:00:00').getDay())) }));
    toast('Removed recurring days off', 'info');
  };

  // Step open/close
  const isStepOpen = (n) => {
    if (manualStepOpen[n] !== undefined) return manualStepOpen[n];
    return true; // default open
  };
  const toggleStep = (n) => setManualStepOpen(p => ({ ...p, [n]: !isStepOpen(n) }));

  const StepHead = ({ n, title, done, disabled, subtitle, children }) => (
    <div style={{ background: T.card, border: `1px solid ${done ? T.accent + '33' : T.border}`, borderRadius: 12, marginBottom: 16, overflow: 'hidden', opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity .2s' }}>
      <button onClick={() => toggleStep(n)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: done ? T.accent : T.input, border: `2px solid ${done ? T.accent : T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(11), fontWeight: 800, color: done ? '#fff' : T.dim, flexShrink: 0 }}>
            {done ? '\u2713' : n}
          </div>
          <div>
            <div style={{ fontSize: fs(14), fontWeight: 700, color: disabled ? T.dim : done ? T.soft : T.text }}>{title}</div>
            {subtitle && !isStepOpen(n) && <div style={{ fontSize: fs(10), color: T.dim, marginTop: 1 }}>{subtitle}</div>}
          </div>
        </div>
        {!disabled && <span style={{ fontSize: fs(10), color: T.dim, transition: 'transform .2s', transform: isStepOpen(n) ? 'rotate(180deg)' : 'rotate(0)' }}>{isStepOpen(n) ? '\u25B2' : '\u25BC'}</span>}
      </button>
      {isStepOpen(n) && !disabled && <div style={{ padding: '0 18px 16px' }}>{children}</div>}
    </div>
  );

  const AIActivity = () => (bg.loading || bg.logs.length > 0) ? (
    <div style={{ background: T.panel, border: `1px solid ${T.purple}33`, borderRadius: 10, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bg.streamText || bg.logs.length > 0 ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {bg.loading && <Ic.Spin s={14} />}
          <span style={{ fontSize: fs(12), fontWeight: 700, color: bg.loading ? T.purple : T.soft }}>{bg.loading ? (bg.label || 'AI working...') : 'AI Activity'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {bg.loading && getBgState().abortCtrl && <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, label: '' }); toast('Cancelled', 'info'); }}>Cancel</Btn>}
          {!bg.loading && bg.logs.length > 0 && <Btn small v="ghost" onClick={() => bgSet({ logs: [] })}>Clear</Btn>}
        </div>
      </div>
      {bg.streamText && <div style={{ padding: '6px 10px', borderRadius: 7, background: T.purpleD, border: `1px solid ${T.purple}33`, fontSize: fs(11), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto', marginBottom: 4 }}>{bg.streamText}</div>}
      {bg.logs.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>{bg.logs.map((l, i) => <LogLine key={i} l={l} />)}</div>}
    </div>
  ) : null;

  // Generate plan
  const genPlan = async () => {
    if (!profile) return;
    const active = courses.filter(c => c.status !== 'completed');
    if (!active.length) return;
    // Pre-flight validation
    if (!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS) { toast('Schedule is infeasible \u2014 adjust dates or enable override', 'error'); return; }
    if (!data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) { toast('Estimated finish exceeds term end date \u2014 increase hours, remove days off, or enable override', 'error'); return; }
    if (!data.studyStartDate) { toast('Set a start date in Study Settings first', 'warn'); return; }
    if (!data.targetCompletionDate && !data.targetDate) { toast('Set a target completion or term end date first', 'warn'); return; }
    if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) { toast('Target completion is after term end \u2014 fix your dates first', 'error'); return; }
    if (hrsPerDay < 1) { toast('Hours/day must be at least 1', 'warn'); return; }
    bgSet({ loading: true, logs: [{ type: 'user', content: 'Generating study plan in weekly chunks...' }], label: 'Generating study plan...' });

    const capturedTasks = [];
    const previewSetData = (fn) => {
      setData(d => {
        const next = typeof fn === 'function' ? fn(d) : fn;
        if (next.tasks) {
          for (const [dt, dayTasks] of Object.entries(next.tasks)) {
            const oldTasks = d.tasks?.[dt] || [];
            const newOnes = safeArr(dayTasks).filter(t => !oldTasks.some(o => o.id === t.id));
            newOnes.forEach(t => capturedTasks.push({ ...t, date: dt }));
          }
        }
        return next;
      });
    };

    const courseDetails = active.map((c, i) => {
      const hrs = c.averageStudyHours > 0 ? c.averageStudyHours : ([0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50);
      return `${i + 1}. ${c.name}${c.courseCode ? ` (${c.courseCode})` : ''} \u2014 ${hrs}h est, ${c.credits || '?'}CU, ${c.assessmentType || '?'}, diff ${c.difficulty || 3}/5`;
    }).join('\n');

    const startDt = data.studyStartDate || todayStr();
    const targetDt = goalDate || data.targetDate || '';
    const gradDt = data.targetDate || '';
    const hpd = data.studyHoursPerDay || 4;
    const exDts = safeArr(data.exceptionDates);
    const userCtx = planPrompt.trim() ? `\nStudent preferences: ${planPrompt.trim()}` : '';

    const endDt = targetDt || gradDt;
    const totalDays = endDt ? diffDays(startDt, endDt) : (Math.ceil(totalEstHours / hpd) + 7);
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

    let hoursAssigned = 0;

    for (let week = 0; week < totalWeeks; week++) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({ type: 'error', content: `Stopped after week ${week}` }); break; }

      const weekStart = new Date(startDt + 'T12:00:00');
      weekStart.setDate(weekStart.getDate() + week * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const ws = weekStart.toISOString().split('T')[0];
      const we = weekEnd.toISOString().split('T')[0];

      if (endDt && ws > endDt) break;

      bgSet({ label: `Generating week ${week + 1}/${totalWeeks}: ${ws} \u2014 ${we}...` });
      bgLog({ type: 'user', content: `\ud83d\udcc5 Week ${week + 1}/${totalWeeks}: ${ws} \u2192 ${we}` });

      const weekExDts = exDts.filter(d => d >= ws && d <= we);
      const hoursRemaining = totalEstHours - hoursAssigned;
      if (hoursRemaining <= 0) { bgLog({ type: 'text', content: 'All course hours assigned \u2014 done!' }); break; }

      const sys = buildSystemPrompt(data, `Use generate_study_plan to create tasks for ONLY ${ws} through ${we} (7 days). Do NOT use add_tasks. Do NOT plan outside this date range.`);

      const weekMsg = `Generate study tasks for WEEK ${week + 1} ONLY: ${ws} to ${we}.

COURSES (STRICT PRIORITY ORDER \u2014 complete #1 before starting #2, etc.):
${courseDetails}

PROGRESS: ~${Math.round(hoursAssigned)}h already scheduled of ~${totalEstHours}h total. ~${Math.round(hoursRemaining)}h remaining.
Hours/day: ${hpd}h | ${weekExDts.length > 0 ? `Days off this week: ${weekExDts.join(', ')}` : 'No days off this week'}
${week === 0 && data.studyStartTime ? `First day starts at ${data.studyStartTime}` : ''}

SEQUENTIAL RULE (CRITICAL):
- Study ONE course at a time. Do NOT mix courses on the same day.
- Fully schedule all hours for course #1 first. Only move to course #2 after course #1's hours are exhausted.
- Exception: the transition day where course #1 finishes can have course #2 start after.
- Based on ${Math.round(hoursAssigned)}h already assigned, calculate which course we're currently on and continue from there.

CATEGORY TAGS (use these exactly):
- "study" = Learning new material, reading, watching lectures
- "review" = Revisiting/revising previously learned material
- "exam-prep" = Practice exams, mock tests, focused test preparation
- "exam-day" = The ACTUAL assessment day (OA exam or PA submission)
- "project" = Performance Assessment (PA) writing, research, drafting
- "class" = Live cohort sessions, instructor webinars
- "break" = Short rest between study blocks, meals

TASK STRUCTURE RULES:
- ONLY create tasks between ${ws} and ${we}. No dates outside this range.
- Study blocks: 1\u20132.5h max. Include 10\u201315 min breaks between blocks.
- Include a 30\u201360 min meal/rest break if 4+ hours in one day.
- Title format: "CourseCode \u2014 Specific Topic" (e.g., "D415 \u2014 SDN Architecture: Three Layers").
- When a course is nearly complete (~last 10-15% of hours), switch to "review" and "exam-prep" categories.
- Schedule an "exam-day" task on the LAST day of each course (1-2h block, title: "CourseCode \u2014 \ud83c\udfaf OA Exam" or "CourseCode \u2014 \ud83c\udfaf Submit PA").
- For PA courses, schedule "project" category tasks for writing/research.
- Each task needs date (YYYY-MM-DD), time, endTime (24h format).
- ~${Math.min(hpd * 7, hoursRemaining)}h this week.
${userCtx}`;

      try {
        const { logs: wLogs } = await runAILoop(profile, sys, [{ role: 'user', content: weekMsg }], data, previewSetData, executeTools);
        for (const l of wLogs) bgLog(l);
        const weekTasks = capturedTasks.filter(t => t.date >= ws && t.date <= we);
        const weekHrs = weekTasks.reduce((s, t) => {
          const st = parseTime(t.time), et = parseTime(t.endTime);
          return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0);
        }, 0);
        hoursAssigned += weekHrs;
        bgLog({ type: 'text', content: `Week ${week + 1}: ${weekTasks.length} tasks, ~${Math.round(weekHrs)}h (total: ~${Math.round(hoursAssigned)}h/${totalEstHours}h)` });
      } catch (e) {
        bgLog({ type: 'error', content: `Week ${week + 1} failed: ${e.message}` });
      }
    }

    bgSet({ loading: false, regenId: null, label: '' });
    if (capturedTasks.length > 0) {
      setPendingPlan({ tasks: capturedTasks, summary: `${capturedTasks.length} tasks across ${[...new Set(capturedTasks.map(t => t.date))].length} days (~${Math.round(hoursAssigned)}h scheduled)` });
      toast(`Plan generated \u2014 review ${capturedTasks.length} tasks before confirming`, 'info');
    } else {
      toast('No tasks were generated \u2014 try adjusting your prompt or checking your AI connection', 'warn');
    }
  };

  const confirmPlan = () => {
    if (!pendingPlan) return;
    setPendingPlan(null);
    toast(`Study plan confirmed: ${pendingPlan.tasks.length} tasks added to calendar`, 'success');
  };

  const discardPlan = () => {
    if (!pendingPlan) return;
    setData(d => {
      const tasks = { ...d.tasks };
      for (const t of pendingPlan.tasks) {
        if (tasks[t.date]) {
          tasks[t.date] = tasks[t.date].filter(x => x.id !== t.id);
          if (tasks[t.date].length === 0) delete tasks[t.date];
        }
      }
      return { ...d, tasks };
    });
    setPendingPlan(null);
    toast('Plan discarded', 'info');
  };

  // Cross-linking CTAs
  const unenrichedCount = activeCourses.filter(c => !hasCtx(c)).length;
  const needsHoursCount = courses.filter(c => c.status !== 'completed' && (!c.averageStudyHours || c.averageStudyHours <= 0)).length;
  const hasSettings = !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
  const step2Done = courses.length > 0 && needsHoursCount === 0 && hasSettings;

  return (
    <div className="fade">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setPage('dashboard')} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: T.soft, fontSize: fs(12), fontWeight: 600 }}>{'\u2190'} Dashboard</button>
          <div><h1 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 2 }}>Study Planner</h1><p style={{ color: T.dim, fontSize: fs(13) }}>{activeCourses.length} active courses {'\u00B7'} {totalEstHours}h estimated</p></div>
        </div>
      </div>

      {/* Cross-linking CTAs */}
      {courses.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: fs(14), color: T.dim, marginBottom: 12 }}>No courses imported yet.</div>
          <Btn v="ai" onClick={() => setPage('courses')}>First, import your courses {'\u2192'}</Btn>
        </div>
      )}
      {courses.length > 0 && unenrichedCount > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{unenrichedCount} course{unenrichedCount > 1 ? 's' : ''} need enrichment for better plan quality.</span>
          <Btn small v="ghost" onClick={() => setPage('courses')} style={{ color: T.orange, borderColor: T.orange + '55' }}>{unenrichedCount} courses need enrichment {'\u2192'}</Btn>
        </div>
      )}

      {/* STEP 1: Study Settings */}
      {courses.length > 0 && (
        <StepHead n={1} title="Study Settings" done={step2Done} subtitle={step2Done ? `${activeCourses.length} courses \u00B7 ${hrsPerDay}h/day \u00B7 ${data.targetCompletionDate ? new Date(data.targetCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}` : ''}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                {'\ud83d\udcc5'} Dates & Hours
                {hasSettings && <Badge color={T.accent} bg={T.accentD}>{'\u2713'}</Badge>}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: fs(10), color: data.overrideSafeguards ? T.orange : T.dim }}>
                <input type="checkbox" checked={!!data.overrideSafeguards} onChange={e => setData(d => ({ ...d, overrideSafeguards: e.target.checked }))} style={{ width: 14, height: 14, accentColor: T.orange }} />
                Override safeguards
              </label>
            </div>

            {/* Row 1: Dates */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <Label>1. Start Date *</Label>
                <BufferedInput type="date" value={data.studyStartDate || ''} onCommit={v => setData(d => ({ ...d, studyStartDate: v }))} />
              </div>
              <div style={{ opacity: data.studyStartDate ? 1 : 0.4, pointerEvents: data.studyStartDate ? 'auto' : 'none' }}>
                <Label>2. Target Completion *</Label>
                <BufferedInput type="date" value={data.targetCompletionDate || ''} onCommit={v => setData(d => ({ ...d, targetCompletionDate: v }))} title="When you want to finish all courses" />
              </div>
              <div style={{ opacity: data.studyStartDate && data.targetCompletionDate ? 1 : 0.4, pointerEvents: data.studyStartDate && data.targetCompletionDate ? 'auto' : 'none' }}>
                <Label>3. Term End Date</Label>
                <BufferedInput type="date" value={data.targetDate || ''} onCommit={v => setData(d => ({ ...d, targetDate: v }))} title="Official term end date (hard deadline)" />
              </div>
              <div style={{ opacity: data.studyStartDate && (data.targetCompletionDate || data.targetDate) ? 1 : 0.4, pointerEvents: data.studyStartDate && (data.targetCompletionDate || data.targetDate) ? 'auto' : 'none' }}>
                <Label>4. Start Time</Label>
                <BufferedInput type="time" value={data.studyStartTime || ''} onCommit={v => setData(d => ({ ...d, studyStartTime: v }))} />
              </div>
            </div>

            {/* Row 2: Hours/Day */}
            {data.studyStartDate && (data.targetCompletionDate || data.targetDate) && (() => {
              const recHrs = minHrsPerDay != null && minHrsPerDay > 0 && minHrsPerDay <= MAX_STUDY_HRS ? Math.ceil(minHrsPerDay) : 4;
              return (
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
                  <div style={{ width: 120 }}>
                    <Label>5. Hours/Day</Label>
                    <BufferedInput type="number" min="1" max={data.overrideSafeguards ? 24 : MAX_STUDY_HRS} value={data.studyHoursPerDay || 4} onCommit={v => {
                      const max = data.overrideSafeguards ? 24 : MAX_STUDY_HRS;
                      const n = Math.max(1, Math.min(max, Number(v) || 4));
                      setData(d => ({ ...d, studyHoursPerDay: n }));
                    }} />
                  </div>
                  {hrsPerDay < recHrs && (
                    <button onClick={() => setData(d => ({ ...d, studyHoursPerDay: recHrs }))} style={{ padding: '8px 14px', borderRadius: 8, border: `1px solid ${T.accent}44`, background: T.accentD, cursor: 'pointer', fontSize: fs(11), fontWeight: 600, color: T.accent, marginBottom: 1 }}>
                      Set to minimum ({recHrs}h/day)
                    </button>
                  )}
                  <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 6 }}>
                    Minimum: {minHrsPerDay ?? '\u2014'}h/day to finish on time
                  </div>
                </div>
              );
            })()}

            {/* Day Off Section */}
            {data.studyStartDate && (data.targetCompletionDate || data.targetDate) && (
              <div style={{ background: T.input, borderRadius: 10, padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>{'\ud83d\udeab'} Days Off & Exceptions</div>
                  <span style={{ fontSize: fs(10), color: T.dim }}>{exceptionDates.length} day{exceptionDates.length !== 1 ? 's' : ''} excluded</span>
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                  <input type="date" value={newExDate} onChange={e => setNewExDate(e.target.value)} style={{ flex: '0 0 160px' }} /><Btn small onClick={addExDate} disabled={!newExDate}>Add Date</Btn>
                </div>

                {/* Recurring buttons */}
                <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 6 }}>Quick add recurring days off (through {new Date((data.targetCompletionDate || data.targetDate) + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}):</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                  {(() => {
                    const override = !!data.overrideSafeguards;
                    const wkndDates = [];
                    const s = new Date((data.studyStartDate || todayStr()) + 'T12:00:00');
                    const e = new Date((data.targetCompletionDate || data.targetDate) + 'T12:00:00');
                    while (s <= e) { if ([0, 6].includes(s.getDay())) { const ds = s.toISOString().split('T')[0]; if (!exceptionDates.includes(ds)) wkndDates.push(ds); } s.setDate(s.getDate() + 1); }
                    const wkndProjected = wkndDates.length > 0 ? localCalcMinHrsWithDates(wkndDates) : null;
                    const wkndBlocked = !override && wkndProjected !== null && wkndProjected > MAX_STUDY_HRS;
                    return <Btn small v="secondary" onClick={() => addRecurringDayOff([0, 6])} disabled={wkndBlocked} title={wkndBlocked ? `Would require ${wkndProjected}h/day` : ''}>{'\ud83d\uddd3'} Weekends</Btn>;
                  })()}
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => {
                    const override = !!data.overrideSafeguards;
                    const count = exceptionDates.filter(dt => new Date(dt + 'T12:00:00').getDay() === i).length;
                    let wouldBlock = false;
                    if (!override && count === 0) {
                      const newDays = [];
                      const s = new Date((data.studyStartDate || todayStr()) + 'T12:00:00');
                      const e = new Date((data.targetCompletionDate || data.targetDate) + 'T12:00:00');
                      while (s <= e) { if (s.getDay() === i) { const ds = s.toISOString().split('T')[0]; if (!exceptionDates.includes(ds)) newDays.push(ds); } s.setDate(s.getDate() + 1); }
                      const proj = localCalcMinHrsWithDates(newDays);
                      wouldBlock = proj !== null && proj > MAX_STUDY_HRS;
                    }
                    return (
                      <button key={i} onClick={() => count > 0 ? clearRecurringDayOff([i]) : addRecurringDayOff([i])} disabled={wouldBlock && count === 0}
                        title={wouldBlock ? 'Would exceed limit (enable override)' : count > 0 ? `Remove all ${day}s` : `Add every ${day} off`}
                        style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${count > 0 ? T.orange : wouldBlock ? T.red + '55' : T.border}`, background: count > 0 ? T.orangeD : T.input, color: count > 0 ? T.orange : wouldBlock ? T.red : T.soft, fontSize: fs(10), fontWeight: 600, cursor: wouldBlock && count === 0 ? 'not-allowed' : 'pointer', opacity: wouldBlock && count === 0 ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {day}{count > 0 && <span style={{ fontSize: fs(8), opacity: 0.7 }}>({count})</span>}
                      </button>
                    );
                  })}
                  {exceptionDates.length > 0 && <Btn small v="ghost" onClick={() => { if (confirm(`Clear all ${exceptionDates.length} exception dates?`)) setData(d => ({ ...d, exceptionDates: [] })); }}>Clear All</Btn>}
                </div>

                {exceptionDates.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 120, overflowY: 'auto' }}>{exceptionDates.map(dt => <div key={dt} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 5, background: T.orangeD, fontSize: fs(10), color: T.orange }}>{new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}<button onClick={() => removeExDate(dt)} style={{ background: 'none', border: 'none', color: T.orange, cursor: 'pointer', fontSize: fs(12), padding: 0 }}>{'\u00D7'}</button></div>)}</div>}
              </div>
            )}

            {/* Warnings */}
            {minHrsPerDay != null && minHrsPerDay > 12 && !data.overrideSafeguards && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: minHrsPerDay > MAX_STUDY_HRS ? T.redD : T.orangeD, border: `1px solid ${minHrsPerDay > MAX_STUDY_HRS ? T.red : T.orange}33`, fontSize: fs(11), color: minHrsPerDay > MAX_STUDY_HRS ? T.red : T.orange, marginBottom: 10 }}>
                {minHrsPerDay > MAX_STUDY_HRS
                  ? `\ud83d\udea8 Infeasible: ${minHrsPerDay}h/day needed \u2014 exceeds ${MAX_STUDY_HRS}h max. Remove days off, extend target, or enable override.`
                  : `\u26A0\uFE0F Tight: ${minHrsPerDay}h/day needed. Consider removing exception dates.`}
              </div>
            )}
            {data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 10 }}>
                {'\u26A0\uFE0F'} Override active {'\u2014'} {minHrsPerDay}h/day required. Safeguards disabled at your request.
              </div>
            )}

            {/* Validation checks */}
            {(() => {
              const warns = [];
              if (hrsPerDay < 2 && totalEstHours > 0) warns.push({ c: T.orange, m: `\u26A0\uFE0F ${hrsPerDay}h/day is very low. Most students need 3-6h/day.` });
              if (hrsPerDay > 12 && hrsPerDay <= MAX_STUDY_HRS) warns.push({ c: T.orange, m: `\u26A0\uFE0F ${hrsPerDay}h/day is extremely high. Risk of burnout.` });
              if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) warns.push({ c: T.red, m: '\ud83d\udea8 Target completion is AFTER term end.' });
              if (data.studyStartDate && data.targetCompletionDate && data.studyStartDate >= data.targetCompletionDate) warns.push({ c: T.red, m: '\ud83d\udea8 Start date on or after completion \u2014 no study days.' });
              if (data.studyStartDate && data.studyStartDate > todayStr()) warns.push({ c: T.blue, m: `\u2139\uFE0F Start date is in the future.` });
              if (estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) {
                const overDays = diffDays(data.targetDate, estCompletionDate);
                warns.push({ c: T.red, m: `\ud83d\udea8 Estimated finish (${new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) is ${overDays} day${overDays > 1 ? 's' : ''} past your term end. Increase hours/day, remove days off, or extend your term.` });
              } else if (estCompletionDate && data.targetCompletionDate && estCompletionDate > data.targetCompletionDate) {
                const overDays = diffDays(data.targetCompletionDate, estCompletionDate);
                warns.push({ c: T.orange, m: `\u26A0\uFE0F Estimated finish (${new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) is ${overDays} day${overDays > 1 ? 's' : ''} past your target completion.` });
              }
              const studyDaysAvail = effectiveTarget && startDate ? calcStudyDays(startDate, effectiveTarget, exceptionDates) : null;
              const totalCalDays = effectiveTarget && startDate ? diffDays(startDate, effectiveTarget) : null;
              if (studyDaysAvail != null && totalCalDays != null && totalCalDays > 0) {
                const offPct = Math.round((1 - studyDaysAvail / totalCalDays) * 100);
                if (offPct > 60) warns.push({ c: T.red, m: `\ud83d\udea8 ${offPct}% of calendar is days off. Only ${studyDaysAvail} study days.` });
              }
              if (warns.length === 0) return null;
              return <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>{warns.map((w, i) => <div key={i} style={{ padding: '6px 12px', borderRadius: 7, background: `${w.c}11`, border: `1px solid ${w.c}33`, fontSize: fs(10), color: w.c }}>{w.m}</div>)}</div>;
            })()}
          </div>

          {/* Enrich courses CTA if hours are missing (enrichment now guarantees hours) */}
          {needsHoursCount > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{needsHoursCount} course{needsHoursCount > 1 ? 's' : ''} need enrichment for accurate hour estimates.</span>
              <Btn small v="ghost" onClick={() => setPage('courses')} style={{ color: T.orange, borderColor: T.orange + '55' }}>Enrich courses {'\u2192'}</Btn>
            </div>
          )}
        </StepHead>
      )}

      {/* Planning Intelligence stats */}
      {activeCourses.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { l: 'Est. Hours', v: totalEstHours, c: T.purple, sub: `${activeCourses.length} courses` },
            { l: 'Est. Days', v: rawDaysNeeded, c: T.blue, sub: `at ${hrsPerDay}h/day` },
            { l: 'Est. Finish', v: estCompletionDate ? new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + " '" + new Date(estCompletionDate + 'T12:00:00').getFullYear().toString().slice(2) : '\u2014', c: estCompletionDate && data.targetDate && estCompletionDate > data.targetDate ? T.red : estCompletionDate && effectiveTarget && estCompletionDate > effectiveTarget ? T.orange : T.accent, sub: estCompletionDate && data.targetDate && estCompletionDate > data.targetDate ? '\u26A0 past term end' : effectiveDaysLeft != null ? `${effectiveDaysLeft}d to goal` : 'set target' },
            { l: 'Min Hrs/Day', v: minHrsPerDay != null ? (!data.overrideSafeguards && minHrsPerDay > MAX_STUDY_HRS ? '\u274C' : minHrsPerDay) : '\u2014', c: minHrsPerDay != null && !data.overrideSafeguards && minHrsPerDay > MAX_STUDY_HRS ? T.red : minHrsPerDay != null && minHrsPerDay > 12 ? T.red : minHrsPerDay != null && minHrsPerDay > 8 ? T.orange : T.accent, sub: minHrsPerDay != null && !data.overrideSafeguards && minHrsPerDay > MAX_STUDY_HRS ? 'infeasible' : effectiveTarget ? 'to hit target' : '\u2014' },
          ].map((s, i) => (
            <div key={i} className="sf-stat" style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '12px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: fs(9), color: T.dim, textTransform: 'uppercase', letterSpacing: .5, fontWeight: 600, marginBottom: 4 }}>{s.l}</div>
              <div style={{ fontSize: fs(22), fontWeight: 800, color: s.c, fontFamily: "'Outfit',sans-serif" }}>{s.v}</div>
              <div style={{ fontSize: fs(9), color: T.dim }}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}
      {!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS && <div style={{ padding: '10px 14px', borderRadius: 10, background: T.redD, border: `1px solid ${T.red}33`, fontSize: fs(12), color: T.red, marginBottom: 12, fontWeight: 600 }}>{'\ud83d\udea8'} Schedule is infeasible {'\u2014'} {minHrsPerDay}h/day required but maximum is {MAX_STUDY_HRS}h. Extend your target date, remove days off, or enable override.</div>}
      {!data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate && (minHrsPerDay == null || minHrsPerDay <= MAX_STUDY_HRS) && <div style={{ padding: '10px 14px', borderRadius: 10, background: T.redD, border: `1px solid ${T.red}33`, fontSize: fs(12), color: T.red, marginBottom: 12, fontWeight: 600 }}>{'\ud83d\udea8'} Estimated finish ({new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) exceeds term end ({new Date(data.targetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}). Increase hours/day or reduce days off.</div>}
      {minHrsPerDay != null && minHrsPerDay > hrsPerDay && minHrsPerDay <= MAX_STUDY_HRS && <div style={{ padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 12 }}>You need {minHrsPerDay}h/day to hit your target completion {'\u2014'} currently set to {hrsPerDay}h/day.</div>}

      {/* STEP 2: Generate Study Plan */}
      {courses.length > 0 && (() => {
        const isBusy = bg.loading && !(bg.label || '').toLowerCase().includes('plan');
        const isGenerating = bg.loading && (bg.label || '').toLowerCase().includes('plan');
        return (
          <StepHead n={2} title="Generate Study Plan" done={Object.keys(data.tasks || {}).length > 0} disabled={!step2Done} subtitle={Object.keys(data.tasks || {}).length > 0 ? `${Object.keys(data.tasks || {}).length} days scheduled` : ''}>
            <textarea value={planPrompt} onChange={e => setPlanPrompt(e.target.value)} disabled={isBusy} placeholder="Optional: Describe your scheduling preferences \u2014 e.g. 'I work 9-5 weekdays so only schedule study in evenings and weekends'..." style={{ minHeight: 45, fontSize: fs(11), marginBottom: 10, opacity: isBusy ? 0.4 : 1 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: pendingPlan ? 12 : 0 }}>
              {isGenerating && getBgState().abortCtrl && (
                <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, regenId: null, label: '' }); toast('Plan generation stopped', 'info'); }} style={{ color: T.red, borderColor: T.red }}>{'\u2B1B'} Stop</Btn>
              )}
              <Btn v={isBusy ? 'secondary' : 'ai'} onClick={genPlan} disabled={bg.loading || !profile || activeCourses.length === 0 || (!data.overrideSafeguards && ((minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS) || (estCompletionDate && data.targetDate && estCompletionDate > data.targetDate)))}>
                {!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS ? 'Schedule Infeasible' : !data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate ? 'Exceeds Term End' : isGenerating ? <><Ic.Spin s={14} /> Generating...</> : isBusy ? 'Waiting...' : 'Generate Plan'}
              </Btn>
            </div>
            {pendingPlan && (
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: fs(12), color: T.soft }}>{pendingPlan.summary}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Btn small v="primary" onClick={confirmPlan}>Confirm</Btn>
                    <Btn small v="ghost" onClick={discardPlan}>Discard</Btn>
                  </div>
                </div>
                <div style={{ maxHeight: 250, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[...new Set(pendingPlan.tasks.map(t => t.date))].sort().map(dt => (
                    <div key={dt}>
                      <div style={{ fontSize: fs(10), fontWeight: 700, color: T.accent, padding: '4px 0 2px' }}>{new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                      {pendingPlan.tasks.filter(t => t.date === dt).map((t, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', borderRadius: 6, background: T.input, marginBottom: 2, fontSize: fs(10) }}>
                          <span style={{ color: T.blue, minWidth: 40, fontFamily: "'JetBrains Mono',monospace" }}>{t.time || '\u2014'}</span>
                          <span style={{ flex: 1, color: T.text }}>{t.title}</span>
                          {t.endTime && <span style={{ color: T.dim, fontSize: fs(9) }}>{'\u2192'} {t.endTime}</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <AIActivity />
          </StepHead>
        );
      })()}
    </div>
  );
};

export { StudyPlannerPage };
export default StudyPlannerPage;
