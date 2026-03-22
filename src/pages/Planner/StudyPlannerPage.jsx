import { useState, useMemo, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, diffDays, parseTime, uid } from '../../utils/helpers.js';
import { downloadICS } from '../../utils/icsExport.js';
import { DEFAULT_W, DEFAULT_REQUEST_RETENTION } from '../../systems/spaced-repetition.js';
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
import { PillGroup } from '../../components/ui/PillGroup.jsx';
import { WeeklyAvailabilityEditor } from '../../components/planner/WeeklyAvailabilityEditor.jsx';
import { hasCtx } from '../../utils/courseHelpers.js';
import { LIFE_TEMPLATES, LIFE_TEMPLATE_IDS } from '../../constants/lifeTemplates.js';
import {
  MAX_STUDY_HRS,
  calcTotalEstHours,
  calcStudyDays,
  calcMinHrsWithDates,
  calcEstCompletion,
} from '../../utils/planCalculations.js';
import {
  getEffectiveHours,
  getAvgHoursPerDay,
  getWeeklyHours,
  getStudyDaysPerWeek,
  buildAvailabilityPrompt,
  calcStudyDaysWithAvailability,
  calcTotalAvailableHours,
  calcMinHrsWithAvailability,
  calcEstCompletionWithAvailability,
  deriveStudyMode,
  deriveTargetDate,
  deriveStartTime,
  migrateToPlannerConfig,
  DAY_NAMES,
} from '../../utils/availabilityCalc.js';

const STUDY_MODES = [
  { value: 'sequential', label: 'One at a time', icon: '\u27A1' },
  { value: 'parallel', label: 'Multiple at once', icon: '\u2194' },
  { value: 'hybrid', label: 'Mix of both', icon: '\u21C4' },
];
const PACING_STYLES = [
  { value: 'steady', label: 'Same every day' },
  { value: 'wave', label: 'Heavy/light days' },
  { value: 'sprint-rest', label: 'Intense + rest' },
];
const BLOCK_STYLES = [
  { value: 'standard', label: 'Standard (60-90m)' },
  { value: 'pomodoro', label: 'Pomodoro (25m)' },
  { value: 'sprint', label: 'Deep focus (50m)' },
];

const StudyPlannerPage = ({ data, setData, profile, setPage }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  // pendingPlan persisted in data to survive navigation
  const pendingPlan = data.pendingPlan || null;
  const setPendingPlan = (v) => setData(d => ({ ...d, pendingPlan: v }));
  const [planPrompt, setPlanPrompt] = useState('');
  const [newExDate, setNewExDate] = useState('');
  const [availOpen, setAvailOpen] = useState(true);
  const [daysOffOpen, setDaysOffOpen] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [shiftDays, setShiftDays] = useState(1);

  const bg = useBgTask();

  // ── Planner config (new) with legacy fallback ──
  const pc = data.plannerConfig;
  const courses = data.courses || [];
  const activeCourses = courses.filter(c => c.status !== 'completed');
  const totalEstHours = calcTotalEstHours(courses);
  const exceptionDates = safeArr(data.exceptionDates);
  const startDate = data.studyStartDate || todayStr();

  // Effective hours — from plannerConfig or legacy
  const hrsPerDay = pc ? getAvgHoursPerDay(pc) : (data.studyHoursPerDay || 4);
  const weeklyHours = pc ? getWeeklyHours(pc) : hrsPerDay * 7;
  const studyDaysPerWeek = pc ? getStudyDaysPerWeek(pc) : 7;

  // Derive study mode from university profile (or plannerConfig override)
  const effectiveStudyMode = pc?.studyMode || deriveStudyMode(data.universityProfile);
  const effectivePacing = pc?.pacingStyle || 'steady';
  const effectiveBlockStyle = pc?.blockStyle || 'standard';

  // Two-date system — keep separate for distinct buffer calculations
  const targetGoal = data.targetCompletionDate || null;  // personal goal
  const termEnd = data.targetDate || null;                // hard deadline
  const goalDate = targetGoal || termEnd || null;         // fallback for legacy paths
  const effectiveDaysLeft = goalDate ? Math.max(0, diffDays(todayStr(), goalDate)) : null;

  // Calculations — use availability-aware versions when plannerConfig exists
  const rawDaysNeeded = weeklyHours > 0 ? Math.ceil(totalEstHours / (weeklyHours / 7)) : 999;

  const estCompletionDate = pc
    ? calcEstCompletionWithAvailability(startDate, totalEstHours, pc, exceptionDates)
    : calcEstCompletion(startDate, rawDaysNeeded, exceptionDates);

  const minHrsPerDay = (() => {
    if (!goalDate || !startDate) return null;
    if (pc) return calcMinHrsWithAvailability(startDate, goalDate, totalEstHours, pc, exceptionDates);
    const availDays = calcStudyDays(startDate, goalDate, exceptionDates);
    return availDays > 0 ? Math.ceil((totalEstHours / availDays) * 10) / 10 : null;
  })();

  const totalAvailableHours = pc
    ? calcTotalAvailableHours(startDate, goalDate || estCompletionDate || startDate, pc, exceptionDates)
    : null;

  const feasible = minHrsPerDay == null || minHrsPerDay <= MAX_STUDY_HRS;

  // Enhanced feasibility metrics with two-date awareness
  const bufferHours = totalAvailableHours != null ? Math.round(totalAvailableHours - totalEstHours) : null;
  const bufferDays = bufferHours != null && hrsPerDay > 0 ? Math.round(bufferHours / hrsPerDay) : null;
  const utilizationPct = totalAvailableHours > 0 ? Math.round((totalEstHours / totalAvailableHours) * 100) : null;

  // Three distinct finish deltas
  const finishVsGoal = estCompletionDate && targetGoal ? diffDays(estCompletionDate, targetGoal) : null;
  const finishVsTerm = estCompletionDate && termEnd ? diffDays(estCompletionDate, termEnd) : null;
  const goalToTermGap = targetGoal && termEnd ? diffDays(targetGoal, termEnd) : null;
  const finishDelta = finishVsGoal ?? finishVsTerm ?? null;

  // Term-end buffer (total slack to hard deadline)
  const termAvailableHours = termEnd && pc ? calcTotalAvailableHours(startDate, termEnd, pc, exceptionDates) : null;
  const termBufferDays = termAvailableHours != null && hrsPerDay > 0 ? Math.round((termAvailableHours - totalEstHours) / hrsPerDay) : null;

  // School-model-aware buffer context
  const eduModel = data.universityProfile?.educationModel || '';
  const bufferContext = (() => {
    if (eduModel === 'competency-based' && bufferHours != null) {
      const avgHrsPerCourse = activeCourses.length > 0 ? totalEstHours / activeCourses.length : 50;
      const extraCourses = avgHrsPerCourse > 0 ? Math.floor(bufferHours / avgHrsPerCourse) : 0;
      if (bufferHours < 0) return { label: 'ACCELERATION', primary: `${Math.abs(bufferHours)}h`, sub: `${Math.abs(bufferHours)}h short \u2014 extend target or reduce courses` };
      return { label: 'ACCELERATION', primary: extraCourses > 0 ? `+${extraCourses}` : bufferDays != null ? `${bufferDays}d` : '\u2014',
        sub: extraCourses > 0 ? `${extraCourses} extra course${extraCourses > 1 ? 's' : ''} possible this term` : bufferDays != null && bufferDays > 0 ? `${bufferDays}d spare \u00B7 ${bufferHours}h free` : 'on pace' };
    }
    if (eduModel === 'credit-hour' && bufferHours != null) {
      const weeksLeft = goalDate ? Math.max(1, Math.ceil(diffDays(todayStr(), goalDate) / 7)) : 16;
      const weeklySlack = Math.round(bufferHours / weeksLeft * 10) / 10;
      return { label: 'WEEKLY SLACK', primary: weeklySlack > 0 ? `${weeklySlack}h` : utilizationPct != null ? `${utilizationPct}%` : '\u2014',
        sub: weeklySlack > 0 ? `${bufferHours}h buffer over ${weeksLeft} weeks` : 'time fully allocated' };
    }
    return { label: 'BUFFER', primary: utilizationPct != null ? `${utilizationPct}%` : '\u2014',
      sub: bufferDays != null && bufferDays > 0 ? `${bufferDays}d spare \u00B7 ${bufferHours}h free` : 'time fully allocated' };
  })();

  const feasibilityLevel = !feasible ? 'red' : (minHrsPerDay != null && minHrsPerDay > 6) || (utilizationPct != null && utilizationPct > 85) || (finishDelta != null && finishDelta < 3) ? 'yellow' : 'green';
  const feasibilityColor = { green: T.accent, yellow: T.orange, red: T.red }[feasibilityLevel];

  // Feasibility check for exception dates — use availability-aware calc when plannerConfig exists
  const localCalcMinHrsWithDates = (extraDates) => {
    if (pc) {
      return calcMinHrsWithAvailability(startDate, goalDate, totalEstHours, pc, [...exceptionDates, ...extraDates]);
    }
    return calcMinHrsWithDates(startDate, goalDate, totalEstHours, exceptionDates, extraDates);
  };

  // ── Exception dates management (unchanged logic) ──
  const addExDate = () => {
    if (!newExDate || exceptionDates.includes(newExDate)) return;
    const projected = localCalcMinHrsWithDates([newExDate]);
    if (projected !== null && projected > MAX_STUDY_HRS) {
      toast(`Warning: adding this day off requires ${projected}h/day`, 'warn');
    }
    setData(d => ({ ...d, exceptionDates: [...safeArr(d.exceptionDates), newExDate].sort() }));
    setNewExDate('');
  };
  const removeExDate = (dt) => setData(d => ({ ...d, exceptionDates: safeArr(d.exceptionDates).filter(x => x !== dt) }));

  const addRecurringDayOff = (dayIndices) => {
    const start = data.studyStartDate || todayStr();
    const end = data.targetCompletionDate || data.targetDate;
    if (!end) { toast('Set a target date first', 'warn'); return; }
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
    const projected = localCalcMinHrsWithDates(newDates);
    if (projected !== null && projected > MAX_STUDY_HRS) {
      toast(`Warning: adding ${newDates.length} days off requires ${projected}h/day`, 'warn');
    }
    setData(dd => ({ ...dd, exceptionDates: [...safeArr(dd.exceptionDates), ...newDates].sort() }));
    toast(`Added ${newDates.length} day${newDates.length > 1 ? 's' : ''} off`, 'success');
  };
  const clearRecurringDayOff = (dayIndices) => {
    setData(dd => ({ ...dd, exceptionDates: safeArr(dd.exceptionDates).filter(dt => !dayIndices.includes(new Date(dt + 'T12:00:00').getDay())) }));
    toast('Removed recurring days off', 'info');
  };

  // ── Planner config setters ──
  const setPc = (updates) => {
    setData(d => ({
      ...d,
      plannerConfig: { ...(d.plannerConfig || migrateToPlannerConfig(d)), ...updates },
    }));
  };

  const applyTemplate = (templateId) => {
    const tpl = LIFE_TEMPLATES[templateId];
    if (!tpl) return;
    setData(d => ({
      ...d,
      plannerConfig: {
        ...(d.plannerConfig || migrateToPlannerConfig(d)),
        weeklyAvailability: JSON.parse(JSON.stringify(tpl.weeklyAvailability)),
        commitments: JSON.parse(JSON.stringify(tpl.commitments.map(c => ({ ...c, id: uid() })))),
        lifeTemplate: templateId,
      },
    }));
    toast(`Applied: ${tpl.label}`, 'success');
  };

  // ── AI Activity (filtered: only show plan-related content on this page) ──
  const AIActivity = () => {
    // Filter: only show logs related to plan generation, not enrichment
    const isPlanActivity = isGenerating || bg.logs.some(l => (l.content || '').includes('Week') || (l.content || '').includes('plan') || (l.content || '').includes('generate_study'));
    const isEnrichmentOnly = bg.loading && !isGenerating && (bg.label || '').toLowerCase().includes('enrich');
    // Show a minimal enrichment-in-progress badge if enrichment is running elsewhere
    if (isEnrichmentOnly) return (
      <div style={{ padding: '8px 12px', borderRadius: 8, background: T.purpleD, border: `1px solid ${T.purple}22`, fontSize: fs(10), color: T.purple, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Ic.Spin s={12} />
        <span>Course enrichment in progress...</span>
        <button onClick={() => setPage('courses')} style={{ background: 'none', border: 'none', color: T.purple, cursor: 'pointer', fontSize: fs(10), textDecoration: 'underline', padding: 0 }}>View</button>
      </div>
    );
    if (!isPlanActivity && !bg.loading) return null;
    if (!bg.loading && bg.logs.length === 0) return null;
    return (
      <div style={{ background: T.panel, border: `1px solid ${T.purple}33`, borderRadius: 10, padding: 14, marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bg.streamText || bg.logs.length > 0 ? 8 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {bg.loading && <Ic.Spin s={14} />}
            <span style={{ fontSize: fs(12), fontWeight: 700, color: bg.loading ? T.purple : T.soft }}>{bg.loading ? (bg.label || 'Generating...') : 'Plan Generation'}</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {bg.loading && getBgState().abortCtrl && <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, label: '' }); toast('Cancelled', 'info'); }}>Cancel</Btn>}
            {!bg.loading && bg.logs.length > 0 && <Btn small v="ghost" onClick={() => bgSet({ logs: [] })}>Clear</Btn>}
          </div>
        </div>
        {bg.streamText && <div style={{ padding: '6px 10px', borderRadius: 7, background: T.purpleD, border: `1px solid ${T.purple}33`, fontSize: fs(11), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto', marginBottom: 4 }}>{bg.streamText}</div>}
        {bg.logs.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>{bg.logs.map((l, i) => <LogLine key={i} l={l} />)}</div>}
      </div>
    );
  };

  // ── Generate plan ──
  const genPlan = async () => {
    if (!profile) return;
    const active = courses.filter(c => c.status !== 'completed');
    if (!active.length) return;

    // Auto-save dates if not set
    if (!data.studyStartDate) setData(d => ({ ...d, studyStartDate: todayStr() }));
    if (!data.targetCompletionDate && !data.targetDate) {
      const derived = deriveTargetDate(data.universityProfile);
      setData(d => ({ ...d, targetCompletionDate: derived }));
    }

    // Pre-flight validation — warn but allow
    if (!feasible) toast('Warning: schedule is aggressive \u2014 consider adjusting dates or availability', 'warn');
    if (estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) toast('Warning: estimated finish is past your term end date', 'warn');
    if (hrsPerDay < 0.5) { toast('Not enough study hours configured', 'warn'); return; }

    const planId = `plan_${Date.now()}`;
    bgSet({ loading: true, logs: [{ type: 'user', content: 'Generating study plan in weekly chunks...' }], label: 'Generating study plan...' });

    const capturedTasks = [];
    const previewSetData = (fn) => {
      setData(d => {
        const next = typeof fn === 'function' ? fn(d) : fn;
        if (next.tasks) {
          for (const [dt, dayTasks] of Object.entries(next.tasks)) {
            const oldTasks = d.tasks?.[dt] || [];
            const newOnes = safeArr(dayTasks).filter(t => !oldTasks.some(o => o.id === t.id));
            // Stamp planId on task objects immutably
            for (const t of newOnes) {
              const idx = safeArr(next.tasks[dt]).findIndex(x => x.id === t.id);
              if (idx >= 0) next.tasks[dt][idx] = { ...next.tasks[dt][idx], planId };
              capturedTasks.push({ ...t, planId, date: dt });
            }
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
    const exDts = safeArr(data.exceptionDates);
    const userCtx = planPrompt.trim() ? `\nStudent preferences: ${planPrompt.trim()}` : '';

    const endDt = targetDt;
    const totalDays = endDt ? diffDays(startDt, endDt) : (Math.ceil(totalEstHours / hrsPerDay) + 7);
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

    // Build study mode prompt
    const modePrompt = effectiveStudyMode === 'parallel'
      ? `PARALLEL MODE: The student takes multiple courses simultaneously. Distribute study blocks across ${pc?.parallelCourseLimit || 2}-3 active courses per day. Balance hours proportional to each course's difficulty and remaining hours. Each day can have multiple courses.`
      : effectiveStudyMode === 'hybrid'
      ? `HYBRID INTERLEAVING MODE:\n- Allocate 65% of daily hours to the PRIMARY course (course #1 that isn't complete).\n- Allocate 25% to a SECONDARY course (course #2 \u2014 preview upcoming material).\n- Allocate 10% to REVIEW of previously completed material.\n- When the primary course is within 2 days of its exam, switch to 100% focus.`
      : `SEQUENTIAL RULE (CRITICAL):\n- Study ONE course at a time. Do NOT mix courses on the same day.\n- Fully schedule all hours for course #1 first. Only move to course #2 after course #1's hours are exhausted.\n- Exception: the transition day where course #1 finishes can have course #2 start after.`;

    // Build pacing prompt
    const pacingPrompt = effectivePacing === 'wave'
      ? 'PACING: Wave \u2014 alternate between heavy days (full hours) and light days (60% hours, review-only). Every 5th study day is a light review day.'
      : effectivePacing === 'sprint-rest'
      ? 'PACING: Sprint/Rest \u2014 4 intense study days at full hours, then 1 light day (50% hours, review only). Repeat this 4:1 rhythm.'
      : 'PACING: Steady \u2014 consistent hours each study day.';

    // Build block style prompt
    const blockPrompt = effectiveBlockStyle === 'pomodoro'
      ? 'BLOCK STYLE: Pomodoro \u2014 create 25-minute focused tasks with 5-minute break tasks between each. Group into 2-hour sessions (4 pomodoros + 15 min long break). Each task title must be specific enough to start immediately.'
      : effectiveBlockStyle === 'sprint'
      ? 'BLOCK STYLE: Sprint \u2014 create 50-minute study blocks with 10-minute breaks. Fewer transitions, longer sustained focus.'
      : 'BLOCK STYLE: Standard \u2014 1-2.5h study blocks with 10-15 min breaks between blocks. Include a 30-60 min meal/rest break if 4+ hours in one day.';

    // Build availability prompt
    const derivedStart = pc ? deriveStartTime(pc) : (data.studyStartTime || '08:00');
    const availPrompt = pc ? buildAvailabilityPrompt(pc) : `Uniform schedule: ${hrsPerDay}h/day, start at ${derivedStart}.`;

    let hoursAssigned = 0;
    let weekContinuity = ''; // Inter-week context for AI continuity

    // FSRS-based review schedule: compute optimal review dates for completed topics
    const fsrsReviewPrompt = (() => {
      // Use FSRS interval math: initial stability for "Good" = w[2], target retention = 90%
      const DECAY = -0.5;
      const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
      const initStab = DEFAULT_W[2]; // 2.4 days for Good rating
      const calcInterval = (stability) => {
        const interval = (stability / FACTOR) * (Math.pow(DEFAULT_REQUEST_RETENTION, 1 / DECAY) - 1);
        return Math.min(Math.max(Math.round(interval), 1), 365);
      };
      // Scan completed study tasks from previous plans to find review-worthy topics
      const completedTopics = {};
      const today = todayStr();
      for (const [dt, dayTasks] of Object.entries(data.tasks || {})) {
        if (dt > today) continue;
        for (const t of safeArr(dayTasks)) {
          if (!t.done || !t.planId || t.category === 'break') continue;
          const topic = t.title?.split(/\s*[\u2014\-]\s*/)[0]?.trim();
          if (!topic) continue;
          if (!completedTopics[topic] || dt > completedTopics[topic].lastDate) {
            completedTopics[topic] = { lastDate: dt, count: (completedTopics[topic]?.count || 0) + 1 };
          }
        }
      }
      const reviews = [];
      for (const [topic, info] of Object.entries(completedTopics)) {
        // Compute stability: initial * (1.5 per successful review assumed)
        const stability = initStab * Math.pow(1.5, Math.min(info.count - 1, 5));
        const interval = calcInterval(stability);
        const lastD = new Date(info.lastDate + 'T12:00:00');
        const dueD = new Date(lastD); dueD.setDate(dueD.getDate() + interval);
        const dueStr = dueD.toISOString().split('T')[0];
        if (dueStr >= startDt && dueStr <= (endDt || '2099-01-01')) {
          reviews.push({ topic, dueDate: dueStr, interval });
        }
      }
      if (reviews.length === 0) return '';
      const reviewLines = reviews.slice(0, 15).map(r => `  - ${r.topic}: review due ${r.dueDate} (${r.interval}d interval)`);
      return `\nSPACED REVIEW SCHEDULE (from FSRS algorithm — prioritize these):\n${reviewLines.join('\n')}\nSchedule 15-30 min review sessions for topics that fall due this week. Tag as "review" category.\n`;
    })();

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
      bgLog({ type: 'user', content: `\uD83D\uDCC5 Week ${week + 1}/${totalWeeks}: ${ws} \u2192 ${we}` });

      const weekExDts = exDts.filter(d => d >= ws && d <= we);
      const hoursRemaining = totalEstHours - hoursAssigned;
      if (hoursRemaining <= 0) { bgLog({ type: 'text', content: 'All course hours assigned \u2014 done!' }); break; }

      // Build per-day availability for this week
      let weekAvailStr = '';
      if (pc) {
        const dayLines = [];
        for (let i = 0; i < 7; i++) {
          const dt = new Date(weekStart);
          dt.setDate(dt.getDate() + i);
          const ds = dt.toISOString().split('T')[0];
          const dow = dt.getDay();
          if (weekExDts.includes(ds)) {
            dayLines.push(`${ds} (${DAY_NAMES[dow]}): OFF (exception date)`);
          } else {
            const hrs = getEffectiveHours(pc, dow);
            if (hrs <= 0) {
              dayLines.push(`${ds} (${DAY_NAMES[dow]}): OFF`);
            } else {
              const day = pc.weeklyAvailability[dow];
              const windowStr = day?.windows?.map(w => `${w.start}-${w.end}`).join(', ') || '';
              dayLines.push(`${ds} (${DAY_NAMES[dow]}): ${windowStr} (${hrs}h available)`);
            }
          }
        }
        weekAvailStr = `\nTHIS WEEK'S AVAILABILITY:\n${dayLines.join('\n')}`;
      }

      const sys = buildSystemPrompt(data, `Use generate_study_plan to create tasks for ONLY ${ws} through ${we} (7 days). Do NOT use add_tasks. Do NOT plan outside this date range.`);

      const weekMsg = `Generate study tasks for WEEK ${week + 1} ONLY: ${ws} to ${we}.

COURSES (PRIORITY ORDER):
${courseDetails}

PROGRESS: ~${Math.round(hoursAssigned)}h already scheduled of ~${totalEstHours}h total. ~${Math.round(hoursRemaining)}h remaining.
${weekExDts.length > 0 ? `Exception dates this week: ${weekExDts.join(', ')}` : 'No days off this week'}
${week === 0 ? `First day starts at ${derivedStart}` : ''}

${modePrompt}

${pacingPrompt}

${blockPrompt}

${availPrompt}${weekAvailStr}

PROGRESS CONTEXT: ${Math.round(hoursAssigned)}h of ${totalEstHours}h assigned so far.
${weekContinuity || 'This is the first week — start with course #1.'}

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
- Title format: "CourseCode \u2014 Specific Topic" (e.g., "D415 \u2014 SDN Architecture: Three Layers").
- For PA courses, schedule "project" category tasks for writing/research.
- Each task needs date (YYYY-MM-DD), time, endTime (24h format).
- ~${Math.min(Math.round(weeklyHours), Math.round(hoursRemaining))}h this week.

PRE-ASSESSMENT FOCUS:
If a course has pre-assessment scores and weak areas listed, allocate 60-70% of that course's study hours to the weak areas. For topics the student already passed, schedule only brief review (30-60 min) rather than full study sessions.

EXAM PREP RAMP (apply to EVERY course):
- At ~80% of estimated hours: transition from "study" to "review" category. Focus on retrieval practice.
- At ~90% of estimated hours: switch to "exam-prep" category. Schedule 1-2 practice exam simulations.
- Day BEFORE the exam: schedule only 1-2 hours of LIGHT review. Title: "CourseCode \u2014 Pre-Exam Light Review". Rest of the day should be free.
- Exam day: schedule the "exam-day" task. Title: "CourseCode \u2014 \uD83C\uDFAF OA Exam" or "CourseCode \u2014 \uD83C\uDFAF Submit PA".
- MINIMUM 2 study days between finishing new material and the exam day.

POST-EXAM RECOVERY:
After an "exam-day" task, the NEXT calendar day should be a light day (1-2h max). Schedule orientation/preview for the next course only. Do NOT schedule full study load the day after an exam.

ENERGY-AWARE BLOCK ORDER (cognitive load optimization):
- MORNING sessions (before 12:00): Schedule the HARDEST new material first. Cognitive resources are highest early. Start with a 15-min warm-up review, then tackle difficult topics.
- AFTERNOON sessions (12:00-17:00): Schedule moderate-difficulty material. Good for practice problems, structured exercises, and project work.
- EVENING sessions (after 17:00): Schedule EASIER material — light review, practice problems, or preview of tomorrow's topic. Working adults studying after a full workday have reduced cognitive capacity; respect this by assigning lighter material.
- WEEKEND sessions: Can follow the morning pattern (hard first) since energy is typically higher without a preceding workday.
- FIRST block of ANY session: always start with a brief warm-up (10-15 min review of previous material).
- LAST block of ANY session: end with easier material or a brief preview of the next topic.

STUDY TECHNIQUE GUIDANCE (include in task notes field):
- For "study" tasks: include a note like "Active study: After reading, close materials and summarize from memory."
- For "review" tasks: include "Retrieval practice: WITHOUT looking at notes, write everything you know. Then check gaps."
- For "exam-prep" tasks: include "Test simulation: Complete practice problems under timed conditions."

SPACED REVIEW:
Allocate ~10% of weekly hours to reviewing previously completed topics. Tag these as "review" category. Even when studying a new course, include brief reviews of prior courses.
${fsrsReviewPrompt}${userCtx}`;

      try {
        const { logs: wLogs } = await runAILoop(profile, sys, [{ role: 'user', content: weekMsg }], data, previewSetData, executeTools);
        for (const l of wLogs) bgLog(l);
        const weekTasks = capturedTasks.filter(t => t.date >= ws && t.date <= we);

        // Post-generation validation: filter out invalid tasks
        const validTasks = [];
        for (const t of weekTasks) {
          const issues = [];
          if (!t.date || t.date < ws || t.date > we) issues.push('date out of range');
          if (!t.title || t.title.trim().length === 0) issues.push('empty title');
          if (t.time && t.endTime && pc) {
            const dow = new Date(t.date + 'T12:00:00').getDay();
            const day = pc.weeklyAvailability?.[dow];
            if (day && !day.available) issues.push('scheduled on unavailable day');
          }
          if (issues.length > 0) {
            bgLog({ type: 'error', content: `Skipped invalid task: "${t.title || '(empty)'}" - ${issues.join(', ')}` });
          } else {
            validTasks.push(t);
          }
        }

        const weekHrs = validTasks.reduce((s, t) => {
          const st = parseTime(t.time), et = parseTime(t.endTime);
          return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0);
        }, 0);
        hoursAssigned += weekHrs;

        // Build inter-week continuity for next iteration
        const courseHrsThisWeek = {};
        for (const t of validTasks) {
          const name = t.title?.split(/\s*[\u2014\-]\s*/)[0]?.trim() || 'Other';
          const st = parseTime(t.time), et = parseTime(t.endTime);
          const hrs = st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0;
          courseHrsThisWeek[name] = (courseHrsThisWeek[name] || 0) + hrs;
        }
        const lines = Object.entries(courseHrsThisWeek).map(([name, hrs]) => `  ${name}: ${Math.round(hrs)}h this week`);
        weekContinuity = `Last week assigned:\n${lines.join('\n')}\nCumulative: ${Math.round(hoursAssigned)}h of ${totalEstHours}h total. Continue from where the previous week left off.`;

        bgLog({ type: 'text', content: `Week ${week + 1}: ${validTasks.length} tasks, ~${Math.round(weekHrs)}h (total: ~${Math.round(hoursAssigned)}h/${totalEstHours}h)` });
      } catch (e) {
        bgLog({ type: 'error', content: `Week ${week + 1} failed: ${e.message}` });
      }
    }

    bgSet({ loading: false, regenId: null, label: '' });
    if (capturedTasks.length > 0) {
      // Save plan record
      setData(d => ({
        ...d,
        planHistory: [...(d.planHistory || []), {
          planId,
          createdAt: new Date().toISOString(),
          snapshot: { studyMode: effectiveStudyMode, pacingStyle: effectivePacing, blockStyle: effectiveBlockStyle, hrsPerDay, startDate: startDt, targetDate: targetDt, courseCount: activeCourses.length, totalEstHours },
          plannedHours: Math.round(hoursAssigned),
          taskCount: capturedTasks.length,
        }],
      }));
      setPendingPlan({ planId, tasks: capturedTasks, summary: `${capturedTasks.length} tasks across ${[...new Set(capturedTasks.map(t => t.date))].length} days (~${Math.round(hoursAssigned)}h scheduled)` });
      toast(`Plan generated \u2014 review ${capturedTasks.length} tasks before confirming`, 'info');
    } else {
      toast('No tasks were generated \u2014 try adjusting your prompt or checking your AI connection', 'warn');
    }
  };

  const confirmPlan = () => {
    if (!pendingPlan) return;
    setPendingPlan(null);
    setShowPostConfirm(true);
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

  // ── Derived state ──
  const unenrichedCount = activeCourses.filter(c => !hasCtx(c)).length;
  const needsHoursCount = courses.filter(c => c.status !== 'completed' && (!c.averageStudyHours || c.averageStudyHours <= 0)).length;
  const hasSettings = !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
  const isFirstRun = courses.length > 0 && !hasSettings;
  const lastPlan = (data.planHistory || []).slice(-1)[0] || null;
  const hasPlan = !!lastPlan && !pendingPlan;

  // Auto-derived dates for first-run
  const autoStart = data.studyStartDate || todayStr();
  const autoTarget = data.targetCompletionDate || data.targetDate || deriveTargetDate(data.universityProfile);

  const isBusy = bg.loading && !(bg.label || '').toLowerCase().includes('plan');
  const isGenerating = bg.loading && (bg.label || '').toLowerCase().includes('plan');

  // ── Stat color helper ──
  const finishColor = estCompletionDate && termEnd && estCompletionDate > termEnd ? T.red
    : estCompletionDate && goalDate && estCompletionDate > goalDate ? T.orange : T.accent;

  // ── Cockpit: plan progress computation (memoized) ──
  const planProgress = useMemo(() => {
    if (!lastPlan) return null;
    const activePlanId = lastPlan.planId;
    const today = todayStr();
    let totalTasks = 0, doneTasks = 0, totalMins = 0, doneMins = 0;
    let todayPlanned = 0, todayDone = 0, weekPlanned = 0, weekDone = 0;
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekStartStr = weekStart.toISOString().split('T')[0];
    let streak = 0, onTime = 0, skipped = 0;

    // Compute streak — consecutive days with at least one plan task done
    const allDates = Object.keys(data.tasks || {}).filter(d => d <= today).sort().reverse();
    let streakBroken = false;
    for (const dt of allDates) {
      const dayPlanTasks = safeArr(data.tasks[dt]).filter(t => t.planId === activePlanId);
      if (dayPlanTasks.length === 0) continue;
      if (dayPlanTasks.some(t => t.done)) { if (!streakBroken) streak++; }
      else { streakBroken = true; }
    }

    for (const [dt, dayTasks] of Object.entries(data.tasks || {})) {
      for (const t of safeArr(dayTasks)) {
        if (t.planId !== activePlanId) continue;
        const st = parseTime(t.time), et = parseTime(t.endTime);
        const mins = st && et ? Math.max(0, (et.mins - st.mins)) : 0;
        totalTasks++; totalMins += mins;
        if (t.done) { doneTasks++; doneMins += mins; }
        if (dt === today) { todayPlanned += mins; if (t.done) todayDone += mins; }
        if (dt >= weekStartStr && dt <= today) { weekPlanned += mins; if (t.done) weekDone += mins; }
        if (dt <= today) { if (t.done) onTime++; else if (dt < today) skipped++; }
      }
    }

    const pct = totalMins > 0 ? Math.round((doneMins / totalMins) * 100) : 0;
    const totalHrs = Math.round(totalMins / 60 * 10) / 10;
    const doneHrs = Math.round(doneMins / 60 * 10) / 10;
    const remainHrs = Math.round((totalMins - doneMins) / 60 * 10) / 10;
    const weekPlannedHrs = Math.round(weekPlanned / 60 * 10) / 10;
    const weekDoneHrs = Math.round(weekDone / 60 * 10) / 10;
    const weekDrift = Math.round((weekDone - weekPlanned) / 60 * 10) / 10;
    const behindMins = weekPlanned - weekDone;
    const daysLeftInWeek = Math.max(1, 7 - new Date().getDay());
    const catchUpPerDay = behindMins > 0 ? Math.round(behindMins / daysLeftInWeek) : 0;
    const adherenceTotal = onTime + skipped;
    const completionRate = adherenceTotal > 0 ? Math.round((onTime / adherenceTotal) * 100) : 100;

    return { totalTasks, doneTasks, totalMins, doneMins, pct, totalHrs, doneHrs, remainHrs,
      weekPlannedHrs, weekDoneHrs, weekDrift, behindMins, daysLeftInWeek, catchUpPerDay,
      onTime, skipped, completionRate, streak, todayPlanned, todayDone,
      todayPlannedHrs: Math.round(todayPlanned / 60 * 10) / 10,
      todayDoneHrs: Math.round(todayDone / 60 * 10) / 10 };
  }, [data.tasks, data.planHistory]);

  // ── Cockpit: next upcoming tasks ──
  const nextUpTasks = useMemo(() => {
    if (!lastPlan) return [];
    const today = todayStr();
    const upcoming = [];
    const sortedDates = Object.keys(data.tasks || {}).filter(d => d >= today).sort();
    for (const dt of sortedDates) {
      for (const t of safeArr(data.tasks[dt])) {
        if (t.planId === lastPlan.planId && !t.done) upcoming.push({ ...t, date: dt });
      }
      if (upcoming.length >= 5) break;
    }
    return upcoming;
  }, [data.tasks, data.planHistory]);

  // ── Cockpit: plan timeline data (course blocks across weeks) ──
  const planTimeline = useMemo(() => {
    if (!lastPlan) return null;
    const courseMap = {};
    const sortedDates = Object.keys(data.tasks || {}).sort();
    for (const dt of sortedDates) {
      for (const t of safeArr(data.tasks[dt])) {
        if (t.planId !== lastPlan.planId) continue;
        const name = t.title?.split(/\s*[\u2014\-]\s*/)[0]?.trim() || 'Other';
        if (!courseMap[name]) courseMap[name] = { name, startDate: dt, endDate: dt, totalMins: 0, doneMins: 0, tasks: 0 };
        courseMap[name].endDate = dt;
        courseMap[name].tasks++;
        const st = parseTime(t.time), et = parseTime(t.endTime);
        const mins = st && et ? Math.max(0, et.mins - st.mins) : 0;
        courseMap[name].totalMins += mins;
        if (t.done) courseMap[name].doneMins += mins;
      }
    }
    const blocks = Object.values(courseMap);
    if (blocks.length === 0) return null;
    const minDate = blocks.reduce((m, b) => b.startDate < m ? b.startDate : m, blocks[0].startDate);
    const maxDate = blocks.reduce((m, b) => b.endDate > m ? b.endDate : m, blocks[0].endDate);
    const totalSpan = Math.max(1, diffDays(minDate, maxDate));
    return { blocks, minDate, maxDate, totalSpan };
  }, [data.tasks, data.planHistory]);

  // ── Quick actions ──
  const missedToday = () => {
    const today = todayStr();
    const todayTasks = safeArr(data.tasks?.[today]).filter(t => t.planId && !t.done);
    if (todayTasks.length === 0) { toast('No incomplete plan tasks today', 'info'); return; }
    // Redistribute to remaining days this week
    const futureDates = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      const dow = d.getDay();
      if (pc && !pc.weeklyAvailability?.[dow]?.available) continue;
      if (safeArr(data.exceptionDates).includes(ds)) continue;
      futureDates.push(ds);
    }
    if (futureDates.length === 0) { toast('No available days to reschedule to', 'warn'); return; }
    setData(d => {
      const tasks = { ...d.tasks };
      const todayList = [...safeArr(tasks[today])];
      const toMove = todayList.filter(t => t.planId && !t.done);
      tasks[today] = todayList.filter(t => !t.planId || t.done);
      toMove.forEach((t, i) => {
        const targetDate = futureDates[i % futureDates.length];
        tasks[targetDate] = [...safeArr(tasks[targetDate]), { ...t, id: uid() }];
      });
      return { ...d, tasks };
    });
    toast(`Moved ${todayTasks.length} task${todayTasks.length > 1 ? 's' : ''} to later this week`, 'success');
  };

  const shiftRemainingTasks = () => {
    const today = todayStr();
    let moved = 0;
    setData(d => {
      const tasks = {};
      for (const [dt, dayTasks] of Object.entries(d.tasks || {})) {
        if (dt <= today) { tasks[dt] = dayTasks; continue; }
        const shifted = new Date(dt + 'T12:00:00');
        shifted.setDate(shifted.getDate() + shiftDays);
        const newDt = shifted.toISOString().split('T')[0];
        tasks[newDt] = [...safeArr(tasks[newDt]), ...safeArr(dayTasks)];
        moved += safeArr(dayTasks).length;
      }
      return { ...d, tasks };
    });
    toast(`Shifted ${moved} future tasks forward by ${shiftDays} day${shiftDays > 1 ? 's' : ''}`, 'success');
  };

  const replanFromToday = () => {
    const today = todayStr();
    // Clear future plan tasks, keep completed and non-plan tasks
    setData(d => {
      const tasks = {};
      for (const [dt, dayTasks] of Object.entries(d.tasks || {})) {
        if (dt < today) { tasks[dt] = dayTasks; continue; }
        const kept = safeArr(dayTasks).filter(t => !t.planId || t.done);
        if (kept.length > 0) tasks[dt] = kept;
      }
      return { ...d, tasks, studyStartDate: today };
    });
    toast('Cleared future plan tasks. Generating new plan from today...', 'info');
    requestAnimationFrame(() => requestAnimationFrame(() => genPlan()));
  };

  const exportToCalendar = () => {
    downloadICS(data.tasks, `vorra-study-plan-${todayStr()}.ics`, {
      calName: 'Vorra Study Plan',
      dateRange: { start: todayStr(), end: goalDate || '' },
      excludeCategories: ['break'],
    });
    toast('Calendar file exported! Import it into Google Calendar, Outlook, or Apple Calendar.', 'success');
  };

  return (
    <div className="fade">
      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => setPage('dashboard')} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: T.soft, fontSize: fs(12), fontWeight: 600 }}>{'\u2190'}</button>
          <div>
            <h1 style={{ fontSize: fs(22), fontWeight: 800, margin: 0, lineHeight: 1.2 }}>Study Planner</h1>
            <p style={{ color: T.dim, fontSize: fs(12), margin: 0 }}>{activeCourses.length} active course{activeCourses.length !== 1 ? 's' : ''} {'\u00B7'} {totalEstHours}h estimated</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {hasPlan && !showSettings && (
            <Btn small v="ghost" onClick={() => setShowSettings(true)}>{'\u2699'} Edit Schedule</Btn>
          )}
          {showSettings && hasPlan && (
            <Btn small v="ghost" onClick={() => setShowSettings(false)}>{'\u2190'} Back to Plan</Btn>
          )}
          {hasSettings && (
            <>
              <Badge color={T.accent} bg={T.accentD}>
                {new Date(startDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' \u2192 '}
                {goalDate ? new Date(goalDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}
              </Badge>
              <Badge color={T.blue} bg={T.blueD}>{Math.round(weeklyHours)}h/wk</Badge>
            </>
          )}
        </div>
      </div>

      {/* ─── CROSS-LINKING CTAs ─── */}
      {courses.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 16 }}>
          <div style={{ fontSize: fs(14), color: T.dim, marginBottom: 12 }}>No courses imported yet.</div>
          <Btn v="ai" onClick={() => setPage('courses')}>First, import your courses {'\u2192'}</Btn>
        </div>
      )}
      {courses.length > 0 && unenrichedCount > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{unenrichedCount} course{unenrichedCount > 1 ? 's' : ''} need enrichment for better plan quality.</span>
          <Btn small v="ghost" onClick={() => setPage('courses')} style={{ color: T.orange, borderColor: T.orange + '55' }}>Enrich courses {'\u2192'}</Btn>
        </div>
      )}
      {courses.length > 0 && needsHoursCount > 0 && unenrichedCount === 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{needsHoursCount} course{needsHoursCount > 1 ? 's' : ''} need enrichment for accurate hour estimates.</span>
          <Btn small v="ghost" onClick={() => setPage('courses')} style={{ color: T.orange, borderColor: T.orange + '55' }}>Enrich courses {'\u2192'}</Btn>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══ COCKPIT MODE — shown when plan exists and not editing ═══ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {hasPlan && !showSettings && !isGenerating && courses.length > 0 && (() => {
        const pp = planProgress;
        if (!pp || pp.totalTasks === 0) return null;
        return (
          <>
            {/* ── Plan Progress (promoted to top) ── */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text }}>Your Study Plan</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {pp.streak > 0 && <Badge color={T.accent} bg={T.accentD}>{'\uD83D\uDD25'} {pp.streak} day streak</Badge>}
                  <span style={{ fontSize: fs(10), color: T.dim }}>since {new Date(lastPlan.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>

              {/* Overall progress bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fs(11), color: T.dim, marginBottom: 4 }}>
                  <span>{pp.doneHrs}h / {pp.totalHrs}h completed</span>
                  <span style={{ fontWeight: 700, color: pp.pct >= 80 ? T.accent : T.text }}>{pp.pct}%</span>
                </div>
                <div style={{ height: 10, borderRadius: 5, background: T.input, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pp.pct}%`, borderRadius: 5, background: `linear-gradient(90deg, ${T.accent}, ${T.blue})`, transition: 'width 0.6s cubic-bezier(.4,0,.2,1)' }} />
                </div>
                <div style={{ fontSize: fs(10), color: T.soft, marginTop: 4 }}>
                  {pp.doneTasks}/{pp.totalTasks} tasks {'\u00B7'} {pp.remainHrs}h remaining
                </div>
              </div>

              {/* This week + Today */}
              <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                <div style={{ flex: 1, padding: '10px 14px', background: T.input, borderRadius: 10 }}>
                  <div style={{ fontSize: fs(10), color: T.dim, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>This Week</div>
                  <div style={{ fontSize: fs(16), fontWeight: 700, color: pp.weekDrift >= 0 ? T.accent : T.orange }}>{pp.weekDoneHrs}h / {pp.weekPlannedHrs}h</div>
                  <div style={{ fontSize: fs(11), color: pp.weekDrift >= 0 ? T.accent : T.orange }}>
                    {pp.weekDrift > 0 ? `${pp.weekDrift}h ahead` : pp.weekDrift === 0 ? 'On track' : `${Math.abs(pp.weekDrift)}h to go`}
                  </div>
                </div>
                <div style={{ flex: 1, padding: '10px 14px', background: T.input, borderRadius: 10 }}>
                  <div style={{ fontSize: fs(10), color: T.dim, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Today</div>
                  <div style={{ fontSize: fs(16), fontWeight: 700, color: T.text }}>{pp.todayDoneHrs}h / {pp.todayPlannedHrs}h</div>
                  <div style={{ fontSize: fs(11), color: T.dim }}>
                    {pp.todayPlanned === 0 ? 'Rest day' : pp.todayDone >= pp.todayPlanned ? 'All done!' : `${Math.round((pp.todayPlanned - pp.todayDone) / 60 * 10) / 10}h left`}
                  </div>
                </div>
                <div style={{ flex: 1, padding: '10px 14px', background: T.input, borderRadius: 10 }}>
                  <div style={{ fontSize: fs(10), color: T.dim, fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Completion</div>
                  <div style={{ fontSize: fs(16), fontWeight: 700, color: pp.completionRate >= 80 ? T.accent : pp.completionRate >= 60 ? T.orange : T.red }}>{pp.completionRate}%</div>
                  <div style={{ fontSize: fs(11), color: T.dim }}>{pp.onTime} done {'\u00B7'} {pp.skipped} missed</div>
                </div>
              </div>

              {/* Compassionate nudge */}
              {pp.behindMins > 30 && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>You{'\u2019'}ve completed {pp.weekDoneHrs}h this week. {Math.round(pp.behindMins / 60 * 10) / 10}h left to hit your target {'\u2014'} that{'\u2019'}s about {pp.catchUpPerDay > 60 ? `${Math.round(pp.catchUpPerDay / 60 * 10) / 10}h` : `${pp.catchUpPerDay}min`}/day for the next {pp.daysLeftInWeek} day{pp.daysLeftInWeek > 1 ? 's' : ''}.</span>
                </div>
              )}
              {pp.weekDrift > 0 && (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: T.accentD, border: `1px solid ${T.accent}33`, fontSize: fs(11), color: T.accent }}>
                  {'\u2705'} You{'\u2019'}re {pp.weekDrift}h ahead this week. Great momentum!
                </div>
              )}
            </div>

            {/* ── Quick Actions ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <Btn small v="secondary" onClick={missedToday}>{'\u23E9'} I missed today</Btn>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Btn small v="secondary" onClick={shiftRemainingTasks}>{'\u21B7'} Shift remaining +{shiftDays}d</Btn>
                <select value={shiftDays} onChange={e => setShiftDays(Number(e.target.value))} style={{ padding: '4px 6px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text, fontSize: fs(10) }}>
                  {[1, 2, 3, 5, 7].map(d => <option key={d} value={d}>{d}d</option>)}
                </select>
              </div>
              <Btn small v="secondary" onClick={() => setShowSettings(true)}>{'\u2699'} Adjust Schedule</Btn>
              <Btn small v="secondary" onClick={replanFromToday}>{'\u21BB'} Replan from today</Btn>
              <Btn small v="secondary" onClick={exportToCalendar}>{'\uD83D\uDCC5'} Export to Calendar</Btn>
              <Btn small v="ghost" onClick={() => { setShowSettings(true); requestAnimationFrame(() => requestAnimationFrame(() => genPlan())); }}>Regenerate Plan</Btn>
            </div>

            {/* ── Plan Timeline (Gantt-style course blocks) ── */}
            {planTimeline && (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 10 }}>Course Timeline</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {planTimeline.blocks.map((b, i) => {
                    const startOffset = diffDays(planTimeline.minDate, b.startDate);
                    const blockSpan = Math.max(1, diffDays(b.startDate, b.endDate));
                    const leftPct = (startOffset / planTimeline.totalSpan) * 100;
                    const widthPct = Math.max(3, (blockSpan / planTimeline.totalSpan) * 100);
                    const donePct = b.totalMins > 0 ? Math.round((b.doneMins / b.totalMins) * 100) : 0;
                    const colors = [T.accent, T.blue, T.purple, T.orange, T.red];
                    const color = colors[i % colors.length];
                    return (
                      <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28 }}>
                        <div style={{ width: 100, fontSize: fs(10), color: T.soft, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{b.name}</div>
                        <div style={{ flex: 1, position: 'relative', height: 20, background: T.input, borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`, height: '100%', background: `${color}33`, borderRadius: 4, border: `1px solid ${color}55` }}>
                            <div style={{ height: '100%', width: `${donePct}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
                          </div>
                        </div>
                        <div style={{ width: 50, fontSize: fs(9), color: T.dim, textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{Math.round(b.totalMins / 60)}h</div>
                      </div>
                    );
                  })}
                </div>
                {/* Date axis */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingLeft: 108 }}>
                  <span style={{ fontSize: fs(9), color: T.dim }}>{new Date(planTimeline.minDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <span style={{ fontSize: fs(9), color: T.dim }}>{new Date(planTimeline.maxDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                </div>
              </div>
            )}

            {/* ── Next Up ── */}
            {nextUpTasks.length > 0 && (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>Next Up</div>
                  <Btn small v="ghost" onClick={() => setPage('daily')}>View today {'\u2192'}</Btn>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {nextUpTasks.map((t, i) => (
                    <div key={i} onClick={() => { setData(d => d); setPage('daily'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: i === 0 ? T.accentD : T.input, cursor: 'pointer', border: i === 0 ? `1px solid ${T.accent}33` : '1px solid transparent' }}>
                      <span style={{ fontSize: fs(9), color: T.dim, minWidth: 60, fontFamily: "'JetBrains Mono',monospace" }}>{t.date === todayStr() ? 'Today' : new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span style={{ fontSize: fs(10), color: T.blue, minWidth: 40, fontFamily: "'JetBrains Mono',monospace" }}>{t.time || ''}</span>
                      <span style={{ flex: 1, fontSize: fs(11), color: i === 0 ? T.accent : T.text, fontWeight: i === 0 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      {t.endTime && <span style={{ fontSize: fs(9), color: T.dim }}>{'\u2192'} {t.endTime}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Feasibility summary sentence */}
            {hasSettings && (
              <div style={{ padding: '8px 14px', borderRadius: 10, background: `${feasibilityColor}11`, border: `1px solid ${feasibilityColor}33`, fontSize: fs(11), color: feasibilityColor, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: fs(14) }}>{feasibilityLevel === 'green' ? '\u2705' : feasibilityLevel === 'yellow' ? '\u26A0\uFE0F' : '\u274C'}</span>
                <span>
                  {feasibilityLevel === 'green'
                    ? `On track ${'\u2014'} ${totalEstHours}h across ${activeCourses.length} course${activeCourses.length !== 1 ? 's' : ''}${finishVsGoal != null && finishVsGoal > 0 ? `, finishing ${finishVsGoal}d early` : ''}${bufferDays != null && bufferDays > 0 ? ` with ${bufferDays}d extra time` : ''}.`
                    : feasibilityLevel === 'yellow'
                      ? `Tight schedule ${'\u2014'} ${minHrsPerDay}h/day needed${utilizationPct != null ? ` (${utilizationPct}% of your time)` : ''}. Consider extending your target or adjusting availability.`
                      : `Won${'\u2019'}t fit ${'\u2014'} ${minHrsPerDay != null ? `${minHrsPerDay}h/day needed` : 'no study days available'}. Extend your target date, add study hours, or remove days off.`
                  }
                </span>
              </div>
            )}
          </>
        );
      })()}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══ SETUP / EDIT MODE — first run, editing, or generating ═══ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {((!hasPlan || showSettings || pendingPlan || isGenerating) && courses.length > 0) && (
        <>
          {/* ── Simplified first-run wizard ── */}
          {!hasPlan && !showAdvanced && !pendingPlan && !isGenerating && (
            <div style={{ background: T.card, border: `1px solid ${T.accent}33`, borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
              <div style={{ fontSize: fs(15), fontWeight: 700, color: T.text, marginBottom: 4 }}>
                {activeCourses.length} course{activeCourses.length !== 1 ? 's' : ''}, ~{totalEstHours}h total. Let{'\u2019'}s build your study plan.
              </div>
              <div style={{ fontSize: fs(11), color: T.dim, marginBottom: 16 }}>Pick your situation, set a deadline, and we{'\u2019'}ll generate a personalized schedule.</div>

              {/* Template cards */}
              <Label>What does your week look like?</Label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginBottom: 16 }}>
                {LIFE_TEMPLATE_IDS.slice(0, 6).map(id => {
                  const tpl = LIFE_TEMPLATES[id];
                  const isActive = pc?.lifeTemplate === id;
                  return (
                    <button key={id} onClick={() => applyTemplate(id)}
                      style={{ padding: '12px 14px', borderRadius: 10, border: `2px solid ${isActive ? T.accent : T.border}`, background: isActive ? T.accentD : T.input, cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                      <div style={{ fontSize: fs(16), marginBottom: 4 }}>{tpl.icon}</div>
                      <div style={{ fontSize: fs(12), fontWeight: 700, color: isActive ? T.accent : T.text }}>{tpl.label}</div>
                      <div style={{ fontSize: fs(10), color: T.dim }}>{tpl.description}</div>
                    </button>
                  );
                })}
              </div>

              {/* Weekly availability editor — the main attraction */}
              {pc && (
                <div style={{ marginBottom: 14, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', background: T.input, fontSize: fs(11), fontWeight: 600, color: T.soft, display: 'flex', justifyContent: 'space-between' }}>
                    <span>Your weekly schedule ({Math.round(weeklyHours)}h/wk)</span>
                    <span style={{ color: T.dim }}>Drag to adjust {'\u00B7'} Right-click for options</span>
                  </div>
                  <div style={{ padding: '8px 10px', background: T.panel }}>
                    <WeeklyAvailabilityEditor plannerConfig={pc} onUpdate={updates => setPc(updates)}
                      onUpdateCommitment={(id, start, end) => { setPc({ commitments: (pc.commitments || []).map(c => c.id === id ? { ...c, start, end } : c) }); }}
                      onUpdateCommitments={updated => setPc({ commitments: updated })} />
                  </div>
                </div>
              )}

              {/* Dates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <Label>When do you need to finish?</Label>
                  <BufferedInput type="date" value={data.targetCompletionDate || autoTarget} onCommit={v => setData(d => ({ ...d, targetCompletionDate: v }))} />
                  {data.universityProfile?.name && <div style={{ fontSize: fs(9), color: T.dim, marginTop: 4 }}>Auto-set from {data.universityProfile.name} term</div>}
                </div>
                <div>
                  <Label>Start date</Label>
                  <BufferedInput type="date" value={data.studyStartDate || autoStart} onCommit={v => setData(d => ({ ...d, studyStartDate: v }))} />
                </div>
              </div>

              {/* Feasibility preview */}
              <div style={{ padding: '8px 14px', borderRadius: 10, background: `${feasibilityColor}11`, border: `1px solid ${feasibilityColor}33`, fontSize: fs(11), color: feasibilityColor, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: fs(14) }}>{feasibilityLevel === 'green' ? '\u2705' : feasibilityLevel === 'yellow' ? '\u26A0\uFE0F' : '\u274C'}</span>
                <span>{Math.round(weeklyHours)}h/week {'\u00B7'} ~{Math.round(hrsPerDay * 10) / 10}h/day {'\u00B7'} Est. finish: {estCompletionDate ? new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'set dates'}</span>
              </div>

              {/* Additional context — collapsible */}
              <details style={{ marginBottom: 12 }}>
                <summary style={{ fontSize: fs(11), color: T.soft, cursor: 'pointer', marginBottom: 6 }}>Add notes (work trips, vacations, focus areas...)</summary>
                <textarea value={planPrompt} onChange={e => setPlanPrompt(e.target.value)} disabled={isBusy} placeholder={'e.g. "I have a work trip Mar 28-30" or "Focus on networking courses first"'} style={{ minHeight: 40, fontSize: fs(11), opacity: isBusy ? 0.4 : 1, border: `1px solid ${T.border}`, background: T.input, borderRadius: 8, padding: '10px 12px', width: '100%', resize: 'vertical' }} />
              </details>

              {/* Generate + Advanced toggle */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Btn v="ai" style={{ flex: 1, justifyContent: 'center', padding: '14px 24px', fontSize: fs(14) }} onClick={() => {
                  setData(d => {
                    const updated = { ...d };
                    if (!d.studyStartDate) updated.studyStartDate = autoStart;
                    if (!d.targetCompletionDate && !d.targetDate) updated.targetCompletionDate = autoTarget;
                    if (!d.plannerConfig) updated.plannerConfig = migrateToPlannerConfig(updated);
                    return updated;
                  });
                  requestAnimationFrame(() => requestAnimationFrame(() => genPlan()));
                }} disabled={bg.loading || !profile || activeCourses.length === 0}>
                  {isGenerating ? <><Ic.Spin s={14} /> Generating...</> : 'Generate Study Plan'}
                </Btn>
                <button onClick={() => setShowAdvanced(true)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(11), textDecoration: 'underline', padding: '8px 4px', whiteSpace: 'nowrap' }}>
                  Customize schedule
                </button>
              </div>

              {/* Inline AI Activity — only during plan generation */}
              {isGenerating && <AIActivity />}
            </div>
          )}

          {/* ── Full Settings Panel (advanced mode or editing existing) ── */}
          {(showAdvanced || hasPlan || pendingPlan || isGenerating) && (
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text }}>Schedule Settings</div>
                {!hasPlan && showAdvanced && (
                  <button onClick={() => setShowAdvanced(false)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', fontSize: fs(11), textDecoration: 'underline' }}>Simple view</button>
                )}
              </div>
              <div style={{ padding: '16px 18px' }}>
                {/* Dates */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
                  <div><Label>Start Date</Label><BufferedInput type="date" value={data.studyStartDate || ''} onCommit={v => setData(d => ({ ...d, studyStartDate: v }))} /></div>
                  <div><Label>Target Completion</Label><BufferedInput type="date" value={data.targetCompletionDate || ''} onCommit={v => setData(d => ({ ...d, targetCompletionDate: v }))} /></div>
                  <div><Label>Term End Date</Label><BufferedInput type="date" value={data.targetDate || ''} onCommit={v => setData(d => ({ ...d, targetDate: v }))} /></div>
                </div>

                {/* Study Mode + Pacing + Block Style */}
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14, alignItems: 'flex-end' }}>
                  <div>
                    <Label>Study Mode {data.universityProfile?.name ? <span style={{ fontSize: fs(9), color: T.dim, fontWeight: 400 }}>(auto: {effectiveStudyMode})</span> : null}</Label>
                    <PillGroup options={STUDY_MODES} value={effectiveStudyMode} onChange={v => setPc({ studyMode: v })} small />
                  </div>
                  <div>
                    <Label>Pacing</Label>
                    <PillGroup options={PACING_STYLES} value={effectivePacing} onChange={v => setPc({ pacingStyle: v })} small />
                  </div>
                  <div>
                    <Label>Block Style</Label>
                    <PillGroup options={BLOCK_STYLES} value={effectiveBlockStyle} onChange={v => setPc({ blockStyle: v })} small />
                  </div>
                </div>

                {/* Hours/Day (legacy) */}
                {!pc && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
                    <div style={{ width: 120 }}>
                      <Label>Hours/Day</Label>
                      <BufferedInput type="number" min="1" max={MAX_STUDY_HRS} value={data.studyHoursPerDay || 4} onCommit={v => {
                        const n = Math.max(1, Math.min(MAX_STUDY_HRS, Number(v) || 4));
                        setData(d => ({ ...d, studyHoursPerDay: n }));
                      }} />
                    </div>
                  </div>
                )}

                {/* Life Templates */}
                <div style={{ marginBottom: 14 }}>
                  <Label>Life Template</Label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {LIFE_TEMPLATE_IDS.map(id => {
                      const tpl = LIFE_TEMPLATES[id];
                      const isActive = pc?.lifeTemplate === id;
                      return (
                        <button key={id} onClick={() => applyTemplate(id)}
                          style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${isActive ? T.accent : T.border}`, background: isActive ? T.accentD : T.input, color: isActive ? T.accent : T.soft, fontSize: fs(10), fontWeight: 600, cursor: 'pointer', transition: 'all .15s' }}
                        >{tpl.icon} {tpl.label}</button>
                      );
                    })}
                  </div>
                </div>

                {/* Weekly Availability */}
                {pc && (
                  <div style={{ marginBottom: 14 }}>
                    <button onClick={() => setAvailOpen(!availOpen)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: T.input, border: `1px solid ${T.border}`, borderRadius: availOpen ? '8px 8px 0 0' : 8, cursor: 'pointer', color: T.text, fontSize: fs(12), fontWeight: 600 }}>
                      <span>Weekly Availability ({Math.round(weeklyHours)}h/wk, {studyDaysPerWeek} days)</span>
                      <span style={{ fontSize: fs(10), color: T.dim, transform: availOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>{'\u25BC'}</span>
                    </button>
                    {availOpen && (
                      <div style={{ padding: '10px 12px', border: `1px solid ${T.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', background: T.panel }}>
                        <WeeklyAvailabilityEditor plannerConfig={pc} onUpdate={updates => setPc(updates)}
                          onUpdateCommitment={(id, start, end) => { setPc({ commitments: (pc.commitments || []).map(c => c.id === id ? { ...c, start, end } : c) }); }}
                          onUpdateCommitments={updated => setPc({ commitments: updated })} />
                      </div>
                    )}
                  </div>
                )}

                {/* Days Off */}
                {hasSettings && (
                  <div>
                    <button onClick={() => setDaysOffOpen(!daysOffOpen)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, cursor: 'pointer', color: T.text, fontSize: fs(12), fontWeight: 600 }}>
                      <span>{'\uD83D\uDEAB'} Days Off & Exceptions ({exceptionDates.length})</span>
                      <span style={{ fontSize: fs(10), color: T.dim, transform: daysOffOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform .2s' }}>{'\u25BC'}</span>
                    </button>
                    {daysOffOpen && (
                      <div style={{ padding: '10px 12px', border: `1px solid ${T.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', background: T.panel }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                          <input type="date" value={newExDate} onChange={e => setNewExDate(e.target.value)} style={{ flex: '0 0 160px' }} />
                          <Btn small onClick={addExDate} disabled={!newExDate}>Add</Btn>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                          <Btn small v="secondary" onClick={() => addRecurringDayOff([0, 6])}>{'\uD83D\uDDD3'} Weekends</Btn>
                          {DAY_NAMES.map((day, i) => {
                            const count = exceptionDates.filter(dt => new Date(dt + 'T12:00:00').getDay() === i).length;
                            return (
                              <button key={i} onClick={() => count > 0 ? clearRecurringDayOff([i]) : addRecurringDayOff([i])}
                                style={{ padding: '5px 10px', borderRadius: 7, border: `1px solid ${count > 0 ? T.orange : T.border}`, background: count > 0 ? T.orangeD : T.input, color: count > 0 ? T.orange : T.soft, fontSize: fs(10), fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                {day}{count > 0 && <span style={{ fontSize: fs(8), opacity: 0.7 }}>({count})</span>}
                              </button>
                            );
                          })}
                          {exceptionDates.length > 0 && <Btn small v="ghost" onClick={() => { if (confirm(`Clear all ${exceptionDates.length} exception dates?`)) setData(d => ({ ...d, exceptionDates: [] })); }}>Clear All</Btn>}
                        </div>
                        {exceptionDates.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 100, overflowY: 'auto' }}>{exceptionDates.map(dt => <div key={dt} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 5, background: T.orangeD, fontSize: fs(10), color: T.orange }}>{new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}<button onClick={() => removeExDate(dt)} style={{ background: 'none', border: 'none', color: T.orange, cursor: 'pointer', fontSize: fs(12), padding: 0 }}>{'\u00D7'}</button></div>)}</div>}
                      </div>
                    )}
                  </div>
                )}

                {/* Warnings */}
                {(() => {
                  const warns = [];
                  if (hrsPerDay < 2 && totalEstHours > 0) warns.push({ c: T.orange, m: `${Math.round(hrsPerDay * 10) / 10}h/day is very low. Most students need 3-6h/day.` });
                  if (hrsPerDay > 12) warns.push({ c: T.orange, m: `${Math.round(hrsPerDay * 10) / 10}h/day is extremely high. Risk of burnout.` });
                  if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) warns.push({ c: T.red, m: 'Target completion is AFTER term end.' });
                  if (data.studyStartDate && data.targetCompletionDate && data.studyStartDate >= data.targetCompletionDate) warns.push({ c: T.red, m: `Start date on or after completion ${'\u2014'} no study days.` });
                  if (!feasible) warns.push({ c: T.red, m: `Aggressive timeline ${'\u2014'} ${minHrsPerDay}h/day needed. Consider extending your target or adjusting availability.` });
                  if (warns.length === 0) return null;
                  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>{warns.map((w, i) => <div key={i} style={{ padding: '6px 12px', borderRadius: 7, background: `${w.c}11`, border: `1px solid ${w.c}33`, fontSize: fs(10), color: w.c }}>{w.m}</div>)}</div>;
                })()}
              </div>
            </div>
          )}

          {/* ── Feasibility Stats (shown in setup/edit mode) ── */}
          {activeCourses.length > 0 && hasSettings && (showAdvanced || hasPlan) && (
            <div>
              <div style={{ padding: '8px 14px', borderRadius: 10, background: `${feasibilityColor}11`, border: `1px solid ${feasibilityColor}33`, fontSize: fs(11), color: feasibilityColor, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: fs(14) }}>{feasibilityLevel === 'green' ? '\u2705' : feasibilityLevel === 'yellow' ? '\u26A0\uFE0F' : '\u274C'}</span>
                <span>
                  {feasibilityLevel === 'green'
                    ? `On track ${'\u2014'} ${totalEstHours}h across ${activeCourses.length} course${activeCourses.length !== 1 ? 's' : ''}${finishVsGoal != null && finishVsGoal > 0 ? `, finishing ${finishVsGoal}d early` : ''}${bufferDays != null && bufferDays > 0 ? ` with ${bufferDays}d extra time` : ''}.`
                    : feasibilityLevel === 'yellow'
                      ? `Tight schedule ${'\u2014'} ${minHrsPerDay}h/day needed${utilizationPct != null ? ` (${utilizationPct}% of your time)` : ''}. Consider extending your target or adjusting availability.`
                      : `Won${'\u2019'}t fit ${'\u2014'} ${minHrsPerDay != null ? `${minHrsPerDay}h/day needed` : 'no study days available'}. Extend your target date or adjust availability.`
                  }
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10, marginBottom: 16 }}>
                {[
                  { l: 'TOTAL HOURS', v: totalEstHours, c: totalEstHours > 500 ? T.orange : T.purple, sub: `${activeCourses.length} course${activeCourses.length !== 1 ? 's' : ''} ${'\u00B7'} ~${Math.round(totalEstHours / Math.max(activeCourses.length, 1))}h avg`, ind: totalEstHours > 500 ? 'warn' : totalEstHours > 0 ? 'ok' : null },
                  { l: 'WEEKLY PACE', v: `${Math.round(weeklyHours)}h`, c: weeklyHours < 10 && totalEstHours > 100 ? T.orange : weeklyHours > 50 ? T.red : T.blue, sub: `${studyDaysPerWeek}d/wk ${'\u00B7'} ~${(Math.round(hrsPerDay * 10) / 10)}h/day`, ind: weeklyHours > 50 ? 'warn' : weeklyHours < 10 && totalEstHours > 100 ? 'warn' : 'ok' },
                  { l: 'EST. FINISH', v: estCompletionDate ? new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014', c: finishColor, sub: (() => {
                    const d = finishDelta;
                    if (d != null) return d > 7 ? `${d}d before deadline` : d >= 0 ? (d === 0 ? 'on deadline' : `only ${d}d spare`) : `${Math.abs(d)}d past deadline`;
                    return effectiveDaysLeft != null ? `${effectiveDaysLeft}d to goal` : '';
                  })(), ind: finishDelta == null ? null : finishDelta > 7 ? 'ok' : finishDelta >= 0 ? 'warn' : 'bad' },
                  { l: 'DAILY NEED', v: minHrsPerDay != null ? (!feasible ? '\u274C' : `${minHrsPerDay}h`) : '\u2014', c: !feasible ? T.red : minHrsPerDay != null && minHrsPerDay > 6 ? T.orange : T.accent, sub: minHrsPerDay == null ? 'set a target' : !feasible ? `need ${minHrsPerDay}h ${'\u2014'} won${'\u2019'}t fit` : minHrsPerDay <= 3 ? 'comfortable' : minHrsPerDay <= 5 ? 'moderate' : 'intense', ind: !feasible ? 'bad' : minHrsPerDay != null && minHrsPerDay > 6 ? 'warn' : minHrsPerDay != null ? 'ok' : null },
                  { l: bufferContext.label === 'BUFFER' ? 'EXTRA TIME' : bufferContext.label === 'ACCELERATION' ? 'EXTRA COURSES' : 'WEEKLY SLACK', v: bufferContext.primary, c: utilizationPct == null ? T.dim : utilizationPct > 100 ? T.red : utilizationPct > 85 ? T.orange : T.accent, sub: utilizationPct != null && utilizationPct > 100 ? `${Math.abs(bufferHours)}h short` : bufferContext.sub, ind: utilizationPct == null ? null : utilizationPct > 100 ? 'bad' : utilizationPct > 85 ? 'warn' : 'ok' },
                ].map((s, i) => (
                  <div key={i} style={{ background: T.card, border: `1px solid ${s.ind === 'bad' ? s.c + '44' : s.ind === 'warn' ? s.c + '33' : T.border}`, borderRadius: 12, padding: '10px 12px', textAlign: 'center', position: 'relative' }}>
                    {s.ind && <div style={{ position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: '50%', background: s.ind === 'ok' ? T.accent : s.ind === 'warn' ? T.orange : T.red }} />}
                    <div style={{ fontSize: fs(10), color: T.soft, textTransform: 'uppercase', letterSpacing: .5, fontWeight: 600, marginBottom: 3 }}>{s.l}</div>
                    <div style={{ fontSize: fs(20), fontWeight: 800, color: s.c, fontFamily: "'Outfit',sans-serif" }}>{s.v}</div>
                    <div style={{ fontSize: fs(10), color: s.ind === 'bad' ? s.c : T.dim, fontWeight: s.ind === 'bad' ? 600 : 400 }}>{s.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Generate / Review divider — only for advanced/returning users ── */}
          {(hasSettings || isFirstRun) && (showAdvanced || hasPlan || pendingPlan || isGenerating) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '0 4px' }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <span style={{ fontSize: fs(10), fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: 1 }}>{pendingPlan ? 'Review Plan' : 'Generate'}</span>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>
          )}

          {/* ═══ GENERATE + PLAN PREVIEW — only for advanced/returning/generating/reviewing ═══ */}
          {(hasSettings || isFirstRun) && (showAdvanced || hasPlan || pendingPlan || isGenerating) && (
            <div style={{ background: T.card, border: `1px solid ${pendingPlan ? T.purple + '44' : T.accent + '33'}`, borderRadius: 12, padding: '16px 18px', marginBottom: 16, boxShadow: `0 0 0 1px ${pendingPlan ? T.purple + '11' : T.accent + '11'}` }}>
              <div style={{ fontSize: fs(14), fontWeight: 700, color: pendingPlan ? T.purple : T.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                {pendingPlan ? 'Review Generated Plan' : hasPlan ? 'Regenerate Study Plan' : 'Generate Study Plan'}
                {!pendingPlan && Object.keys(data.tasks || {}).length > 0 && <Badge color={T.accent} bg={T.accentD}>{Object.keys(data.tasks || {}).length} days scheduled</Badge>}
              </div>

              {!pendingPlan && (
                <textarea value={planPrompt} onChange={e => setPlanPrompt(e.target.value)} disabled={isBusy} placeholder={'Additional context \u2014 e.g. work trips, vacations, focus areas...'} style={{ minHeight: 40, fontSize: fs(11), marginBottom: 10, opacity: isBusy ? 0.4 : 1, border: `1px solid ${T.border}`, background: T.input, borderRadius: 8, padding: '10px 12px', width: '100%', resize: 'vertical', position: 'relative', zIndex: 1 }} />
              )}

              {!pendingPlan && (
                <div style={{ display: 'flex', gap: 8 }}>
                  {isGenerating && getBgState().abortCtrl && (
                    <Btn v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, regenId: null, label: '' }); toast('Plan generation stopped', 'info'); }} style={{ color: T.red, borderColor: T.red, flexShrink: 0 }}>{'\u2B1B'} Stop</Btn>
                  )}
                  <Btn v={isBusy ? 'secondary' : 'ai'} style={{ flex: 1, justifyContent: 'center', padding: '12px 24px', fontSize: fs(14) }} onClick={() => {
                    setData(d => {
                      const updated = { ...d };
                      if (!d.studyStartDate) updated.studyStartDate = autoStart;
                      if (!d.targetCompletionDate && !d.targetDate) updated.targetCompletionDate = autoTarget;
                      if (!d.plannerConfig) updated.plannerConfig = migrateToPlannerConfig(updated);
                      return updated;
                    });
                    requestAnimationFrame(() => requestAnimationFrame(() => genPlan()));
                  }} disabled={bg.loading || !profile || activeCourses.length === 0}>
                    {isGenerating ? <><Ic.Spin s={14} /> Generating...</> : isBusy ? 'Waiting...' : !feasible ? `${'\u26A0'} Generate (Aggressive)` : hasPlan ? 'Regenerate Plan' : 'Generate Study Plan'}
                  </Btn>
                </div>
              )}

              {/* Pending plan preview */}
              {pendingPlan && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: fs(10), color: T.dim, padding: '6px 12px', background: T.input, borderRadius: 8, marginBottom: 8, lineHeight: 1.4 }}>
                    Study hours and topic estimates are AI-generated. Adjust based on your actual pace and your instructor{'\u2019'}s guidance.
                  </div>
                  <div style={{ marginBottom: 10, position: 'sticky', top: 0, zIndex: 5, background: T.card, padding: '8px 0' }}>
                    <div style={{ fontSize: fs(12), color: T.soft, marginBottom: 8 }}>{pendingPlan.summary}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Btn v="ai" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }} onClick={confirmPlan}>{'\u2713'} Confirm Plan</Btn>
                      <Btn v="ghost" style={{ flexShrink: 0 }} onClick={discardPlan}>{'\u2717'} Discard</Btn>
                    </div>
                  </div>
                  <div style={{ maxHeight: 400, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {(() => {
                      const sortedDates = [...new Set(pendingPlan.tasks.map(t => t.date))].sort();
                      if (sortedDates.length === 0) return null;
                      const firstDate = new Date(sortedDates[0] + 'T12:00:00');
                      const weeks = {};
                      for (const dt of sortedDates) {
                        const d = new Date(dt + 'T12:00:00');
                        const weekNum = Math.floor((d - firstDate) / (7 * 86400000));
                        if (!weeks[weekNum]) weeks[weekNum] = [];
                        weeks[weekNum].push(dt);
                      }
                      return Object.entries(weeks).map(([wn, dates]) => {
                        const weekTasks = pendingPlan.tasks.filter(t => dates.includes(t.date));
                        const weekHrs = weekTasks.reduce((s, t) => { const st = parseTime(t.time), et = parseTime(t.endTime); return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0); }, 0);
                        return (
                          <div key={wn} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                            <div style={{ padding: '6px 10px', background: T.input, fontSize: fs(10), fontWeight: 700, color: T.soft, display: 'flex', justifyContent: 'space-between' }}>
                              <span>Week {Number(wn) + 1}: {new Date(dates[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {'\u2013'} {new Date(dates[dates.length - 1] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                              <span>{Math.round(weekHrs)}h</span>
                            </div>
                            <div style={{ padding: '4px 8px' }}>
                              {dates.map(dt => (
                                <div key={dt}>
                                  <div style={{ fontSize: fs(10), fontWeight: 700, color: T.accent, padding: '3px 0 1px' }}>{new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                                  {pendingPlan.tasks.filter(t => t.date === dt).map((t, j) => (
                                    <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px', borderRadius: 5, background: T.input, marginBottom: 2, fontSize: fs(10) }}>
                                      <span style={{ color: T.blue, minWidth: 40, fontFamily: "'JetBrains Mono',monospace" }}>{t.time || '\u2014'}</span>
                                      <span style={{ flex: 1, color: T.text }}>{t.title}</span>
                                      {t.endTime && <span style={{ color: T.dim, fontSize: fs(9) }}>{'\u2192'} {t.endTime}</span>}
                                      {t.category && t.category !== 'study' && <Badge color={t.category === 'break' ? T.dim : t.category === 'exam-day' ? T.red : t.category === 'exam-prep' ? T.orange : t.category === 'review' ? T.blue : T.purple} bg={(t.category === 'break' ? T.dim : t.category === 'exam-day' ? T.red : t.category === 'exam-prep' ? T.orange : t.category === 'review' ? T.blue : T.purple) + '22'}>{t.category}</Badge>}
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              <AIActivity />
            </div>
          )}
        </>
      )}

      {/* ─── POST-CONFIRM NAVIGATION ─── */}
      {showPostConfirm && !pendingPlan && (
        <div className="slide-up" style={{ background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1px solid ${T.accent}33`, borderRadius: 14, padding: '20px 24px', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: fs(14), fontWeight: 700, color: T.accent, marginBottom: 4 }}>{'\u2705'} Plan Confirmed</div>
          <div style={{ fontSize: fs(12), color: T.soft, marginBottom: 16 }}>Your study tasks have been added to the calendar.</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Btn v="ai" onClick={() => { setShowPostConfirm(false); setPage('daily'); }}>View Today{'\u2019'}s Tasks {'\u2192'}</Btn>
            <Btn v="secondary" onClick={() => { setShowPostConfirm(false); setPage('calendar'); }}>View Calendar {'\u2192'}</Btn>
            <Btn v="ghost" onClick={() => setShowPostConfirm(false)}>Stay Here</Btn>
          </div>
        </div>
      )}
    </div>
  );
};

export { StudyPlannerPage };
export default StudyPlannerPage;
