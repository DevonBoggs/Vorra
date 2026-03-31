import { useState, useMemo, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, diffDays, parseTime, uid, minsToStr } from '../../utils/helpers.js';
import { downloadICS } from '../../utils/icsExport.js';
import { DEFAULT_W, DEFAULT_REQUEST_RETENTION } from '../../systems/spaced-repetition.js';
import { getSTATUS_C } from '../../constants/categories.js';
import { useBreakpoint } from '../../systems/breakpoint.js';
import { dlog } from '../../systems/debug.js';
import { toast } from '../../systems/toast.js';
import { buildSystemPrompt, runAILoop, universityContextBlock } from '../../systems/api.js';
import { useBgTask, bgSet, bgLog, bgNewAbort, getBgState, bgAbort } from '../../systems/background.js';
import { executeTools, safeArr, matchTaskToCourse } from '../../utils/toolExecution.js';
import { Badge } from '../../components/ui/Badge.jsx';
import { Label } from '../../components/ui/Label.jsx';
import { BufferedInput } from '../../components/ui/BufferedInput.jsx';
import { Btn } from '../../components/ui/Btn.jsx';
import { LogLine } from '../../components/ui/LogLine.jsx';
import { PillGroup } from '../../components/ui/PillGroup.jsx';
import { WeeklyAvailabilityEditor } from '../../components/planner/WeeklyAvailabilityEditor.jsx';
import { hasCtx } from '../../utils/courseHelpers.js';
import { LIFE_TEMPLATES, LIFE_TEMPLATE_IDS } from '../../constants/lifeTemplates.js';
import { TOOLS, getProviderQuirks } from '../../constants/tools.js';
import { computeCourseProgress, removeFutureCourseTasks, findNextUndonePlanTask } from '../../utils/courseLifecycle.js';
import { analyzeGaps, buildGapFillPrompt } from '../../utils/gapAnalysis.js';
import { lessonPlanToQueue, populateToday, computeProgress } from '../../utils/studyQueue.js';
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
  { value: 'sequential', label: 'One at a time', icon: '\u27A1', title: 'Finish all hours for one course before starting the next. Best for WGU and competency-based programs.' },
  { value: 'parallel', label: 'Multiple at once', icon: '\u2194', title: 'Study 2-3 courses each day, splitting hours proportionally. Best for SNHU, ASU, and term-based programs.' },
  { value: 'hybrid', label: 'Mix of both', icon: '\u21C4', title: '65% on your main course, 25% previewing the next, 10% reviewing past material.' },
];
const PACING_STYLES = [
  { value: 'steady', label: 'Same every day', title: 'Consistent study hours every day. Simple and predictable.' },
  { value: 'wave', label: 'Heavy/light days', title: 'Alternate between full study days and lighter review days. Good for avoiding burnout.' },
  { value: 'sprint-rest', label: 'Intense + rest', title: '4 intense study days followed by 1 light review day. High productivity with built-in recovery.' },
];
const BLOCK_STYLES = [
  { value: 'standard', label: 'Standard (60-90m)', title: '60-90 minute study blocks with 10-15 minute breaks. Good all-around approach.' },
  { value: 'pomodoro', label: 'Pomodoro (25m)', title: '25 minutes of focused study, then a 5 minute break. 4 cycles = 1 session with a longer break.' },
  { value: 'sprint', label: 'Deep focus (50m)', title: '50 minute deep focus sessions with 10 minute breaks. Fewer interruptions, longer concentration.' },
];

// Live elapsed timer for generation progress
const ElapsedTimer = () => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  const m = Math.floor(elapsed / 60), s = elapsed % 60;
  return <span>{m > 0 ? `${m}m ${s}s` : `${s}s`}</span>;
};

const StudyPlannerPage = ({ data, setData, profile, setPage }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  // pendingPlan persisted in data to survive navigation
  const pendingPlan = data.pendingPlan || null;
  const setPendingPlan = (v) => setData(d => ({ ...d, pendingPlan: v }));
  const [planPrompt, setPlanPrompt] = useState(data.planPrompt || '');
  // Persist planPrompt to data when it changes
  useEffect(() => { if (planPrompt !== (data.planPrompt || '')) setData(d => ({ ...d, planPrompt })); }, [planPrompt]);
  const [newExDate, setNewExDate] = useState('');
  const [availOpen, setAvailOpen] = useState(true);
  const [daysOffOpen, setDaysOffOpen] = useState(false);
  const [showPostConfirm, setShowPostConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [shiftDays, setShiftDays] = useState(1);
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
  const bg = useBgTask();

  // Unified cancel function — aborts both the planner loop and the current runAILoop call
  const cancelGeneration = () => {
    bgAbort(); // aborts outerAbortCtrl + abortCtrl, resets loading state
    setShowSettings(false); // Return to cockpit view if plan exists
    // Clear any partial pending plan so the user can regenerate immediately
    if (pendingPlan) {
      // Remove partial tasks that were inserted during generation
      setData(d => {
        const tasks = { ...d.tasks };
        for (const t of (pendingPlan.tasks || [])) {
          if (tasks[t.date]) {
            tasks[t.date] = tasks[t.date].filter(x => x.id !== t.id);
            if (tasks[t.date].length === 0) delete tasks[t.date];
          }
        }
        return { ...d, tasks, pendingPlan: null };
      });
    }
  };

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

  // Feasibility level — guard against transient stale values during re-renders
  const feasibilityLevel = (() => {
    if (!feasible) return 'red';
    // Only show red if the numbers genuinely don't work
    const isRed = (minHrsPerDay != null && minHrsPerDay > 10) ||
                  (utilizationPct != null && utilizationPct > 100) ||
                  (finishDelta != null && finishDelta < -7);
    if (isRed) return 'red';
    // Yellow for tight but doable schedules
    const isYellow = (minHrsPerDay != null && minHrsPerDay > 6) ||
                     (utilizationPct != null && utilizationPct > 90) ||
                     (finishDelta != null && finishDelta >= -7 && finishDelta < 3);
    if (isYellow) return 'yellow';
    return 'green';
  })();
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
    // Confirm before replacing existing schedule
    const hasExisting = pc?.weeklyAvailability && Object.values(pc.weeklyAvailability).some(d => d.windows?.length > 0);
    if (hasExisting && pc?.lifeTemplate !== templateId) {
      setConfirmDialog({
        message: `Replace your current schedule with "${tpl.label}"? This will overwrite your study windows and commitments.`,
        onConfirm: () => { setConfirmDialog(null); doApplyTemplate(templateId); },
      });
      return;
    }
    doApplyTemplate(templateId);
  };

  const doApplyTemplate = (templateId) => {
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
            {bg.loading && <Btn small v="ghost" onClick={cancelGeneration}>Cancel</Btn>}
            {!bg.loading && bg.logs.length > 0 && <Btn small v="ghost" onClick={() => bgSet({ logs: [] })}>Clear</Btn>}
          </div>
        </div>
        {bg.streamText && <div style={{ padding: '6px 10px', borderRadius: 7, background: T.purpleD, border: `1px solid ${T.purple}33`, fontSize: fs(11), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto', marginBottom: 4 }}>{bg.streamText}</div>}
        {bg.logs.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>{bg.logs.map((l, i) => <LogLine key={i} l={l} />)}</div>}
      </div>
    );
  };

  // ── Generate plan (3-step: Lesson Plan → Schedule → Daily Tasks) ──
  // Normalize course codes for consistent lookups (AI may return different casing)
  const normCode = (code) => (code || '').toUpperCase().trim();
  const genLock = bg.loading && (bg.label || '').toLowerCase().includes('plan');
  // Token config per step. GLM-5.1 max output is 131,072. Use full capacity for
  // schedule (103 units → large JSON) and daily tasks. Lesson is per-course so 16K suffices.
  const getMaxTokens = (step) => {
    const isThinking = (profile?.model || '').match(/thinking|think|r1\b|qwq|reasoner|glm-5\.1|glm-5(?!.*turbo)/i);
    if (step === 'lesson') return isThinking ? 32768 : 16384;
    if (step === 'schedule') return isThinking ? 131072 : 16384; // Schedule maps ALL units — needs full capacity
    return isThinking ? 131072 : 16384; // daily tasks
  };

  // Global generation ID — incremented each time genPlan starts, checked throughout
  // to ensure stale async loops from cancelled generations stop immediately.
  const genIdRef = useRef(0);

  const genPlan = async () => {
    // Abort any in-flight generation (even if loading flag was already cleared)
    if (getBgState().abortCtrl) getBgState().abortCtrl.abort();
    if (getBgState().outerAbortCtrl) getBgState().outerAbortCtrl.abort();
    // Brief yield to let cancelled async loops detect abort and exit
    await new Promise(r => setTimeout(r, 50));
    if (getBgState().loading) { toast('Generation already in progress', 'info'); return; }
    if (!profile) { toast('Connect an AI provider in Settings first', 'warn'); return; }
    if (pendingPlan) {
      setData(d => {
        const tasks = { ...d.tasks };
        for (const t of (pendingPlan.tasks || [])) {
          if (tasks[t.date]) {
            tasks[t.date] = tasks[t.date].filter(x => x.id !== t.id);
            if (tasks[t.date].length === 0) delete tasks[t.date];
          }
        }
        return { ...d, tasks, pendingPlan: null };
      });
    }
    const active = courses.filter(c => c.status !== 'completed');
    if (!active.length) { toast('No active courses to plan', 'warn'); return; }
    if (!data.studyStartDate) setData(d => ({ ...d, studyStartDate: todayStr() }));
    if (!data.targetCompletionDate && !data.targetDate) {
      const derived = deriveTargetDate(data.universityProfile);
      setData(d => ({ ...d, targetCompletionDate: derived }));
    }
    if (!data.plannerConfig) {
      setData(d => ({ ...d, plannerConfig: migrateToPlannerConfig(d) }));
    }
    if (hrsPerDay < 0.5) { toast('Add study time to your weekly schedule first', 'warn'); return; }

    if (!feasible) toast('Heads up: this is a very tight schedule.', 'warn');

    const planId = `plan_${Date.now()}`;
    const genId = ++genIdRef.current; // Unique ID for this generation run
    const lockedProfile = { ...profile }; // Lock the profile — don't switch mid-generation
    const quirks = getProviderQuirks(lockedProfile);
    const noTools = !!quirks.noToolSupport;
    const abortCtrl = new AbortController();
    const genStart = Date.now();
    // Helper: check if this generation is still the active one
    const isStale = () => genIdRef.current !== genId || abortCtrl.signal.aborted;
    bgSet({ loading: true, outerAbortCtrl: abortCtrl, label: 'Step 1/3: Creating lesson plan...', logs: [
      { type: 'user', content: '📋 Step 1/3: Generating lesson plan for all courses...' },
      ...(noTools ? [{ type: 'text', content: `ℹ️ ${lockedProfile.name} does not support tool calling — using JSON-text fallback.` }] : []),
    ], abortCtrl });

    try {

    const capturedTasks = [];
    const seenTaskIds = new Set();
    let stateSnapshot = { ...data };
    let lastToolInput = null; // Capture the last tool call's input for lesson plan / schedule extraction
    const previewSetData = (fn) => {
      if (isStale()) return;
      const next = typeof fn === 'function' ? fn(stateSnapshot) : fn;
      if (next.tasks) {
        for (const [dt, dayTasks] of Object.entries(next.tasks)) {
          const oldTasks = stateSnapshot.tasks?.[dt] || [];
          const newOnes = safeArr(dayTasks).filter(t => !oldTasks.some(o => o.id === t.id));
          for (const t of newOnes) {
            // Patch planId onto the actual task object in data.tasks
            const idx = dayTasks.findIndex(x => x.id === t.id);
            if (idx >= 0) dayTasks[idx] = { ...dayTasks[idx], planId };
            const dedupKey = `${t.title}|${dt}|${t.time}`;
            if (!seenTaskIds.has(dedupKey)) {
              seenTaskIds.add(dedupKey);
              capturedTasks.push({ ...t, planId, date: dt });
            }
          }
        }
      }
      stateSnapshot = next;
      setData(() => next);
    };
    // Wrapper that captures tool call inputs for lesson plan / schedule extraction
    const capturingExecuteTools = (toolCalls, d, sd) => {
      for (const tc of toolCalls) {
        if (tc.name === 'create_lesson_plan' || tc.name === 'create_schedule_outline') {
          lastToolInput = tc.input;
        }
      }
      return executeTools(toolCalls, d, sd);
    };

    const startDt = data.studyStartDate || todayStr();
    const endDt = goalDate || data.targetDate || '';
    const exDts = safeArr(data.exceptionDates);
    const userCtx = planPrompt.trim() ? `\nSTUDENT INSTRUCTIONS (MUST follow these):\n${planPrompt.trim()}` : '';
    // Use a focused system prompt for plan generation — full buildSystemPrompt duplicates
    // course details that are already in the user message. Keep university context + key rules.
    const uniObj = data.universityProfile;
    const uniBlock = uniObj ? universityContextBlock(uniObj) : '';
    const baseSys = `You are Vorra, an AI study planner. Generate structured study plans using the provided tools. Today: ${todayStr()}.
${uniBlock}
PLANNING RULES:
- Start each course with quick wins for momentum, then progress to harder material.
- Weight study hours by topic difficulty and importance — harder/heavier topics get more time.
- Place pre-assessment weak areas as dedicated units with extra hours.
- Every assessed course MUST end with exam-prep + exam-day units.
- Include retrieval practice reviews after every 3-4 learning units.
- Tasks should be 1-3 hour blocks with breaks between.
${data.userContext ? `\nSTUDENT PREFERENCES:\n${data.userContext}` : ''}`;
    // availPrompt removed — no longer needed (queue model, no calendar scheduling)

    // Course details for prompts — include all enriched data so the AI
    // can build high-quality lesson plans tailored to each course's needs.
    const courseCtx = active.map((c, i) => {
      const hrs = c.averageStudyHours > 0 ? c.averageStudyHours : ([0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50);
      let line = `${i + 1}. ${c.name}${c.courseCode ? ` (${c.courseCode})` : ''} — ${hrs}h est, ${c.credits || '?'}CU, ${c.assessmentType || '?'}, diff ${c.difficulty || 3}/5`;
      if (c.examDate) line += ` [EXAM: ${c.examDate}]`;
      if (c.certAligned) line += ` → cert: ${c.certAligned}`;
      const comps = safeArr(c.competencies);
      if (comps.length > 0) line += `\n   Competencies: ${comps.map(x => `${x.code || ''} ${x.title} (${x.weight || '?'})`).join('; ')}`;
      const topics = safeArr(c.topicBreakdown);
      if (topics.length > 0) line += `\n   Topics: ${topics.map(t => `${t.topic} [${t.weight || '?'}]`).join(', ')}`;
      if (safeArr(c.knownFocusAreas).length > 0) line += `\n   Focus areas: ${safeArr(c.knownFocusAreas).join('; ')}`;
      if (safeArr(c.studyOrder).length > 0) line += `\n   Study order: ${safeArr(c.studyOrder).join(' → ')}`;
      if (safeArr(c.preAssessmentWeakAreas).length > 0) line += `\n   Weak areas: ${safeArr(c.preAssessmentWeakAreas).join(', ')}`;
      if (c.preAssessmentScore != null) line += `\n   Pre-assessment: ${c.preAssessmentScore}%`;
      if (safeArr(c.quickWins).length > 0) line += `\n   Quick wins: ${safeArr(c.quickWins).slice(0, 3).join(', ')}`;
      if (safeArr(c.hardestConcepts).length > 0) line += `\n   Hardest concepts: ${safeArr(c.hardestConcepts).join('; ')}`;
      if (c.studyStrategy) line += `\n   Strategy: ${c.studyStrategy}`;
      if (safeArr(c.examTips).length > 0) line += `\n   Exam tips: ${safeArr(c.examTips).slice(0, 3).join('; ')}`;
      if (c.passRate) line += `\n   Pass rate: ${c.passRate}`;
      return line;
    }).join('\n');

    // ═══════════════════════════════════════════
    // STEP 1: LESSON PLAN (what to study)
    // Generate per-course to keep each call small enough for all providers.
    // ═══════════════════════════════════════════
    bgLog({ type: 'text', content: `Analyzing ${active.length} courses (${totalEstHours}h total)...` });

    const lessonSys = baseSys + '\nCONTEXT: Create a lesson plan using create_lesson_plan. Do NOT generate daily tasks or a schedule.';
    const lessonTools = noTools ? null : TOOLS.filter(t => t.name === 'create_lesson_plan');
    const lessonPlanCourses = [];

    for (let ci = 0; ci < active.length; ci++) {
      if (isStale()) break;
      const c = active[ci];
      const hrs = c.averageStudyHours > 0 ? c.averageStudyHours : ([0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50);
      bgSet({ label: `Step 1/3: Lesson plan ${ci + 1}/${active.length} — ${c.courseCode || c.name}...` });
      bgLog({ type: 'text', content: `📖 Course ${ci + 1}/${active.length}: ${c.courseCode || c.name} (${hrs}h)` });

      // Build single-course context
      const singleCtx = courseCtx.split('\n').filter(l => l.startsWith(`${ci + 1}. `)).join('\n')
        || `${c.name}${c.courseCode ? ` (${c.courseCode})` : ''} — ${hrs}h est, ${c.credits || '?'}CU, ${c.assessmentType || '?'}, diff ${c.difficulty || 3}/5`;

      const coursePrompt = `Create a detailed, task-oriented lesson plan for this course. Each unit must be specific enough that a student knows EXACTLY what to study.

COURSE:
${singleCtx}

${userCtx}

Create ordered learning UNITS (2-6 hours each). Each unit must have:
- A SPECIFIC title naming the exact topic (NOT "Fundamentals Review" but "OSI Model Layers 1-4: Physical, Data Link, Network" or "Subnetting: CIDR Notation and Subnet Mask Calculations")
- A topics array listing 3-6 specific sub-topics the student will cover
- An objectives string describing what the student should be able to DO after completing this unit (not just "understand X" but "configure X", "calculate Y", "explain Z without notes")
- A notes string with specific study instructions: what to read, what to practice, what to focus on

UNIT TYPES:
- "learn": new material. Title must name the specific concept/skill being learned.
- "review": retrieval practice for specific prior units. Title must say WHICH topics are being reviewed (e.g., "Review: Subnetting & VLSM from Units 3-4"). Place after every 3-4 learn units.
- "practice": hands-on application. Title must describe the specific exercise (e.g., "Lab: Configure OSPF on a 3-Router Topology").
- "exam-prep": timed practice tests simulating the actual exam format.
- "exam-day": the actual assessment.

TITLE SPECIFICITY RULES:
- BAD: "Network Fundamentals" (too vague)
- GOOD: "IPv4 Addressing: Classful Networks, Subnetting, and VLSM"
- BAD: "SDN Review" (which SDN topics?)
- GOOD: "Review: OpenFlow Message Types & SDN Controller Architecture (Units 2-3)"
- BAD: "Exam Prep" (what specifically?)
- GOOD: "Practice Exam: 60 Questions, 90 Minutes, Timed — Focus on Automation & Security Domains"

GENERAL RULES:
- Start with quick wins (easiest, most foundational topics) for momentum
- Place weak areas as dedicated units with extra hours
- MUST end with exam-prep + exam-day units
- Total hours must be ~${hrs}h (±10%)
- Units should be 2-6 hours each
- Every unit's topics array must list specific, testable sub-topics

Call create_lesson_plan with this course and its units.`;

      try {
        lastToolInput = null;
        const { logs: lLogs, finalText } = await runAILoop(lockedProfile, lessonSys, [{ role: 'user', content: coursePrompt }], data, previewSetData, capturingExecuteTools, null, true, 1, getMaxTokens('lesson'), lessonTools);
        for (const l of lLogs) bgLog(l);

        // Extract from tool call
        let coursePlan = null;
        if (lastToolInput?.courses?.length > 0) {
          coursePlan = lastToolInput.courses[0];
        } else if (lastToolInput?.course_code) {
          coursePlan = lastToolInput;
        }
        // Fallback: parse from text response
        if (!coursePlan && finalText) {
          const match = finalText.match(/\{[\s\S]*"course_code"[\s\S]*"units"[\s\S]*\}/);
          if (match) try {
            const parsed = JSON.parse(match[0]);
            coursePlan = parsed.courses?.[0] || parsed;
          } catch (_) {
            try { const { repairTruncatedJSON } = await import('../../utils/jsonRepair.js'); const rep = repairTruncatedJSON(match[0]); coursePlan = rep.courses?.[0] || rep; } catch (_2) {}
          }
        }

        if (coursePlan?.units?.length > 0) {
          lessonPlanCourses.push(coursePlan);
          bgLog({ type: 'text', content: `  ✅ ${coursePlan.course_code || c.courseCode}: ${coursePlan.units.length} units, ${coursePlan.total_hours || hrs}h` });
        } else {
          bgLog({ type: 'error', content: `  ❌ No lesson plan returned for ${c.courseCode || c.name}` });
        }
      } catch (e) {
        bgLog({ type: 'error', content: `  ❌ ${c.courseCode || c.name} failed: ${e.message}` });
      }
    }

    const lessonPlan = lessonPlanCourses.length > 0 ? { courses: lessonPlanCourses } : null;

    if (!lessonPlan?.courses?.length) {
      bgLog({ type: 'error', content: 'Failed to generate lesson plan. Try a different model or simplify your courses.' });
      toast('Lesson plan generation failed', 'error');
      bgSet({ loading: false, label: '', abortCtrl: null, outerAbortCtrl: null });
      return;
    }

    const totalUnits = lessonPlan.courses.reduce((s, c) => s + (c.units?.length || 0), 0);
    const totalLessonHrs = lessonPlan.courses.reduce((s, c) => s + (c.total_hours || 0), 0);
    bgLog({ type: 'text', content: `✅ Lesson plan: ${lessonPlan.courses.length} courses, ${totalUnits} units, ${totalLessonHrs}h total` });
    for (const c of lessonPlan.courses) {
      bgLog({ type: 'text', content: `  ${c.course_code}: ${c.units?.length || 0} units, ${c.total_hours}h — ${(c.units || []).map(u => u.title).slice(0, 3).join(', ')}${(c.units?.length || 0) > 3 ? '...' : ''}` });
    }
    setData(d => ({ ...d, lessonPlan: { ...lessonPlan, planId, createdAt: new Date().toISOString() } }));

    if (isStale()) { bgSet({ loading: false }); return; }

    // ═══════════════════════════════════════════
    // STEP 2: CONVERT LESSON PLAN → TASK QUEUE (local — instant)
    // ═══════════════════════════════════════════
    bgSet({ label: 'Step 2/2: Building task queue...' });
    bgLog({ type: 'user', content: '📋 Step 2/2: Converting lesson plan to task queue...' });

    const scheduleSys = baseSys + '\nCONTEXT: Map this course onto the calendar using create_schedule_outline. Do NOT generate daily tasks.';
    const taskQueue = lessonPlanToQueue(lessonPlan, {
      studyMode: effectiveStudyMode,
      blockStyle: effectiveBlockStyle,
      courses: active,
    });

    const totalQueueMins = taskQueue.filter(t => t.category !== 'break').reduce((s, t) => s + (t.estimatedMins || 60), 0);
    const totalQueueHrs = Math.round(totalQueueMins / 60 * 10) / 10;
    bgLog({ type: 'text', content: `✅ Task queue: ${taskQueue.length} tasks (${taskQueue.filter(t => t.category !== 'break').length} study + ${taskQueue.filter(t => t.category === 'break').length} breaks), ~${totalQueueHrs}h total` });

    // Save queue and lesson plan to data
    setData(d => ({
      ...d,
      taskQueue,
      lessonPlan: { ...lessonPlan, planId, createdAt: new Date().toISOString() },
      planHistory: [...(d.planHistory || []), {
        planId,
        createdAt: new Date().toISOString(),
        snapshot: { studyMode: effectiveStudyMode, pacingStyle: effectivePacing, blockStyle: effectiveBlockStyle, hrsPerDay, startDate: startDt, targetDate: endDt, courseCount: active.length, totalEstHours },
        plannedHours: totalQueueHrs,
        taskCount: taskQueue.filter(t => t.category !== 'break').length,
      }],
    }));

    const genElapsed = ((Date.now() - genStart) / 1000).toFixed(1);
    bgLog({ type: 'text', content: `\n📊 Generation complete: ${taskQueue.length} tasks, ~${totalQueueHrs}h, ${genElapsed}s` });
    setPendingPlan({ planId, tasks: taskQueue, summary: `${taskQueue.filter(t => t.category !== 'break').length} study tasks across ${lessonPlan.courses.length} courses (~${totalQueueHrs}h)` });
    toast(`Plan generated — review ${taskQueue.filter(t => t.category !== 'break').length} tasks before confirming`, 'info');

    // OLD STEPS 2+3 REMOVED — queue model replaces calendar scheduling
    } finally { bgSet({ loading: false, regenId: null, label: '', abortCtrl: null, outerAbortCtrl: null }); } };
  const [expandedWeeks, setExpandedWeeks] = useState({ 0: true });
  const [excludedWeeks, setExcludedWeeks] = useState({}); // Per-week accept toggles
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [undoSnapshot, setUndoSnapshot] = useState(null); // For undo after confirm
  const [courseFilter, setCourseFilter] = useState(null); // P2-9: course filter
  const [editingTask, setEditingTask] = useState(null); // P2-10: { id, field, value }
  const PLAN_COLORS = [T.accent, T.blue, T.purple, T.orange, T.red, '#4ecdc4', '#f7b731', '#e88bb3'];

  const confirmPlan = () => {
    if (!pendingPlan) return;
    // Queue model: taskQueue is already saved in data during generation.
    // Confirming just clears the pending state and navigates to daily view.
    const taskCount = (pendingPlan.tasks || []).filter(t => t.category !== 'break').length;
    setUndoSnapshot({ planId: pendingPlan.planId, taskQueue: data.taskQueue || [] });
    setPendingPlan(null);
    setShowPostConfirm(true);
    toast(`Plan confirmed: ${taskCount} study tasks ready in your queue`, 'success');
    setTimeout(() => setUndoSnapshot(null), 15000);
  };

  const undoConfirm = () => {
    if (!undoSnapshot) return;
    setData(d => {
      const ph = [...(d.planHistory || [])];
      const idx = ph.findIndex(p => p.planId === undoSnapshot.planId);
      if (idx >= 0) ph.splice(idx, 1);
      return { ...d, taskQueue: [], lessonPlan: null, planHistory: ph };
    });
    setUndoSnapshot(null);
    setShowPostConfirm(false);
    toast('Plan undone — task queue cleared', 'info');
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
    setShowDiscardConfirm(false);
    setExpandedWeeks({ 0: true });
    setExcludedWeeks({});
    toast('Plan discarded', 'info');
  };

  const removeTaskFromPending = (taskId, taskDate) => {
    if (!pendingPlan) return;
    // Remove from data.tasks
    setData(d => {
      const tasks = { ...d.tasks };
      if (tasks[taskDate]) {
        tasks[taskDate] = tasks[taskDate].filter(x => x.id !== taskId);
        if (tasks[taskDate].length === 0) delete tasks[taskDate];
      }
      return { ...d, tasks };
    });
    // Remove from pendingPlan
    const updated = pendingPlan.tasks.filter(t => t.id !== taskId);
    const hrs = updated.reduce((s, t) => { const st = parseTime(t.time), et = parseTime(t.endTime); return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0); }, 0);
    setPendingPlan({ ...pendingPlan, tasks: updated, summary: `${updated.length} tasks across ${[...new Set(updated.map(t => t.date))].length} days (~${Math.round(hrs)}h scheduled)` });
  };

  // Course color helper for plan review
  const getCourseColor = (title) => {
    if (!title) return T.dim;
    const { courseKey } = matchTaskToCourse(title, courses);
    const idx = courses.findIndex(c => (c.courseCode || c.name) === courseKey);
    return idx >= 0 ? PLAN_COLORS[idx % PLAN_COLORS.length] : T.dim;
  };

  // P2-10: Update a task field in both pendingPlan and data.tasks
  const updatePendingTask = (taskId, taskDate, field, value) => {
    if (!pendingPlan) return;
    setData(d => {
      const tasks = { ...d.tasks };
      if (tasks[taskDate]) {
        tasks[taskDate] = tasks[taskDate].map(t => t.id === taskId ? { ...t, [field]: value } : t);
      }
      return { ...d, tasks };
    });
    if (pendingPlan) {
      setPendingPlan({
        ...pendingPlan,
        tasks: pendingPlan.tasks.map(t => t.id === taskId ? { ...t, [field]: value } : t),
      });
    }
    setEditingTask(null);
  };

  // P2-13: Detect conflicts between pending plan and existing calendar tasks
  const planConflicts = useMemo(() => {
    if (!pendingPlan) return [];
    // Build set of all pending plan task IDs to exclude them from "existing" tasks
    const planTaskIds = new Set(pendingPlan.tasks.map(t => t.id).filter(Boolean));
    const conflicts = [];
    for (const t of pendingPlan.tasks) {
      if (!t.time || !t.endTime || t.category === 'break') continue;
      // Only check against tasks that are NOT part of the current pending plan
      const existing = safeArr(data.tasks?.[t.date]).filter(x =>
        !planTaskIds.has(x.id) && !x.planId && x.time && x.endTime
      );
      for (const ex of existing) {
        const tS = parseTime(t.time)?.mins, tE = parseTime(t.endTime)?.mins;
        const eS = parseTime(ex.time)?.mins, eE = parseTime(ex.endTime)?.mins;
        if (tS != null && tE != null && eS != null && eE != null && tS < eE && tE > eS) {
          conflicts.push({ planTask: t, existing: ex, date: t.date });
        }
      }
    }
    return conflicts;
  }, [pendingPlan, data.tasks]);

  // ── Derived state ──
  const unenrichedCount = activeCourses.filter(c => !hasCtx(c)).length;
  const needsHoursCount = courses.filter(c => c.status !== 'completed' && (!c.averageStudyHours || c.averageStudyHours <= 0)).length;
  const hasSettings = !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
  const isFirstRun = courses.length > 0 && !hasSettings;
  const lastPlan = (data.planHistory || []).slice(-1)[0] || null;
  const hasQueue = (data.taskQueue || []).some(t => !t.done);
  const hasPlan = (!!lastPlan || hasQueue) && !pendingPlan;

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

    // Check if any tasks match the planId — if not, fall back to matching ALL tasks
    // with a planId (handles legacy tasks where planId wasn't patched correctly)
    // Match tasks to the active plan. If no exact planId match found, fall back to
    // including all non-manual tasks (tasks with courseId or category matching study patterns)
    const hasExactMatch = Object.values(data.tasks || {}).some(dayTasks => safeArr(dayTasks).some(t => t.planId === activePlanId));
    const isStudyTask = (t) => ['study', 'review', 'exam-prep', 'exam-day', 'project', 'class'].includes(t.category);
    const matchTask = (t) => hasExactMatch ? t.planId === activePlanId : (t.planId || t.courseId || isStudyTask(t));

    // Compute streak — consecutive days with at least one plan task done
    const allDates = Object.keys(data.tasks || {}).filter(d => d <= today).sort().reverse();
    let streakBroken = false;
    for (const dt of allDates) {
      const dayPlanTasks = safeArr(data.tasks[dt]).filter(matchTask);
      if (dayPlanTasks.length === 0) continue;
      if (dayPlanTasks.some(t => t.done)) { if (!streakBroken) streak++; }
      else { streakBroken = true; }
    }

    for (const [dt, dayTasks] of Object.entries(data.tasks || {})) {
      for (const t of safeArr(dayTasks)) {
        if (!matchTask(t)) continue;
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
        if ((t.planId === lastPlan.planId || (!t.planId && t.courseId)) && !t.done) upcoming.push({ ...t, date: dt });
      }
      if (upcoming.length >= 5) break;
    }
    return upcoming;
  }, [data.tasks, data.planHistory]);

  // ── Cockpit: plan timeline data (course blocks across weeks) ──
  const [expandedCourse, setExpandedCourse] = useState(null);
  const courseProgress = useMemo(() => {
    if (!lastPlan) return null;
    const today = todayStr();
    const planStart = lastPlan.snapshot?.startDate || today;
    const courseMap = {};
    const sortedDates = Object.keys(data.tasks || {}).sort();
    for (const dt of sortedDates) {
      for (const t of safeArr(data.tasks[dt])) {
        if (t.planId !== lastPlan.planId && t.planId) continue; // Match exact planId, or include tasks with empty planId (legacy)
        const { courseKey } = matchTaskToCourse(t.title, courses, t.category);
        if (courseKey === 'Break') continue; // Exclude breaks from course progress
        const name = courseKey || 'Other';
        if (!courseMap[name]) courseMap[name] = { name, totalMins: 0, doneMins: 0, tasks: 0, tasksDone: 0, firstDate: dt, lastDate: dt, thisWeekPlanned: 0, thisWeekDone: 0, weeklyMins: {}, nextTask: null };
        courseMap[name].lastDate = dt;
        courseMap[name].tasks++;
        const st = parseTime(t.time), et = parseTime(t.endTime);
        const mins = st && et ? Math.max(0, et.mins - st.mins) : 0;
        courseMap[name].totalMins += mins;
        if (t.done) { courseMap[name].doneMins += mins; courseMap[name].tasksDone++; }
        // Weekly breakdown
        const weekNum = Math.floor(diffDays(planStart, dt) / 7);
        if (!courseMap[name].weeklyMins[weekNum]) courseMap[name].weeklyMins[weekNum] = { planned: 0, done: 0 };
        courseMap[name].weeklyMins[weekNum].planned += mins;
        if (t.done) courseMap[name].weeklyMins[weekNum].done += mins;
        // This week
        const thisWeekNum = Math.floor(diffDays(planStart, today) / 7);
        if (weekNum === thisWeekNum) {
          courseMap[name].thisWeekPlanned += mins;
          if (t.done) courseMap[name].thisWeekDone += mins;
        }
        // Next undone task
        if (!t.done && dt >= today && !courseMap[name].nextTask) {
          courseMap[name].nextTask = { title: t.title, date: dt, time: t.time };
        }
      }
    }
    const items = Object.values(courseMap);
    if (items.length === 0) return null;
    // Compute pace for each course
    const totalWeeks = lastPlan.snapshot ? Math.max(1, Math.ceil(diffDays(planStart, lastPlan.snapshot.targetDate || today) / 7)) : 10;
    const currentWeek = Math.max(1, Math.floor(diffDays(planStart, today) / 7) + 1);
    for (const c of items) {
      c.pct = c.totalMins > 0 ? Math.round((c.doneMins / c.totalMins) * 100) : 0;
      c.remainMins = c.totalMins - c.doneMins;
      const expectedPct = Math.min(100, Math.round((currentWeek / totalWeeks) * 100));
      c.pace = c.pct >= expectedPct + 10 ? 'ahead' : c.pct >= expectedPct - 10 ? 'on-track' : c.pct >= expectedPct - 25 ? 'behind' : 'at-risk';
      if (c.tasks === c.tasksDone && c.tasks > 0) c.pace = 'complete';
      // Color from getCourseColor
      c.color = getCourseColor(c.name + ' - x');
      // Weekly sparkline data (array of { planned, done } for each week)
      c.sparkline = [];
      for (let w = 0; w < totalWeeks; w++) {
        c.sparkline.push(c.weeklyMins[w] || { planned: 0, done: 0 });
      }
    }
    return { items, currentWeek, totalWeeks };
  }, [data.tasks, data.planHistory, courses]);

  // C1: Memoized gap analysis — computed once, not per render
  const gapReport = useMemo(() => analyzeGaps(data), [data.tasks, data.courses, data.plannerConfig, data.exceptionDates, data.studyStartDate, data.targetCompletionDate, data.targetDate, data.lessonPlan, data.scheduleOutline]);

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
    setTimeout(() => genPlan().catch(e => { toast(`Generation failed: ${e.message}`, 'error'); bgSet({ loading: false, label: '' }); }), 100);
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
                {' → '}
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
          <Btn v="ai" onClick={() => setPage('courses')}>First, import your courses {'→'}</Btn>
        </div>
      )}
      {courses.length > 0 && unenrichedCount > 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{unenrichedCount} course{unenrichedCount > 1 ? 's' : ''} need enrichment for better plan quality.</span>
          <Btn small v="ghost" onClick={() => setPage('courses')} style={{ color: T.orange, borderColor: T.orange + '55' }}>Enrich courses {'→'}</Btn>
        </div>
      )}
      {courses.length > 0 && needsHoursCount > 0 && unenrichedCount === 0 && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{needsHoursCount} course{needsHoursCount > 1 ? 's' : ''} need enrichment for accurate hour estimates.</span>
          <Btn small v="ghost" onClick={() => setPage('courses')} style={{ color: T.orange, borderColor: T.orange + '55' }}>Enrich courses {'→'}</Btn>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══ COCKPIT MODE — shown when plan exists and not editing ═══ */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* ═══ QUEUE DASHBOARD (when plan exists) ═══ */}
      {hasPlan && hasQueue && !showSettings && !isGenerating && !pendingPlan && courses.length > 0 && (() => {
        const queue = data.taskQueue || [];
        const studyTasks = queue.filter(t => t.category !== 'break');
        const doneTasks = studyTasks.filter(t => t.done);
        const totalMins = studyTasks.reduce((s, t) => s + (t.estimatedMins || 60), 0);
        const doneMins = doneTasks.reduce((s, t) => s + (t.estimatedMins || 60), 0);
        const remainMins = totalMins - doneMins;
        const pct = totalMins > 0 ? Math.round(doneMins / totalMins * 100) : 0;
        const targetDt = data.targetCompletionDate || data.targetDate || '';
        const daysLeft = targetDt ? Math.max(1, diffDays(todayStr(), targetDt)) : 30;
        const dailyNeedHrs = Math.round(remainMins / daysLeft / 60 * 10) / 10;

        // SPI
        const startDt = data.studyStartDate || todayStr();
        const totalDays = targetDt ? Math.max(1, diffDays(startDt, targetDt)) : 60;
        const elapsed = Math.max(0, diffDays(startDt, todayStr()));
        const expectedMins = totalMins * Math.min(1, elapsed / totalDays);
        const spi = expectedMins > 0 ? doneMins / expectedMins : 1;
        const status = spi >= 1.1 ? 'ahead' : spi >= 0.9 ? 'on-track' : spi >= 0.7 ? 'behind' : 'at-risk';
        const statusColors = { ahead: '#4ecdc4', 'on-track': T.accent, behind: '#f0c674', 'at-risk': T.red };
        const statusLabels = { ahead: 'Ahead of pace', 'on-track': 'On track', behind: 'Slightly behind', 'at-risk': 'At risk' };
        const statusIcons = { ahead: '🚀', 'on-track': '✅', behind: '⏳', 'at-risk': '⚠️' };

        // Per-course progress
        const courseMap = {};
        for (const t of studyTasks) {
          const key = t.course_code || 'Other';
          if (!courseMap[key]) courseMap[key] = { total: 0, done: 0, name: t.course_name || key };
          courseMap[key].total += t.estimatedMins || 60;
          if (t.done) courseMap[key].done += t.estimatedMins || 60;
        }

        return (
          <div style={{ marginBottom: 16 }}>
            {/* Overall progress */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{pct}%</span>
                  <Badge color={statusColors[status]} bg={statusColors[status] + '22'}>{statusIcons[status]} {statusLabels[status]}</Badge>
                </div>
                <Btn small v="ghost" onClick={() => setPage('daily')}>Study Now →</Btn>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: T.input, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: statusColors[status], borderRadius: 3, transition: 'width .3s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fs(10), color: T.dim }}>
                <span>{Math.round(doneMins / 60)}h / {Math.round(totalMins / 60)}h completed</span>
                <span>{doneTasks.length} / {studyTasks.length} tasks</span>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 10 }}>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{daysLeft}</div>
                <div style={{ fontSize: fs(9), color: T.dim }}>days left</div>
              </div>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{dailyNeedHrs}h</div>
                <div style={{ fontSize: fs(9), color: T.dim }}>needed / day</div>
              </div>
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: fs(18), fontWeight: 800, color: T.text }}>{Math.round(remainMins / 60)}h</div>
                <div style={{ fontSize: fs(9), color: T.dim }}>remaining</div>
              </div>
            </div>

            {/* Per-course progress with expandable unit list */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px' }}>
              <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text, marginBottom: 10 }}>Course Progress</div>
              {Object.entries(courseMap).map(([code, c], i) => {
                const cpct = c.total > 0 ? Math.round(c.done / c.total * 100) : 0;
                const color = PLAN_COLORS[i % PLAN_COLORS.length];
                const isExpanded = expandedWeeks[`cp_${code}`];
                // Get lesson plan units for this course
                const lpc = data.lessonPlan?.courses?.find(lc => (lc.course_code || '').toUpperCase().trim() === code.toUpperCase().trim());
                // Get queue tasks for this course
                const courseTasks = queue.filter(t => t.category !== 'break' && (t.course_code || '').toUpperCase().trim() === code.toUpperCase().trim());
                return (
                  <div key={code} style={{ marginBottom: 10 }}>
                    <div onClick={() => setExpandedWeeks(p => ({ ...p, [`cp_${code}`]: !p[`cp_${code}`] }))}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, cursor: 'pointer', padding: '4px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: fs(9), color: T.dim }}>{isExpanded ? '▾' : '▸'}</span>
                        <span style={{ fontSize: fs(11), color: T.text, fontWeight: 600 }}>{code}</span>
                        {lpc && <span style={{ fontSize: fs(9), color: T.soft }}>— {lpc.course_name}</span>}
                      </div>
                      <span style={{ fontSize: fs(9), color: T.dim }}>{cpct}% · {Math.round(c.done / 60)}h / {Math.round(c.total / 60)}h</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: T.input, overflow: 'hidden', marginBottom: isExpanded ? 8 : 0 }}>
                      <div style={{ height: '100%', width: `${cpct}%`, background: color, borderRadius: 2, transition: 'width .3s' }} />
                    </div>
                    {/* Expanded: show lesson plan units + task completion */}
                    {isExpanded && lpc?.units && (
                      <div style={{ marginLeft: 16, borderLeft: `2px solid ${color}33`, paddingLeft: 10 }}>
                        {(lpc.units || []).map((u, ui) => {
                          // Find tasks for this unit
                          const unitTasks = courseTasks.filter(t => t.unitNumber === u.unit_number);
                          const unitDone = unitTasks.length > 0 && unitTasks.every(t => t.done);
                          const unitPartial = unitTasks.some(t => t.done) && !unitDone;
                          return (
                            <div key={u.unit_number} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', opacity: unitDone ? 0.5 : 1 }}>
                              <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace", minWidth: 18 }}>{u.unit_number}</span>
                              <span style={{ fontSize: fs(10), color: unitDone ? T.dim : T.text, textDecoration: unitDone ? 'line-through' : 'none' }}>
                                {unitDone ? '✓ ' : unitPartial ? '◐ ' : ''}{u.title}
                              </span>
                              <span style={{ fontSize: fs(8), color: T.dim, marginLeft: 'auto', flexShrink: 0 }}>{u.hours}h · {u.type}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Btn v="ghost" small onClick={() => setShowSettings(true)}>Regenerate Plan</Btn>
            </div>
          </div>
        );
      })()}

      {/* Legacy plan cockpit (calendar-based plans without queue) */}
      {hasPlan && !hasQueue && !showSettings && !isGenerating && courses.length > 0 && (() => {
        const pp = planProgress;
        if (!pp || pp.totalTasks === 0) return (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '20px 24px', marginBottom: 16, textAlign: 'center' }}>
            <div style={{ fontSize: fs(14), color: T.dim, marginBottom: 12 }}>No active study plan. Generate one to get started.</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Btn v="ai" onClick={() => setShowSettings(true)}>Create a New Plan</Btn>
            </div>
          </div>
        );
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

            {/* ── Plan Health (Gap Analysis) — C1: uses memoized gapReport ── */}
            {gapReport.hasIssues && (() => {
              const gaps = gapReport;
              const severityColor = gaps.severity === 'critical' ? T.red : gaps.severity === 'high' ? T.orange : '#f0c674';
              return (
                <div style={{ padding: '12px 16px', borderRadius: 10, background: `${severityColor}11`, border: `1px solid ${severityColor}33`, marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: fs(12), fontWeight: 700, color: severityColor, marginBottom: 4 }}>
                        {gaps.severity === 'critical' ? 'Plan has critical gaps' : gaps.severity === 'high' ? 'Plan needs attention' : 'Minor gaps found'}
                      </div>
                      <div style={{ fontSize: fs(11), color: T.soft, lineHeight: 1.5 }}>
                        {gaps.emptyDays.length > 0 && <div>{gaps.emptyDays.length} empty study day{gaps.emptyDays.length !== 1 ? 's' : ''} <span style={{ fontSize: fs(9), color: T.dim }}>({gaps.emptyDays.slice(0, 5).map(d => new Date(d.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(', ')}{gaps.emptyDays.length > 5 ? `, +${gaps.emptyDays.length - 5} more` : ''})</span></div>}
                        {gaps.partialDays.length > 0 && <div>{gaps.partialDays.length} partially filled day{gaps.partialDays.length !== 1 ? 's' : ''} ({gaps.totalGapHours}h unscheduled)</div>}
                        {gaps.missingCourses.length > 0 && <div style={{ color: T.red }}>{gaps.missingCourses.map(c => c.courseCode || c.name).join(', ')} — no tasks at all</div>}
                        {gaps.totalUncoveredUnits > 0 && <div>{gaps.totalUncoveredUnits} topic{gaps.totalUncoveredUnits !== 1 ? 's' : ''} not yet scheduled</div>}
                        {gaps.totalMissingPhases > 0 && <div>{gaps.totalMissingPhases} missing phase{gaps.totalMissingPhases !== 1 ? 's' : ''} (review/exam-prep)</div>}
                        <div style={{ fontSize: fs(10), color: T.dim, marginTop: 2 }}>{Math.round(gaps.totalScheduledHours)}h of {gaps.totalEstHours}h estimated study time is scheduled ({gaps.coveragePct}% coverage)</div>
                      </div>
                    </div>
                    <Btn small v="ai" onClick={async () => {
                      if (!profile) { toast('Connect an AI provider first', 'warn'); return; }
                      // Fill gaps using the 3-step generation loop for gap weeks only
                      bgSet({ loading: true, label: 'Filling calendar gaps...', logs: [{ type: 'user', content: `Scanning ${gaps.dayGaps.length} gap days across your plan...` }] });
                      const abortCtrl = new AbortController();
                      bgSet({ outerAbortCtrl: abortCtrl, abortCtrl });
                      try {
                        const capturedTasks = [];
                        const seenIds = new Set();
                        let failedWeeks = 0;
                        const planId = `gap_${Date.now()}`;
                        const noTools = !!getProviderQuirks(profile).noToolSupport;
                        const baseSys = buildSystemPrompt(data, '');

                        // Group gaps by week
                        const weekGroups = {};
                        for (const g of gaps.dayGaps) {
                          const weekStart = new Date(g.date + 'T12:00:00');
                          weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
                          const ws = weekStart.toISOString().split('T')[0];
                          if (!weekGroups[ws]) weekGroups[ws] = [];
                          weekGroups[ws].push(g);
                        }

                        for (const [ws, weekGaps] of Object.entries(weekGroups)) {
                          if (abortCtrl.signal.aborted) break;
                          const weekDates = weekGaps.map(g => g.date);
                          const we = weekDates[weekDates.length - 1];
                          bgLog({ type: 'user', content: `Filling ${weekGaps.length} gap day(s): ${ws} - ${we}` });

                          const gapPrompt = buildGapFillPrompt(gaps, weekDates, data);
                          if (!gapPrompt) continue;

                          const sys = baseSys + `\nCONTEXT: Fill calendar gaps for ${ws} to ${we}. Use generate_study_plan.`;
                          const toolInstruction = noTools
                            ? `OUTPUT: Respond with ONLY JSON: {"daily_tasks":[{"date":"YYYY-MM-DD","time":"HH:MM","endTime":"HH:MM","title":"CourseCode - Topic","category":"study","priority":"medium","notes":"..."}]}`
                            : `Call generate_study_plan with tasks for the gap days. No prose — just the tool call.`;

                          const msg = `${toolInstruction}\n\n${gapPrompt}`;
                          const planTools = noTools ? null : TOOLS.filter(t => t.name === 'generate_study_plan');
                          const isThinking = (profile.model || '').match(/thinking|think|r1\b|qwq|reasoner|glm-5\.1/i);
                          const maxTok = isThinking ? 32768 : 16384;

                          // C5: Retry with backoff
                          let retries = 0;
                          let weekSuccess = false;
                          while (retries < 2 && !weekSuccess) {
                            try {
                              let gapSnapshot = { ...data };
                              const { logs: wLogs } = await runAILoop(profile, sys, [{ role: 'user', content: msg }], data, (fn) => {
                                // C2: Accumulate tasks WITHOUT writing to data.tasks
                                // Tasks only commit when user confirms the pendingPlan
                                const next = typeof fn === 'function' ? fn(gapSnapshot) : fn;
                                if (next.tasks) {
                                  for (const [dt, dayTasks] of Object.entries(next.tasks)) {
                                    const old = gapSnapshot.tasks?.[dt] || [];
                                    for (const t of safeArr(dayTasks)) {
                                      if (!old.some(o => o.id === t.id)) {
                                        // H8: Validate date is in requested gap dates
                                        if (!weekDates.includes(dt)) continue;
                                        // H6: Content dedup — check existing tasks by title+time
                                        const existingOnDay = (data.tasks?.[dt] || []);
                                        const isDup = existingOnDay.some(ex => ex.title === t.title && ex.time === (t.time || ''));
                                        if (isDup) continue;
                                        const { courseId: cid } = matchTaskToCourse(t.title, courses, t.category);
                                        const key = `${t.title}|${dt}|${t.time}`;
                                        if (!seenIds.has(key)) {
                                          seenIds.add(key);
                                          capturedTasks.push({ ...t, planId, courseId: cid, date: dt });
                                        }
                                      }
                                    }
                                  }
                                }
                                gapSnapshot = next;
                                // C2: Do NOT call setData here — tasks stay in capturedTasks only
                              }, executeTools, null, true, 1, maxTok, planTools);
                              for (const l of wLogs) bgLog(l);
                              bgLog({ type: 'text', content: `Filled: ${capturedTasks.filter(t => weekDates.includes(t.date)).length} tasks for this week` });
                              weekSuccess = true;
                            } catch (e) {
                              retries++;
                              if (retries < 2) {
                                bgLog({ type: 'warn', content: `Week failed, retrying (${retries}/2)...` });
                                await new Promise(r => setTimeout(r, 3000 * retries)); // Backoff
                              } else {
                                failedWeeks++;
                                bgLog({ type: 'error', content: `Gap fill failed after ${retries} retries: ${e.message}` });
                              }
                            }
                          }
                        }

                        if (capturedTasks.length > 0) {
                          // H1: Create planHistory entry for gap fill
                          setData(d => ({
                            ...d,
                            planHistory: [...(d.planHistory || []), {
                              planId, createdAt: new Date().toISOString(), type: 'gap_fill',
                              snapshot: { courseCount: courses.length, gapDays: gaps.dayGaps.length, taskCount: capturedTasks.length },
                              plannedHours: Math.round(capturedTasks.reduce((s, t) => { const st = parseTime(t.time), et = parseTime(t.endTime); return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0); }, 0)),
                              taskCount: capturedTasks.length,
                            }],
                          }));
                          setPendingPlan({ planId, tasks: capturedTasks, summary: `Gap fill: ${capturedTasks.length} tasks across ${[...new Set(capturedTasks.map(t => t.date))].length} days` });
                          // C5: Report both successes and failures
                          const msg = failedWeeks > 0
                            ? `Gap fill: ${capturedTasks.length} tasks ready. ${failedWeeks} week(s) failed — run again to retry.`
                            : `Gap fill: ${capturedTasks.length} tasks ready for review`;
                          toast(msg, failedWeeks > 0 ? 'warn' : 'success');
                        } else {
                          toast(failedWeeks > 0 ? `Gap fill failed for all weeks. Try a different AI model.` : 'No gap-fill tasks generated', failedWeeks > 0 ? 'error' : 'info');
                        }
                      } finally {
                        bgSet({ loading: false, label: '', abortCtrl: null, outerAbortCtrl: null });
                      }
                    }} style={{ flexShrink: 0 }}>Fill Gaps</Btn>
                  </div>
                </div>
              );
            })()}

            {/* ── Quick Actions ── */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
              <Btn small v="secondary" onClick={missedToday}>{'\u23E9'} I missed today</Btn>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Btn small v="secondary" onClick={() => {
                  const futureCount = Object.entries(data.tasks || {}).reduce((s, [dt, ts]) => dt > todayStr() ? s + ts.length : s, 0);
                  setConfirmDialog({
                    message: `Shift ${futureCount} future tasks forward by ${shiftDays} day${shiftDays > 1 ? 's' : ''}?`,
                    onConfirm: () => { setConfirmDialog(null); shiftRemainingTasks(); },
                  });
                }}>{'\u21B7'} Shift remaining +{shiftDays}d</Btn>
                <select value={shiftDays} onChange={e => setShiftDays(Number(e.target.value))} style={{ padding: '4px 6px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text, fontSize: fs(10) }}>
                  {[1, 2, 3, 5, 7].map(d => <option key={d} value={d}>{d}d</option>)}
                </select>
              </div>
              <Btn small v="secondary" onClick={() => setShowSettings(true)}>{'\u2699'} Adjust Schedule</Btn>
              <Btn small v="secondary" onClick={replanFromToday}>{'\u21BB'} Replan from today</Btn>
              <Btn small v="secondary" onClick={exportToCalendar}>{'\uD83D\uDCC5'} Export to Calendar</Btn>
              <Btn small v="ghost" onClick={() => { setShowSettings(true); setTimeout(() => genPlan().catch(e => { toast(`Generation failed: ${e.message}`, 'error'); bgSet({ loading: false, label: '' }); }), 100); }}>Regenerate Plan</Btn>
            </div>

            {/* ── Course Progress Tracker ── */}
            {courseProgress && (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>Course Progress</div>
                  <span style={{ fontSize: fs(10), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>Week {courseProgress.currentWeek} of {courseProgress.totalWeeks}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {courseProgress.items.map(c => {
                    const isExpanded = expandedCourse === c.name;
                    const paceColor = c.pace === 'complete' ? T.accent : c.pace === 'ahead' ? T.accent : c.pace === 'on-track' ? T.blue || T.accent : c.pace === 'behind' ? T.orange : T.red;
                    const paceLabel = c.pace === 'complete' ? 'Complete' : c.pace === 'ahead' ? 'Ahead' : c.pace === 'on-track' ? 'On Track' : c.pace === 'behind' ? 'Behind' : 'At Risk';
                    const totalHrs = Math.round(c.totalMins / 60 * 10) / 10;
                    const doneHrs = Math.round(c.doneMins / 60 * 10) / 10;
                    const remainHrs = Math.round(c.remainMins / 60 * 10) / 10;
                    const thisWeekHrs = Math.round(c.thisWeekPlanned / 60 * 10) / 10;
                    const thisWeekDoneHrs = Math.round(c.thisWeekDone / 60 * 10) / 10;
                    return (
                      <div key={c.name}>
                        <div onClick={() => setExpandedCourse(isExpanded ? null : c.name)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, background: isExpanded ? `${c.color}11` : T.input, border: `1px solid ${isExpanded ? c.color + '33' : 'transparent'}`, cursor: 'pointer', transition: 'all .15s' }}
                          role="button" aria-expanded={isExpanded} aria-label={`${c.name}: ${c.pct}% complete, ${remainHrs} hours remaining, ${paceLabel}`}>
                          {/* Color dot */}
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0 }} />
                          {/* Name */}
                          <div style={{ width: 80, fontSize: fs(11), fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>{c.name}</div>
                          {/* Progress bar + % */}
                          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ flex: 1, height: 8, borderRadius: 4, background: T.panel, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${c.pct}%`, borderRadius: 4, background: `linear-gradient(90deg, ${c.color}, ${c.color}cc)`, transition: 'width .4s ease' }} />
                            </div>
                            <span style={{ fontSize: fs(10), fontWeight: 700, color: c.pct >= 80 ? T.accent : T.text, minWidth: 28, textAlign: 'right' }}>{c.pct}%</span>
                          </div>
                          {/* This week */}
                          <div style={{ minWidth: 55, textAlign: 'right', fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
                            {thisWeekHrs > 0 ? `${thisWeekDoneHrs}/${thisWeekHrs}h` : '\u2014'}
                          </div>
                          {/* Pace badge */}
                          <div style={{ padding: '2px 8px', borderRadius: 10, background: paceColor + '22', color: paceColor, fontSize: fs(8), fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>{paceLabel}</div>
                        </div>

                        {/* Expanded detail */}
                        {isExpanded && (
                          <div style={{ padding: '8px 10px 10px 28px', animation: 'planFadeIn .2s ease' }}>
                            {/* Stats row */}
                            <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: fs(9), color: T.soft }}>
                              <span><span style={{ fontWeight: 700, color: T.text }}>{doneHrs}h</span> done</span>
                              <span><span style={{ fontWeight: 700, color: T.text }}>{remainHrs}h</span> left</span>
                              <span><span style={{ fontWeight: 700, color: T.text }}>{c.tasksDone}/{c.tasks}</span> tasks</span>
                            </div>
                            {/* Weekly sparkline */}
                            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 32, marginBottom: 6 }}>
                              {c.sparkline.map((w, wi) => {
                                const maxMins = Math.max(...c.sparkline.map(s => s.planned), 1);
                                const plannedH = Math.max(2, (w.planned / maxMins) * 28);
                                const doneH = w.planned > 0 ? (w.done / w.planned) * plannedH : 0;
                                const isCurrent = wi + 1 === courseProgress.currentWeek;
                                return (
                                  <div key={wi} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }} title={`W${wi + 1}: ${Math.round(w.done / 60 * 10) / 10}/${Math.round(w.planned / 60 * 10) / 10}h`}>
                                    <div style={{ width: '100%', position: 'relative', height: plannedH, borderRadius: 2 }}>
                                      {/* Planned (outline) */}
                                      <div style={{ position: 'absolute', inset: 0, borderRadius: 2, border: `1px solid ${c.color}44`, background: `${c.color}11` }} />
                                      {/* Done (fill from bottom) */}
                                      {doneH > 0 && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: doneH, borderRadius: 2, background: c.color, opacity: 0.7 }} />}
                                    </div>
                                    <span style={{ fontSize: 7, color: isCurrent ? T.accent : T.dim, fontWeight: isCurrent ? 700 : 400 }}>{wi + 1}</span>
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: 8, fontSize: fs(8), color: T.dim, marginBottom: 6 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 8, height: 8, border: `1px solid ${c.color}44`, borderRadius: 1, background: `${c.color}11` }} /> planned</span>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 8, height: 8, borderRadius: 1, background: c.color, opacity: 0.7 }} /> done</span>
                            </div>
                            {/* Next task */}
                            {c.nextTask && (
                              <div onClick={() => setPage('daily')} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, background: T.input, cursor: 'pointer', fontSize: fs(9) }}>
                                <span style={{ color: T.dim }}>Next:</span>
                                <span style={{ color: T.blue, fontFamily: "'JetBrains Mono',monospace" }}>{c.nextTask.time || ''}</span>
                                <span style={{ color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nextTask.title}</span>
                                <span style={{ color: T.dim }}>{c.nextTask.date === todayStr() ? 'Today' : new Date(c.nextTask.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
                              </div>
                            )}
                            {/* P4: Course completion detection */}
                            {c.pace === 'complete' && (() => {
                              const courseObj = courses.find(co => (co.courseCode || co.name) === c.name);
                              if (!courseObj || courseObj.status === 'completed') return null;
                              return (
                                <div style={{ marginTop: 6, padding: '6px 10px', borderRadius: 6, background: T.accentD, border: `1px solid ${T.accent}33`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: fs(9), color: T.accent }}>All study tasks complete!</span>
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <Btn small v="ai" onClick={() => {
                                      // Mark course complete + cleanup future tasks + rebalance
                                      const { tasks: cleaned } = removeFutureCourseTasks(data.tasks, courseObj, courses);
                                      setData(d => ({
                                        ...d,
                                        tasks: cleaned,
                                        courses: d.courses.map(co => co.id === courseObj.id ? { ...co, status: 'completed', lastUpdated: new Date().toISOString() } : co),
                                      }));
                                      // Course marked complete — future tasks cleaned above
                                      toast(`${c.name} marked complete! Plan updated.`, 'success');
                                    }}>Passed — Mark Complete</Btn>
                                    <Btn small v="ghost" onClick={() => toast('Continue studying until you feel ready.', 'info')}>Need More Time</Btn>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Pace Banner (Ahead/Behind Detection) ── */}
            {/* ── Pace Banner (weekly ahead/behind detection) ── */}
            {planProgress && (() => {
              const pp = planProgress;
              if (!pp || pp.weekPlannedHrs <= 0) return null;
              const aheadPct = pp.weekPlannedHrs > 0 ? pp.weekDoneHrs / pp.weekPlannedHrs : 0;
              const isAhead = aheadPct >= 1.15;
              const isBehindMild = aheadPct < 0.70 && aheadPct > 0;
              const isBehindCritical = aheadPct < 0.50 && aheadPct > 0;
              if (!isAhead && !isBehindMild) return null;
              const weekDoneHrs = pp.weekDoneHrs;
              const weekPlannedHrs = pp.weekPlannedHrs;

              return (
                <div style={{ padding: '10px 14px', borderRadius: 10, background: isAhead ? T.accentD : T.orangeD, border: `1px solid ${isAhead ? T.accent : T.orange}33`, fontSize: fs(11), color: isAhead ? T.accent : T.orange, marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      {isAhead && `You're ahead this week (${Math.round(weekDoneHrs)}h done of ${Math.round(weekPlannedHrs)}h planned). Advance your plan to start the next course sooner?`}
                      {isBehindCritical && `You're significantly behind this week (${Math.round(weekDoneHrs)}h of ${Math.round(weekPlannedHrs)}h). Consider adjusting your plan to spread remaining work over more weeks.`}
                      {isBehindMild && !isBehindCritical && `You're a bit behind this week (${Math.round(weekDoneHrs)}h of ${Math.round(weekPlannedHrs)}h). You can catch up or adjust the plan.`}
                    </span>
                    <Btn small v={isAhead ? 'ai' : 'secondary'} onClick={() => { setShowSettings(true); toast(isAhead ? 'You can regenerate to advance your schedule.' : 'Adjust your schedule or regenerate.', 'info'); }} style={{ flexShrink: 0, marginLeft: 8 }}>
                      {isAhead ? 'Adjust Schedule' : 'Adjust Plan'}
                    </Btn>
                  </div>
                </div>
              );
            })()}

            {/* ── Next Up ── */}
            {nextUpTasks.length > 0 && (
              <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>Next Up</div>
                  <Btn small v="ghost" onClick={() => setPage('daily')}>View today {'→'}</Btn>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {nextUpTasks.map((t, i) => (
                    <div key={i} onClick={() => { setData(d => d); setPage('daily'); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: i === 0 ? T.accentD : T.input, cursor: 'pointer', border: i === 0 ? `1px solid ${T.accent}33` : '1px solid transparent' }}>
                      <span style={{ fontSize: fs(9), color: T.dim, minWidth: 60, fontFamily: "'JetBrains Mono',monospace" }}>{t.date === todayStr() ? 'Today' : new Date(t.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span style={{ fontSize: fs(10), color: T.blue, minWidth: 40, fontFamily: "'JetBrains Mono',monospace" }}>{t.time || ''}</span>
                      <span style={{ flex: 1, fontSize: fs(11), color: i === 0 ? T.accent : T.text, fontWeight: i === 0 ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      {t.endTime && <span style={{ fontSize: fs(9), color: T.dim }}>{'→'} {t.endTime}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Feasibility check — explains whether the schedule is realistic */}
            {hasSettings && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: `${feasibilityColor}11`, border: `1px solid ${feasibilityColor}33`, fontSize: fs(11), color: feasibilityColor, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, lineHeight: 1.5 }}>
                <span style={{ fontSize: fs(14), flexShrink: 0 }}>{feasibilityLevel === 'green' ? '\u2705' : feasibilityLevel === 'yellow' ? '\u26A0\uFE0F' : '\u274C'}</span>
                <span>
                  {feasibilityLevel === 'green'
                    ? `Your schedule looks good! ${totalEstHours}h of coursework across ${activeCourses.length} course${activeCourses.length !== 1 ? 's' : ''}, at ~${Math.round(hrsPerDay * 10) / 10}h/day.${finishVsGoal != null && finishVsGoal > 0 ? ` You should finish about ${finishVsGoal} days before your deadline.` : ''}${bufferDays != null && bufferDays > 0 ? ` That gives you ${bufferDays} days of buffer for unexpected interruptions.` : ''}`
                    : feasibilityLevel === 'yellow'
                      ? `This schedule is tight but possible. You${'\u2019'}ll need about ${minHrsPerDay}h of study per day${utilizationPct != null ? ` (using ${utilizationPct}% of your available time)` : ''}. If you miss a few days, you may fall behind. Consider adding more study windows or pushing your deadline back a bit.`
                      : `This schedule doesn${'\u2019'}t have enough time. ${minHrsPerDay != null ? `You${'\u2019'}d need ${minHrsPerDay}h/day, which isn${'\u2019'}t sustainable.` : 'There are no study days available.'} Try: moving your target date later, adding more study time to your weekly schedule, or reducing the number of courses.`
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
          {!hasPlan && !showAdvanced && !pendingPlan && (
            <div style={{ background: T.card, border: `1px solid ${T.accent}33`, borderRadius: 12, padding: '20px 24px', marginBottom: 16 }}>
              <div style={{ fontSize: fs(15), fontWeight: 700, color: T.text, marginBottom: 4 }}>
                {activeCourses.length} course{activeCourses.length !== 1 ? 's' : ''}, ~{totalEstHours}h total. Let{'\u2019'}s build your study plan.
              </div>
              <div style={{ fontSize: fs(11), color: T.dim, marginBottom: 16 }}>Pick your situation, set a deadline, and we{'\u2019'}ll generate a personalized schedule.</div>

              {/* Template pills */}
              <Label>What does your week look like?</Label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                {LIFE_TEMPLATE_IDS.map(id => {
                  const tpl = LIFE_TEMPLATES[id];
                  const isActive = pc?.lifeTemplate === id;
                  return (
                    <button key={id} onClick={() => applyTemplate(id)} title={tpl.description}
                      style={{ padding: '6px 14px', borderRadius: 20, border: `1.5px solid ${isActive ? T.accent : T.border}`, background: isActive ? T.accentD : T.input, cursor: 'pointer', fontSize: fs(11), fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.soft, transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 5 }}
                      onMouseEnter={e => { if (!isActive) { e.currentTarget.style.borderColor = T.accent + '66'; e.currentTarget.style.color = T.text; } }}
                      onMouseLeave={e => { if (!isActive) { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.color = T.soft; } }}>
                      <span style={{ fontSize: fs(13) }}>{tpl.icon}</span>
                      {tpl.label}
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
                  <Label>Start date</Label>
                  <BufferedInput type="date" value={data.studyStartDate || autoStart} onCommit={v => setData(d => ({ ...d, studyStartDate: v }))} />
                </div>
                <div>
                  <Label>When do you need to finish?</Label>
                  <BufferedInput type="date" value={data.targetCompletionDate || autoTarget} onCommit={v => setData(d => ({ ...d, targetCompletionDate: v }))} />
                  {data.universityProfile?.name && <div style={{ fontSize: fs(9), color: T.dim, marginTop: 4 }}>Auto-set from {data.universityProfile.name} term</div>}
                </div>
              </div>

              {/* Schedule analysis — multi-line with context-aware notices */}
              <div style={{ padding: '12px 14px', borderRadius: 10, background: `${feasibilityColor}11`, border: `1px solid ${feasibilityColor}33`, marginBottom: 12, lineHeight: 1.6 }}>
                {/* Main status line */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ fontSize: fs(14), flexShrink: 0 }}>{feasibilityLevel === 'green' ? '\u2705' : feasibilityLevel === 'yellow' ? '\u26A0\uFE0F' : '\u274C'}</span>
                  <span style={{ fontSize: fs(12), fontWeight: 700, color: feasibilityColor }}>
                    {feasibilityLevel === 'green' ? 'Your schedule looks good!'
                      : feasibilityLevel === 'yellow' ? 'This schedule is doable, but tight.'
                      : 'This schedule needs adjusting.'}
                  </span>
                </div>
                {/* Stats grid */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8, paddingLeft: 22 }}>
                  <div style={{ fontSize: fs(10), color: T.soft }}>
                    <span style={{ fontWeight: 600, color: T.text }}>{Math.round(weeklyHours)}h</span>/week
                  </div>
                  <div style={{ fontSize: fs(10), color: T.soft }}>
                    <span style={{ fontWeight: 600, color: T.text }}>~{Math.round(hrsPerDay * 10) / 10}h</span>/day avg
                  </div>
                  <div style={{ fontSize: fs(10), color: T.soft }}>
                    <span style={{ fontWeight: 600, color: T.text }}>{studyDaysPerWeek}</span> study days/week
                  </div>
                  {estCompletionDate && (
                    <div style={{ fontSize: fs(10), color: T.soft }}>
                      Est. finish: <span style={{ fontWeight: 600, color: finishColor }}>{new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  )}
                  {finishDelta != null && (
                    <div style={{ fontSize: fs(10), color: finishDelta > 7 ? T.accent : finishDelta >= 0 ? T.orange : T.red }}>
                      {finishDelta > 0 ? `${finishDelta}d before deadline` : finishDelta === 0 ? 'Right on deadline' : `${Math.abs(finishDelta)}d past deadline`}
                    </div>
                  )}
                </div>
                {/* Contextual notices */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 22 }}>
                  {feasibilityLevel === 'green' && finishDelta != null && finishDelta > 14 && (
                    <div style={{ fontSize: fs(10), color: T.accent }}>{'\u2713'} You have {finishDelta} days of buffer before your deadline {'\u2014'} room for sick days, breaks, or getting ahead.</div>
                  )}
                  {feasibilityLevel === 'green' && finishDelta != null && finishDelta > 0 && finishDelta <= 14 && (
                    <div style={{ fontSize: fs(10), color: T.soft }}>{'\u2713'} On track with {finishDelta} day{finishDelta !== 1 ? 's' : ''} of buffer. Try to stay consistent to keep this margin.</div>
                  )}
                  {hrsPerDay >= 2 && hrsPerDay <= 4 && (
                    <div style={{ fontSize: fs(10), color: T.soft }}>{'\u2139\uFE0F'} ~{Math.round(hrsPerDay * 10) / 10}h/day is a light pace {'\u2014'} sustainable for most schedules.</div>
                  )}
                  {hrsPerDay > 4 && hrsPerDay <= 6 && (
                    <div style={{ fontSize: fs(10), color: T.soft }}>{'\u2139\uFE0F'} ~{Math.round(hrsPerDay * 10) / 10}h/day is a solid pace. Most working students can maintain this.</div>
                  )}
                  {hrsPerDay > 6 && hrsPerDay <= 10 && (
                    <div style={{ fontSize: fs(10), color: T.orange }}>{'\u26A0\uFE0F'} ~{Math.round(hrsPerDay * 10) / 10}h/day is a heavy load. Build in breaks and at least one rest day per week.</div>
                  )}
                  {hrsPerDay > 10 && (
                    <div style={{ fontSize: fs(10), color: T.red }}>{'\u274C'} ~{Math.round(hrsPerDay * 10) / 10}h/day is not sustainable long-term. Extend your deadline or reduce your course load.</div>
                  )}
                  {weeklyHours > 0 && weeklyHours < 10 && totalEstHours > 50 && (
                    <div style={{ fontSize: fs(10), color: T.orange }}>{'\u26A0\uFE0F'} {Math.round(weeklyHours)}h/week is light for {totalEstHours}h of coursework. Add more study windows to finish sooner.</div>
                  )}
                  {studyDaysPerWeek <= 3 && studyDaysPerWeek > 0 && totalEstHours > 50 && (
                    <div style={{ fontSize: fs(10), color: T.soft }}>{'\u2139\uFE0F'} Studying {studyDaysPerWeek} day{studyDaysPerWeek !== 1 ? 's' : ''} per week means longer sessions on those days. Consider spreading across more days.</div>
                  )}
                  {utilizationPct != null && utilizationPct > 90 && (
                    <div style={{ fontSize: fs(10), color: T.orange }}>{'\u26A0\uFE0F'} Your coursework needs {utilizationPct}% of your scheduled study time. If you miss a session, it{'\u2019'}ll be hard to catch up. Extend your deadline or add more study windows for breathing room.</div>
                  )}
                  {feasibilityLevel === 'red' && (
                    <div style={{ fontSize: fs(10), color: T.red }}>Fix by: (1) moving your finish date later, (2) adding more study windows above, or (3) reducing courses this term.</div>
                  )}
                </div>
                {/* Mini stat cards */}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1, padding: '6px 10px', background: T.input, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: fs(14), fontWeight: 700, color: T.blue || T.accent }}>{Math.round(weeklyHours)}h</div>
                    <div style={{ fontSize: fs(9), color: T.dim }}>weekly pace</div>
                  </div>
                  <div style={{ flex: 1, padding: '6px 10px', background: T.input, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: fs(14), fontWeight: 700, color: finishColor }}>{estCompletionDate ? new Date(estCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}</div>
                    <div style={{ fontSize: fs(9), color: T.dim }}>est. finish</div>
                  </div>
                  <div style={{ flex: 1, padding: '6px 10px', background: T.input, borderRadius: 6, textAlign: 'center' }}>
                    <div style={{ fontSize: fs(14), fontWeight: 700, color: !feasible ? T.red : minHrsPerDay > 6 ? T.orange : T.accent }}>{minHrsPerDay != null ? `${minHrsPerDay}h` : '\u2014'}</div>
                    <div style={{ fontSize: fs(9), color: T.dim }}>daily need</div>
                  </div>
                </div>
              </div>

              {/* Study Preferences */}
              <div style={{ marginBottom: 12, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 10 }}>Study Preferences</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {/* Exam day strategy */}
                  <div>
                    <Label>Day before an exam</Label>
                    <select value={pc?.examDayStrategy || 'light-review'} onChange={e => setPc({ examDayStrategy: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: fs(11), borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                      <option value="light-review">Light review only (recommended)</option>
                      <option value="no-study">No study — rest day</option>
                      <option value="normal">Study as normal</option>
                      <option value="intensive-review">Intensive review / cram</option>
                    </select>
                  </div>
                  {/* Hard material timing */}
                  <div>
                    <Label>Hardest material when?</Label>
                    <select value={pc?.hardMaterialTiming || 'first-session'} onChange={e => setPc({ hardMaterialTiming: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: fs(11), borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                      <option value="first-session">First study window (freshest)</option>
                      <option value="middle-session">Middle window (after warm-up)</option>
                      <option value="last-session">Last study window</option>
                      <option value="no-preference">No preference</option>
                    </select>
                  </div>
                  {/* Weekend intensity */}
                  <div>
                    <Label>Weekend study</Label>
                    <select value={pc?.weekendIntensity || 'same'} onChange={e => setPc({ weekendIntensity: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: fs(11), borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                      <option value="same">Same as weekdays</option>
                      <option value="lighter">Lighter (review & catch-up)</option>
                      <option value="heavier">Heavier (make up for weekdays)</option>
                      <option value="off">Off — no study</option>
                    </select>
                  </div>
                  {/* Per-course exam dates */}
                  <div>
                    <Label>Exam dates known?</Label>
                    <select value={pc?.examDateMode || 'none'} onChange={e => setPc({ examDateMode: e.target.value })}
                      style={{ width: '100%', padding: '6px 10px', fontSize: fs(11), borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                      <option value="none">No fixed exam dates</option>
                      <option value="end-of-course">Exams at end of each course</option>
                      <option value="custom">I'll specify in notes below</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Additional context */}
              <div style={{ marginBottom: 12 }}>
                <Label>Notes for your plan</Label>
                <textarea value={planPrompt} onChange={e => setPlanPrompt(e.target.value)} disabled={isBusy} placeholder={'e.g. "I have a work trip Mar 28-30", "Focus on networking courses first", or exam dates like "C850 exam on Apr 15"'} style={{ minHeight: 50, fontSize: fs(11), opacity: isBusy ? 0.4 : 1, border: `1px solid ${T.border}`, background: T.input, borderRadius: 8, padding: '10px 12px', width: '100%', resize: 'vertical' }} />
              </div>

              {/* Generate */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Btn v="ai" style={{ flex: 1, justifyContent: 'center', padding: '14px 24px', fontSize: fs(14) }} onClick={async () => {
                  // Auto-save dates and config synchronously
                  setData(d => {
                    const updated = { ...d };
                    if (!d.studyStartDate) updated.studyStartDate = autoStart;
                    if (!d.targetCompletionDate && !d.targetDate) updated.targetCompletionDate = autoTarget;
                    if (!d.plannerConfig) updated.plannerConfig = migrateToPlannerConfig(updated);
                    return updated;
                  });
                  // Small delay for state to flush, then generate
                  await new Promise(r => setTimeout(r, 100));
                  try {
                    await genPlan();
                  } catch (e) {
                    toast(`Generation failed: ${e.message}`, 'error');
                    dlog('error', 'planner', 'genPlan error', e.message);
                    bgSet({ loading: false, label: '' });
                  }
                }} disabled={bg.loading || !profile || activeCourses.length === 0}>
                  {bg.loading ? <><Ic.Spin s={14} /> Generating...</> : 'Generate Study Plan'}
                </Btn>
              </div>

              {/* Generation progress — always visible when generating */}
              {bg.loading && (
                <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 10, background: `linear-gradient(135deg, ${T.purpleD}, ${T.accentD})`, border: `1px solid ${T.purple}44` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Ic.Spin s={16} />
                      <span style={{ fontSize: fs(13), fontWeight: 700, color: T.purple }}>{bg.label || 'Working...'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: fs(10), color: T.dim, fontFamily: "'JetBrains Mono', monospace" }}><ElapsedTimer /></span>
                      <Btn small v="ghost" onClick={cancelGeneration} style={{ color: T.red, borderColor: T.red }}>Stop</Btn>
                    </div>
                  </div>
                  {bg.streamText && (
                    <div style={{ padding: '6px 10px', borderRadius: 7, background: T.purpleD, border: `1px solid ${T.purple}33`, fontSize: fs(11), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto', marginBottom: 6 }}>{bg.streamText}</div>
                  )}
                  {bg.logs.length > 0 && (
                    <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {bg.logs.slice(-12).map((l, i) => <LogLine key={i} l={l} />)}
                    </div>
                  )}
                  {/* Debug footer */}
                  {bg.logs.length > 0 && (() => {
                    const totalChars = bg.logs.reduce((s, l) => s + (l.content || '').length, 0) + (bg.streamText || '').length;
                    const estTokens = Math.round(totalChars / 4);
                    return (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono', monospace" }}>
                        <span>{bg.logs.length} events {'\u00B7'} {profile?.name || '?'} ({profile?.model || '?'})</span>
                        <span>~{estTokens > 1000 ? `${(estTokens / 1000).toFixed(1)}K` : estTokens} tokens</span>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── Full Settings Panel (advanced mode or editing existing) ── */}
          {(showAdvanced || hasPlan || pendingPlan) && (
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
                          {exceptionDates.length > 0 && <Btn small v="ghost" onClick={() => { setConfirmDialog({ message: `Clear all ${exceptionDates.length} exception dates?`, onConfirm: () => { setConfirmDialog(null); setData(d => ({ ...d, exceptionDates: [] })); } }); }}>Clear All</Btn>}
                        </div>
                        {exceptionDates.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxHeight: 100, overflowY: 'auto' }}>{exceptionDates.map(dt => <div key={dt} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '3px 9px', borderRadius: 5, background: T.orangeD, fontSize: fs(10), color: T.orange }}>{new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}<button onClick={() => removeExDate(dt)} style={{ background: 'none', border: 'none', color: T.orange, cursor: 'pointer', fontSize: fs(12), padding: 0 }}>{'\u00D7'}</button></div>)}</div>}
                      </div>
                    )}
                  </div>
                )}

                {/* Study Preferences (advanced panel) */}
                {pc && (
                  <div style={{ marginTop: 14, marginBottom: 14 }}>
                    <Label>Study Preferences</Label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, background: T.panel, borderRadius: 8, padding: '10px 12px', border: `1px solid ${T.border}` }}>
                      <div>
                        <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 3, fontWeight: 600 }}>Day before exam</div>
                        <select value={pc.examDayStrategy || 'light-review'} onChange={e => setPc({ examDayStrategy: e.target.value })}
                          style={{ width: '100%', padding: '5px 8px', fontSize: fs(10), borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                          <option value="light-review">Light review only</option>
                          <option value="no-study">No study — rest</option>
                          <option value="normal">Study as normal</option>
                          <option value="intensive-review">Intensive review</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 3, fontWeight: 600 }}>Hard material when?</div>
                        <select value={pc.hardMaterialTiming || 'first-session'} onChange={e => setPc({ hardMaterialTiming: e.target.value })}
                          style={{ width: '100%', padding: '5px 8px', fontSize: fs(10), borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                          <option value="first-session">First window (freshest)</option>
                          <option value="middle-session">Middle window (after warm-up)</option>
                          <option value="last-session">Last window</option>
                          <option value="no-preference">No preference</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 3, fontWeight: 600 }}>Weekend study</div>
                        <select value={pc.weekendIntensity || 'same'} onChange={e => setPc({ weekendIntensity: e.target.value })}
                          style={{ width: '100%', padding: '5px 8px', fontSize: fs(10), borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                          <option value="same">Same as weekdays</option>
                          <option value="lighter">Lighter (review & catch-up)</option>
                          <option value="heavier">Heavier (make up for weekdays)</option>
                          <option value="off">Off — no study</option>
                        </select>
                      </div>
                      <div>
                        <div style={{ fontSize: fs(9), color: T.dim, marginBottom: 3, fontWeight: 600 }}>Exam dates</div>
                        <select value={pc.examDateMode || 'none'} onChange={e => setPc({ examDateMode: e.target.value })}
                          style={{ width: '100%', padding: '5px 8px', fontSize: fs(10), borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
                          <option value="none">No fixed exam dates</option>
                          <option value="end-of-course">Exams at end of each course</option>
                          <option value="custom">I'll specify in notes</option>
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Schedule warnings — with student-friendly explanations */}
                {(() => {
                  const warns = [];
                  if (hrsPerDay < 2 && totalEstHours > 0) warns.push({ c: T.orange, m: `Low study time: ~${Math.round(hrsPerDay * 10) / 10}h/day based on your schedule. Most students need 3-6h/day to stay on track. Try adding more study windows to your weekly schedule above.` });
                  if (hrsPerDay > 12) warns.push({ c: T.orange, m: `Very heavy schedule: ${Math.round(hrsPerDay * 10) / 10}h/day of study. This pace is hard to sustain and increases burnout risk. Consider extending your target date or reducing the number of courses this term.` });
                  if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) warns.push({ c: T.red, m: `Date conflict: Your target completion date (${new Date(data.targetCompletionDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) is after your term end date (${new Date(data.targetDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}). This means you${'\u2019'}re planning to finish after your term ends. Adjust one of these dates.` });
                  if (data.studyStartDate && data.targetCompletionDate && data.studyStartDate >= data.targetCompletionDate) warns.push({ c: T.red, m: `Invalid dates: Your start date is on or after your target completion date, leaving zero study days. Check both dates above.` });
                  if (!feasible) warns.push({ c: T.red, m: `Not enough time: Finishing by your target requires ${minHrsPerDay}h/day of study, which is more than most people can sustain. You can fix this by: (1) pushing your target date later, (2) adding more study time to your weekly schedule, or (3) reducing courses this term.` });
                  if (warns.length === 0) return null;
                  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>{warns.map((w, i) => <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: `${w.c}11`, border: `1px solid ${w.c}33`, fontSize: fs(11), color: w.c, lineHeight: 1.5 }}>{w.m}</div>)}</div>;
                })()}
              </div>
            </div>
          )}

          {/* ── Feasibility Stats (shown in setup/edit mode) ── */}
          {activeCourses.length > 0 && hasSettings && (showAdvanced || hasPlan) && (
            <div>
              <div style={{ padding: '8px 14px', borderRadius: 10, background: `${feasibilityColor}11`, border: `1px solid ${feasibilityColor}33`, fontSize: fs(11), color: feasibilityColor, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: fs(14), flexShrink: 0 }}>{feasibilityLevel === 'green' ? '\u2705' : feasibilityLevel === 'yellow' ? '\u26A0\uFE0F' : '\u274C'}</span>
                <span>
                  {feasibilityLevel === 'green'
                    ? `Your schedule looks good! ${totalEstHours}h across ${activeCourses.length} course${activeCourses.length !== 1 ? 's' : ''}, ~${Math.round(hrsPerDay * 10) / 10}h/day.${finishVsGoal != null && finishVsGoal > 0 ? ` Finishing ~${finishVsGoal}d early.` : ''}${bufferDays != null && bufferDays > 0 ? ` ${bufferDays}d buffer for interruptions.` : ''}`
                    : feasibilityLevel === 'yellow'
                      ? `Tight but possible. Need ~${minHrsPerDay}h/day${utilizationPct != null ? ` (${utilizationPct}% of your time)` : ''}. Consider extending your target or adding study windows.`
                      : `Not enough time. ${minHrsPerDay != null ? `Need ${minHrsPerDay}h/day, which isn${'\u2019'}t sustainable.` : 'No study days available.'} Extend your target date or add more study time.`
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
          {(hasSettings || isFirstRun) && (showAdvanced || hasPlan || pendingPlan) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '0 4px' }}>
              <div style={{ flex: 1, height: 1, background: T.border }} />
              <span style={{ fontSize: fs(10), fontWeight: 700, color: T.dim, textTransform: 'uppercase', letterSpacing: 1 }}>{pendingPlan ? 'Review Plan' : 'Generate'}</span>
              <div style={{ flex: 1, height: 1, background: T.border }} />
            </div>
          )}

          {/* ═══ GENERATE + PLAN PREVIEW — only for advanced/returning/generating/reviewing ═══ */}
          {(hasSettings || isFirstRun) && (showAdvanced || hasPlan || pendingPlan || hasSettings) && (
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
                    <Btn v="ghost" onClick={cancelGeneration} style={{ color: T.red, borderColor: T.red, flexShrink: 0 }}>{'\u2B1B'} Stop</Btn>
                  )}
                  <Btn v={isBusy ? 'secondary' : 'ai'} style={{ flex: 1, justifyContent: 'center', padding: '12px 24px', fontSize: fs(14) }} onClick={async () => {
                    setData(d => {
                      const updated = { ...d };
                      if (!d.studyStartDate) updated.studyStartDate = autoStart;
                      if (!d.targetCompletionDate && !d.targetDate) updated.targetCompletionDate = autoTarget;
                      if (!d.plannerConfig) updated.plannerConfig = migrateToPlannerConfig(updated);
                      return updated;
                    });
                    await new Promise(r => setTimeout(r, 100));
                    try { await genPlan(); } catch (e) { toast(`Generation failed: ${e.message}`, 'error'); bgSet({ loading: false, label: '' }); }
                  }} disabled={bg.loading || !profile || activeCourses.length === 0}>
                    {bg.loading ? <><Ic.Spin s={14} /> Generating...</> : !feasible ? `${'\u26A0'} Generate (Aggressive)` : hasPlan ? 'Regenerate Plan' : 'Generate Study Plan'}
                  </Btn>
                </div>
              )}

              {/* ═══ PLAN REVIEW — QUEUE MODEL ═══ */}
              {pendingPlan && (() => {
                const tasks = pendingPlan.tasks || [];
                const isQueueModel = tasks.length > 0 && !tasks[0].date;

                // Queue model: group by course, show task list
                if (isQueueModel) {
                  const studyTasks = tasks.filter(t => t.category !== 'break');
                  const totalHrs = Math.round(studyTasks.reduce((s, t) => s + (t.estimatedMins || 60), 0) / 60 * 10) / 10;
                  const courseGroups = {};
                  for (const t of studyTasks) {
                    const key = t.course_code || 'Other';
                    if (!courseGroups[key]) courseGroups[key] = { tasks: [], hrs: 0, name: t.course_name || key };
                    courseGroups[key].tasks.push(t);
                    courseGroups[key].hrs += (t.estimatedMins || 60) / 60;
                  }
                  const courseColors = {};
                  Object.keys(courseGroups).forEach((k, i) => { courseColors[k] = PLAN_COLORS[i % PLAN_COLORS.length]; });

                  return (
                    <div style={{ marginTop: 12 }}>
                      {/* Summary */}
                      <div className="plan-reveal" style={{ background: `linear-gradient(135deg, ${T.purpleD}, ${T.accentD})`, border: `1px solid ${T.purple}33`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                        <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 4 }}>Your Study Plan is Ready</div>
                        <div style={{ fontSize: fs(11), color: T.dim }}>
                          {studyTasks.length} study tasks · {Object.keys(courseGroups).length} courses · ~{totalHrs}h total
                        </div>
                        {/* Course breakdown bar */}
                        <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: T.input, marginTop: 8 }}>
                          {Object.entries(courseGroups).map(([code, g]) => (
                            <div key={code} style={{ width: `${(g.hrs / totalHrs) * 100}%`, background: courseColors[code], minWidth: 2 }} title={`${code}: ${Math.round(g.hrs)}h`} />
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                          {Object.entries(courseGroups).map(([code, g]) => (
                            <span key={code} style={{ fontSize: fs(9), color: T.soft }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: courseColors[code], marginRight: 4 }} />
                              {code}: {Math.round(g.hrs)}h ({g.tasks.length} tasks)
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Per-course task list */}
                      {Object.entries(courseGroups).map(([code, g]) => (
                        <div key={code} style={{ marginBottom: 10, border: `1px solid ${T.border}`, borderRadius: 10, borderLeft: `3px solid ${courseColors[code]}`, overflow: 'hidden' }}>
                          <div style={{ padding: '10px 14px', background: T.panel, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                            onClick={() => setExpandedWeeks(p => ({ ...p, [code]: !p[code] }))}>
                            <span style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>{code} — {g.name}</span>
                            <span style={{ fontSize: fs(10), color: T.dim }}>{g.tasks.length} tasks · {Math.round(g.hrs)}h</span>
                          </div>
                          {expandedWeeks[code] && (
                            <div style={{ padding: '6px 10px' }}>
                              {g.tasks.map((t, i) => (
                                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', borderBottom: i < g.tasks.length - 1 ? `1px solid ${T.border}22` : 'none' }}>
                                  <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace", minWidth: 20 }}>{i + 1}</span>
                                  <span style={{ flex: 1, fontSize: fs(11), color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title.replace(`${code} — `, '')}</span>
                                  <Badge color={courseColors[code]} bg={courseColors[code] + '22'}>{t.category}</Badge>
                                  <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>{minsToStr(t.estimatedMins || 60)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Confirm/Discard */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, position: 'sticky', bottom: 0, background: T.bg, padding: '10px 0', zIndex: 10 }}>
                        <Btn v="primary" onClick={confirmPlan} style={{ flex: 1 }}>Confirm Plan ({studyTasks.length} tasks)</Btn>
                        <Btn v="ghost" onClick={() => { setData(d => ({ ...d, taskQueue: [], pendingPlan: null })); setPendingPlan(null); toast('Plan discarded', 'info'); }}>Discard</Btn>
                      </div>
                    </div>
                  );
                }

                // Legacy calendar model (fallback for old plans)
                const sortedDates = [...new Set(tasks.map(t => t.date).filter(Boolean))].sort();
                if (sortedDates.length === 0) return null;
                const firstDate = new Date(sortedDates[0] + 'T12:00:00');
                const weeks = {};
                for (const dt of sortedDates) {
                  const d = new Date(dt + 'T12:00:00');
                  const wn = Math.floor((d - firstDate) / (7 * 86400000));
                  if (!weeks[wn]) weeks[wn] = [];
                  weeks[wn].push(dt);
                }
                const weekEntries = Object.entries(weeks);
                const totalHrs = tasks.reduce((s, t) => { const st = parseTime(t.time), et = parseTime(t.endTime); return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0); }, 0);

                // Per-course breakdown
                const courseBreak = {};
                for (const t of tasks) {
                  const color = getCourseColor(t.title);
                  const { courseKey } = matchTaskToCourse(t.title, courses);
                  const st = parseTime(t.time), et = parseTime(t.endTime);
                  const hrs = st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0;
                  if (!courseBreak[courseKey]) courseBreak[courseKey] = { hrs: 0, color, count: 0 };
                  courseBreak[courseKey].hrs += hrs;
                  courseBreak[courseKey].count++;
                }

                // Quality checks
                const warnings = [];
                const dayHrs = {};
                for (const t of tasks) {
                  const st = parseTime(t.time), et = parseTime(t.endTime);
                  const hrs = st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0;
                  dayHrs[t.date] = (dayHrs[t.date] || 0) + hrs;
                }
                const heavyDays = Object.entries(dayHrs).filter(([, h]) => h > 5);
                if (heavyDays.length > 0) warnings.push(`${heavyDays.length} day${heavyDays.length > 1 ? 's' : ''} over 5 hours`);
                const utilPct = weeklyHours > 0 ? Math.round((totalHrs / (weeklyHours * weekEntries.length)) * 100) : 0;

                const includedWeeks = weekEntries.filter(([wn]) => !excludedWeeks[wn]).length;

                return (
                <div style={{ marginTop: 12 }} ref={el => { if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100); }}
                  role="region" aria-label="Review generated study plan">

                  {/* ── Plan Summary Dashboard ── */}
                  <div className="plan-reveal" style={{ background: `linear-gradient(135deg, ${T.purpleD}, ${T.accentD})`, border: `1px solid ${T.purple}33`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
                    <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 2 }}>Your Study Plan is Ready</div>
                    <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 4 }}>
                      {tasks.length} tasks {'\u00B7'} {weekEntries.length} week{weekEntries.length !== 1 ? 's' : ''} {'\u00B7'} ~{Math.round(totalHrs)}h scheduled {'\u00B7'} {utilPct}% of available time
                    </div>
                    {/* P2-14: Finish line projection */}
                    {sortedDates.length > 0 && (
                      <div style={{ fontSize: fs(9), color: T.accent, marginBottom: 8 }}>
                        {'→'} Follow this plan through {new Date(sortedDates[sortedDates.length - 1] + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} to stay on track
                        {activeCourses.length > 0 && totalHrs >= totalEstHours * 0.9 ? ` \u2014 covers ${Math.round((totalHrs / totalEstHours) * 100)}% of your coursework` : ''}
                      </div>
                    )}

                    {/* Course breakdown bars */}
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: T.input }}>
                        {Object.entries(courseBreak).map(([name, { hrs, color }]) => (
                          <div key={name} style={{ width: `${(hrs / totalHrs) * 100}%`, background: color, minWidth: 2 }} title={`${name}: ${Math.round(hrs)}h`} />
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
                        {Object.entries(courseBreak).map(([name, { hrs, color, count }]) => (
                          <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: fs(9), color: T.soft }}>
                            <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                            <span style={{ fontWeight: 600 }}>{name}</span>
                            <span style={{ color: T.dim }}>{Math.round(hrs)}h ({count})</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Quality checks */}
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: fs(9) }}>
                      {warnings.length === 0 && <span style={{ color: T.accent }}>{'\u2713'} Plan looks balanced</span>}
                      {warnings.map((w, i) => <span key={i} style={{ color: T.orange }}>{'\u26A0'} {w}</span>)}
                      {utilPct <= 90 && <span style={{ color: T.accent }}>{'\u2713'} Fits your availability</span>}
                      {utilPct > 90 && <span style={{ color: T.orange }}>{'\u26A0'} {utilPct}% utilization is tight</span>}
                    </div>
                  </div>

                  {/* P2-13: Conflict detection banner */}
                  {planConflicts.length > 0 && (
                    <div style={{ padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, marginBottom: 8, fontSize: fs(10), color: T.orange }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>{'\u26A0'} {planConflicts.length} conflict{planConflicts.length !== 1 ? 's' : ''} with existing calendar items</div>
                      {planConflicts.slice(0, 3).map((c, i) => (
                        <div key={i} style={{ fontSize: fs(9), opacity: 0.85, marginLeft: 8 }}>
                          {new Date(c.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} {c.planTask.time}: "{c.planTask.title?.split(/[\u2014\-:]/)[0]?.trim()}" overlaps "{c.existing.title}"
                        </div>
                      ))}
                      {planConflicts.length > 3 && <div style={{ fontSize: fs(9), opacity: 0.7, marginLeft: 8 }}>+{planConflicts.length - 3} more...</div>}
                    </div>
                  )}

                  {/* P2-9: Course filter pills */}
                  {Object.keys(courseBreak).length > 1 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6, padding: '0 2px' }}>
                      <button onClick={() => setCourseFilter(null)}
                        style={{ padding: '3px 10px', borderRadius: 12, border: `1.5px solid ${!courseFilter ? T.accent : T.border}`, background: !courseFilter ? T.accentD : 'transparent', color: !courseFilter ? T.accent : T.dim, fontSize: fs(9), fontWeight: 600, cursor: 'pointer' }}>All</button>
                      {Object.entries(courseBreak).map(([name, { color }]) => (
                        <button key={name} onClick={() => setCourseFilter(courseFilter === name ? null : name)}
                          style={{ padding: '3px 10px', borderRadius: 12, border: `1.5px solid ${courseFilter === name ? color : T.border}`, background: courseFilter === name ? color + '22' : 'transparent', color: courseFilter === name ? color : T.dim, fontSize: fs(9), fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: 2, background: color, flexShrink: 0 }} />
                          {name}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* ── AI disclaimer ── */}
                  <div style={{ fontSize: fs(9), color: T.dim, padding: '4px 10px', marginBottom: 6, lineHeight: 1.4 }}>
                    AI-generated estimates. Remove tasks with {'\u2717'}, click times/titles to edit, or uncheck weeks.
                  </div>

                  {/* ── Sticky confirm/discard bar ── */}
                  <div style={{ position: 'sticky', top: 0, zIndex: 5, background: T.card, padding: '6px 0 8px', marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Btn v="ai" style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }} onClick={confirmPlan}>
                        Confirm {includedWeeks < weekEntries.length ? `${includedWeeks}/${weekEntries.length} Weeks` : 'Plan'}
                      </Btn>
                      {!showDiscardConfirm ? (
                        <Btn v="ghost" style={{ flexShrink: 0 }} onClick={() => setShowDiscardConfirm(true)}>Discard</Btn>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <span style={{ fontSize: fs(10), color: T.orange }}>Sure?</span>
                          <Btn small v="ghost" onClick={discardPlan} style={{ color: T.red, borderColor: T.red }}>Yes, discard</Btn>
                          <Btn small v="ghost" onClick={() => setShowDiscardConfirm(false)}>Keep</Btn>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Collapsible week cards ── */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                    role="list" aria-label="Plan weeks">
                    {weekEntries.map(([wn, dates]) => {
                      const wnNum = Number(wn);
                      const weekTasks = tasks.filter(t => dates.includes(t.date));
                      const weekHrs = weekTasks.reduce((s, t) => { const st = parseTime(t.time), et = parseTime(t.endTime); return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0); }, 0);
                      const isExpanded = !!expandedWeeks[wn];
                      const isExcluded = !!excludedWeeks[wn];
                      // Mini day dots
                      const dayDots = [0, 1, 2, 3, 4, 5, 6].map(i => {
                        const dt = new Date(new Date(dates[0] + 'T12:00:00'));
                        dt.setDate(dt.getDate() + i);
                        const ds = dt.toISOString().split('T')[0];
                        return dayHrs[ds] || 0;
                      });
                      const maxDayH = Math.max(...dayDots, 1);

                      return (
                        <div key={wn} role="listitem" className="plan-reveal" style={{ background: T.panel, border: `1px solid ${isExcluded ? T.border : T.purple + '33'}`, borderRadius: 10, overflow: 'hidden', opacity: isExcluded ? 0.5 : 1, transition: 'opacity .2s' }}>
                          {/* Week header — clickable */}
                          <div onClick={() => setExpandedWeeks(p => ({ ...p, [wn]: !p[wn] }))}
                            style={{ padding: '8px 12px', background: T.input, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
                            <span style={{ fontSize: fs(10), color: T.dim, transition: 'transform .2s', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)' }}>{'\u25B6'}</span>
                            <span style={{ fontSize: fs(11), fontWeight: 700, color: T.text, flex: 1 }}>
                              Week {wnNum + 1}: {new Date(dates[0] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} {'\u2013'} {new Date(dates[dates.length - 1] + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                            {/* Mini day dots */}
                            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 14 }}>
                              {dayDots.map((h, i) => (
                                <div key={i} style={{ width: 4, borderRadius: 1, background: h > 0 ? T.accent : T.border, height: Math.max(2, (h / maxDayH) * 14), opacity: h > 0 ? 0.7 : 0.3 }} />
                              ))}
                            </div>
                            <span style={{ fontSize: fs(10), fontWeight: 600, color: T.soft, minWidth: 30, textAlign: 'right' }}>{Math.round(weekHrs)}h</span>
                            {/* Week accept toggle */}
                            <button onClick={e => { e.stopPropagation(); setExcludedWeeks(p => ({ ...p, [wn]: !p[wn] })); }}
                              style={{ width: 20, height: 20, borderRadius: 4, border: `1.5px solid ${isExcluded ? T.border : T.accent}`, background: isExcluded ? 'transparent' : T.accentD, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(10), color: isExcluded ? T.dim : T.accent, padding: 0, flexShrink: 0 }}
                              title={isExcluded ? 'Include this week' : 'Exclude this week'}>
                              {isExcluded ? '' : '\u2713'}
                            </button>
                          </div>

                          {/* Expanded content — days and tasks */}
                          <div style={{ maxHeight: isExpanded ? 2000 : 0, overflow: 'hidden', transition: 'max-height .3s ease' }}>
                            <div style={{ padding: '6px 10px' }}>
                              {dates.map(dt => {
                                const dtTasks = tasks.filter(t => t.date === dt);
                                const dtHrs = dayHrs[dt] || 0;
                                return (
                                  <div key={dt}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0 2px' }}>
                                      <span style={{ fontSize: fs(10), fontWeight: 700, color: T.accent }}>{new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {dtHrs > 5 && <span style={{ fontSize: fs(8), color: T.orange }}>{'\u26A0'}</span>}
                                        <span style={{ fontSize: fs(9), color: T.dim }}>{Math.round(dtHrs * 10) / 10}h</span>
                                      </div>
                                    </div>
                                    {dtTasks.map((t, j) => {
                                      const { courseKey: tCourse } = matchTaskToCourse(t.title, courses);
                                      const filtered = courseFilter && tCourse !== courseFilter;
                                      const isEditingTime = editingTask?.id === t.id && editingTask?.field === 'time';
                                      const isEditingTitle = editingTask?.id === t.id && editingTask?.field === 'title';
                                      return (
                                      <div key={t.id || j} className="plan-task-row" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 5, background: j % 2 === 0 ? T.input : 'transparent', marginBottom: 1, fontSize: fs(10), borderLeft: `3px solid ${getCourseColor(t.title)}`, opacity: filtered ? 0.2 : 1, transition: 'opacity .15s', pointerEvents: filtered ? 'none' : 'auto' }}>
                                        {/* P2-10: Inline time editing */}
                                        {isEditingTime ? (
                                          <input type="time" defaultValue={t.time} autoFocus
                                            onBlur={e => updatePendingTask(t.id, t.date, 'time', e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingTask(null); }}
                                            style={{ width: 56, padding: '1px 2px', fontSize: fs(9), fontFamily: "'JetBrains Mono',monospace", border: `1px solid ${T.accent}`, borderRadius: 3, background: T.input, color: T.text }} />
                                        ) : (
                                          <span onClick={() => setEditingTask({ id: t.id, field: 'time' })}
                                            style={{ color: T.blue, minWidth: 36, fontFamily: "'JetBrains Mono',monospace", fontSize: fs(9), cursor: 'pointer' }} title="Click to edit time">{t.time || '\u2014'}</span>
                                        )}
                                        {/* P2-10: Inline title editing */}
                                        {isEditingTitle ? (
                                          <input type="text" defaultValue={t.title} autoFocus
                                            onBlur={e => updatePendingTask(t.id, t.date, 'title', e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditingTask(null); }}
                                            style={{ flex: 1, padding: '1px 4px', fontSize: fs(10), border: `1px solid ${T.accent}`, borderRadius: 3, background: T.input, color: T.text }} />
                                        ) : (
                                          <span onClick={() => setEditingTask({ id: t.id, field: 'title' })}
                                            style={{ flex: 1, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }} title="Click to edit title">{t.title}</span>
                                        )}
                                        {t.endTime && <span style={{ color: T.dim, fontSize: fs(8), flexShrink: 0 }}>{t.endTime}</span>}
                                        {t.category && t.category !== 'study' && <Badge color={t.category === 'break' ? T.dim : t.category === 'exam-day' ? T.red : t.category === 'exam-prep' ? T.orange : t.category === 'review' ? T.blue : T.purple} bg={(t.category === 'break' ? T.dim : t.category === 'exam-day' ? T.red : t.category === 'exam-prep' ? T.orange : t.category === 'review' ? T.blue : T.purple) + '22'}>{t.category}</Badge>}
                                        <button onClick={() => removeTaskFromPending(t.id, t.date)}
                                          className="plan-task-delete"
                                          style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: '0 2px', fontSize: fs(11), opacity: 0, transition: 'opacity .15s', flexShrink: 0 }}
                                          title="Remove task">{'\u2715'}</button>
                                      </div>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                );
              })()}

              <AIActivity />
            </div>
          )}
        </>
      )}

      {/* ─── POST-CONFIRM NAVIGATION ─── */}
      {showPostConfirm && !pendingPlan && (
        <div className="slide-up" style={{ background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1px solid ${T.accent}33`, borderRadius: 14, padding: '20px 24px', textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: fs(14), fontWeight: 700, color: T.accent, marginBottom: 4 }}>{'\u2705'} Plan Confirmed</div>
          <div style={{ fontSize: fs(12), color: T.soft, marginBottom: undoSnapshot ? 10 : 16 }}>Your study tasks have been added to the calendar.</div>
          {undoSnapshot && (
            <div style={{ marginBottom: 12 }}>
              <Btn small v="ghost" onClick={undoConfirm} style={{ color: T.orange, borderColor: T.orange + '55' }}>Undo — remove all added tasks</Btn>
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <Btn v="ai" onClick={() => { setShowPostConfirm(false); setUndoSnapshot(null); setPage('daily'); }}>View Today{'\u2019'}s Tasks {'→'}</Btn>
            <Btn v="secondary" onClick={() => { setShowPostConfirm(false); setUndoSnapshot(null); setPage('calendar'); }}>View Calendar {'→'}</Btn>
            <Btn v="ghost" onClick={() => { setShowPostConfirm(false); }}>Stay Here</Btn>
          </div>
        </div>
      )}

      {/* Themed confirm dialog */}
      {confirmDialog && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(8px)' }}
          onClick={() => setConfirmDialog(null)}>
          <div className="pop-in" onClick={e => e.stopPropagation()} style={{ background: T.card, border: `1.5px solid ${T.border}`, borderRadius: 16, padding: '24px 28px', maxWidth: 400, textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}>
            <div style={{ fontSize: fs(14), fontWeight: 600, color: T.text, marginBottom: 16, lineHeight: 1.5 }}>{confirmDialog.message}</div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Btn v="ghost" onClick={() => setConfirmDialog(null)}>Cancel</Btn>
              <Btn v="ai" onClick={confirmDialog.onConfirm}>Confirm</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export { StudyPlannerPage };
export default StudyPlannerPage;
