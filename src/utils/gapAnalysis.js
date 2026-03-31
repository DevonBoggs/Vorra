// Gap Analysis — holistic plan health audit
// Scans the entire calendar for: empty days, partial days, missing courses,
// missing phases, and uncovered content (topics/units from the lesson plan)
// C1: Designed to be called inside useMemo — pure function, no side effects
// C3: Uses scoring-based content matching instead of naive string inclusion

import { getEffectiveHours, getDateAvailability } from './availabilityCalc.js';
import { parseTime, todayStr } from './helpers.js';
import { matchTaskToCourse } from './toolExecution.js';

const GAP_THRESHOLD_MINS = 30;

// ── C3: Scoring-based content matching ──────────────────────────────
// Tokenize, filter stop words, compute Jaccard similarity

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'its', 'are', 'was', 'will', 'can', 'has', 'have', 'been', 'being', 'each', 'which', 'their', 'about', 'between', 'through', 'using', 'based', 'understanding', 'introduction', 'overview', 'basics', 'fundamentals', 'advanced', 'review', 'practice', 'exam', 'test', 'quiz', 'study', 'learn', 'deep', 'dive']);

function tokenize(text) {
  return (text || '').toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccardScore(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const w of setA) { if (setB.has(w)) intersection++; }
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

const COVERAGE_THRESHOLD = 0.25; // 25% word overlap = covered

/**
 * Pre-index tasks by course for efficient lookup (H4 fix).
 */
const STUDY_CATEGORIES = new Set(['study', 'review', 'exam-prep', 'exam-day', 'project', 'class']);

function indexTasksByCourse(tasks, courses) {
  const index = {}; // courseKey → [{ title, category, time, endTime, date }]
  for (const [dt, dayTasks] of Object.entries(tasks || {})) {
    for (const t of (dayTasks || [])) {
      if (t._ghost || !STUDY_CATEGORIES.has(t.category)) continue;
      const { courseKey } = matchTaskToCourse(t.title, courses, t.category);
      if (!courseKey || courseKey === 'Break' || courseKey === 'Other') continue;
      if (!index[courseKey]) index[courseKey] = [];
      const st = parseTime(t.time), et = parseTime(t.endTime);
      const mins = st && et ? Math.max(0, et.mins - st.mins) : 0;
      index[courseKey].push({ title: t.title || '', category: t.category, mins, date: dt });
    }
  }
  return index;
}

/**
 * Build content coverage map with scoring-based matching.
 */
function buildContentCoverage(taskIndex, lessonPlan) {
  if (!lessonPlan?.courses) return {};
  const coverage = {};

  for (const coursePlan of lessonPlan.courses) {
    const code = coursePlan.course_code;
    const courseTasks = taskIndex[code] || taskIndex[coursePlan.course_name] || [];
    const scheduledHours = courseTasks.reduce((s, t) => s + t.mins / 60, 0);
    const taskTokenSets = courseTasks.map(t => tokenize(t.title));
    const taskCategories = new Set(courseTasks.map(t => t.category));

    const coveredUnits = [];
    const uncoveredUnits = [];

    for (const unit of (coursePlan.units || [])) {
      const unitTokens = [...tokenize(unit.title), ...(unit.topics || []).flatMap(t => tokenize(t))];
      // Score against all task titles — take the best match
      const bestScore = taskTokenSets.reduce((best, taskTokens) => Math.max(best, jaccardScore(unitTokens, taskTokens)), 0);
      if (bestScore >= COVERAGE_THRESHOLD) {
        coveredUnits.push(unit);
      } else {
        uncoveredUnits.push(unit);
      }
    }

    // Missing phases
    const allPhases = new Set((coursePlan.units || []).map(u => u.type));
    const coveredPhases = new Set(coveredUnits.map(u => u.type));
    const missingPhases = [];
    for (const phase of allPhases) {
      if (!coveredPhases.has(phase) && phase !== 'learn') missingPhases.push(phase);
    }
    if (!taskCategories.has('exam-prep') && allPhases.has('exam-prep') && !missingPhases.includes('exam-prep')) missingPhases.push('exam-prep');
    if (!taskCategories.has('exam-day') && allPhases.has('exam-day') && !missingPhases.includes('exam-day')) missingPhases.push('exam-day');

    coverage[code] = {
      courseName: coursePlan.course_name, courseCode: code,
      totalUnits: (coursePlan.units || []).length, totalHours: coursePlan.total_hours || 0,
      coveredUnits, uncoveredUnits, scheduledHours, missingPhases,
    };
  }
  return coverage;
}

/**
 * H2: Compute actual free time windows for a day (not just total hours).
 */
function computeFreeWindows(dayTasks, plannerConfig, dow) {
  if (!plannerConfig?.weeklyAvailability) return [];
  const day = plannerConfig.weeklyAvailability[dow];
  if (!day?.available || !day.windows?.length) return [];

  // Convert availability windows to minute ranges
  const availRanges = day.windows.map(w => ({ start: parseTime(w.start)?.mins || 0, end: parseTime(w.end)?.mins || 0 })).filter(r => r.end > r.start);

  // Get task occupied ranges
  const occupied = dayTasks.filter(t => !t._ghost).map(t => {
    const st = parseTime(t.time), et = parseTime(t.endTime);
    return st && et ? { start: st.mins, end: et.mins } : null;
  }).filter(Boolean).sort((a, b) => a.start - b.start);

  // Subtract occupied from available
  const free = [];
  for (const avail of availRanges) {
    let cursor = avail.start;
    for (const occ of occupied) {
      if (occ.end <= cursor) continue;
      if (occ.start > cursor) {
        free.push({ start: cursor, end: Math.min(occ.start, avail.end) });
      }
      cursor = Math.max(cursor, occ.end);
      if (cursor >= avail.end) break;
    }
    if (cursor < avail.end) free.push({ start: cursor, end: avail.end });
  }
  return free.filter(f => (f.end - f.start) >= GAP_THRESHOLD_MINS);
}

function minsToTime(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Scan for day-level gaps with actual free time windows.
 */
function scanDayGaps(tasks, startDate, endDate, plannerConfig, exceptionDates = []) {
  const gaps = [];
  const today = todayStr();
  const start = new Date(startDate + 'T12:00:00');
  const end = endDate ? new Date(endDate + 'T12:00:00') : new Date(start);
  if (!endDate) end.setDate(end.getDate() + 60);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().split('T')[0];
    if (ds < today) continue;
    if (exceptionDates.includes(ds)) continue;

    const dow = d.getDay();
    const availHrs = plannerConfig ? getEffectiveHours(plannerConfig, dow) : 0;
    if (availHrs <= 0) continue;

    const dayTasks = (tasks[ds] || []).filter(t => !t._ghost);
    let scheduledMins = 0;
    for (const t of dayTasks) {
      const st = parseTime(t.time), et = parseTime(t.endTime);
      if (st && et) scheduledMins += Math.max(0, et.mins - st.mins);
    }
    const scheduledHrs = scheduledMins / 60;
    const gapHrs = Math.round((availHrs - scheduledHrs) * 10) / 10;

    if (gapHrs * 60 >= GAP_THRESHOLD_MINS) {
      // H2: Compute actual free windows
      const freeWindows = computeFreeWindows(dayTasks, plannerConfig, dow);
      gaps.push({
        date: ds, dayOfWeek: dow,
        availableHours: availHrs,
        scheduledHours: Math.round(scheduledHrs * 10) / 10,
        gapHours: gapHrs,
        isEmpty: dayTasks.length === 0,
        taskCount: dayTasks.length,
        freeWindows, // H2: actual free time slots
      });
    }
  }
  return gaps;
}

function findMissingCourses(taskIndex, courses) {
  const activeCourses = courses.filter(c => c.status !== 'completed');
  const scheduledCourses = new Set(Object.keys(taskIndex));
  return activeCourses.filter(c => {
    const key = c.courseCode || c.name;
    return !scheduledCourses.has(key);
  });
}

/**
 * Full holistic gap analysis. Pure function — safe for useMemo.
 */
export function analyzeGaps(data) {
  const {
    tasks = {}, courses = [], plannerConfig,
    exceptionDates = [], studyStartDate,
    targetCompletionDate, targetDate,
    lessonPlan, scheduleOutline,
  } = data;

  const startDate = studyStartDate || todayStr();
  const endDate = targetCompletionDate || targetDate || null;
  const activeCourses = courses.filter(c => c.status !== 'completed');

  // H4: Pre-index tasks by course (single pass)
  const taskIndex = indexTasksByCourse(tasks, courses);

  const dayGaps = scanDayGaps(tasks, startDate, endDate, plannerConfig, exceptionDates);
  const emptyDays = dayGaps.filter(g => g.isEmpty);
  const partialDays = dayGaps.filter(g => !g.isEmpty);
  const totalGapHours = Math.round(dayGaps.reduce((s, g) => s + g.gapHours, 0) * 10) / 10;

  const contentCoverage = buildContentCoverage(taskIndex, lessonPlan);
  const missingCourses = findMissingCourses(taskIndex, courses);

  const courseSummaries = activeCourses.map(c => {
    const code = c.courseCode || c.name;
    const cov = contentCoverage[code];
    const estHrs = c.averageStudyHours > 0 ? c.averageStudyHours : ([0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50);
    // Use content coverage hours if available, fall back to taskIndex hours
    const indexHrs = (taskIndex[code] || []).reduce((s, t) => s + t.mins / 60, 0);
    const scheduledHrs = cov?.scheduledHours || indexHrs || 0;
    const hourGap = Math.round((estHrs - scheduledHrs) * 10) / 10;
    const isMissing = missingCourses.some(mc => (mc.courseCode || mc.name) === code);
    return {
      courseCode: code, courseName: c.name, estimatedHours: estHrs,
      scheduledHours: Math.round(scheduledHrs * 10) / 10,
      hourGap: Math.max(0, hourGap),
      totalUnits: cov?.totalUnits || 0, coveredUnits: cov?.coveredUnits?.length || 0,
      uncoveredUnits: cov?.uncoveredUnits || [], missingPhases: cov?.missingPhases || [],
      isMissing,
      coveragePct: cov?.totalUnits > 0 ? Math.round((cov.coveredUnits.length / cov.totalUnits) * 100) : 0,
    };
  });

  const totalEstHours = activeCourses.reduce((s, c) => s + (c.averageStudyHours > 0 ? c.averageStudyHours : ([0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50)), 0);
  const totalScheduledHours = courseSummaries.reduce((s, c) => s + c.scheduledHours, 0);
  const coveragePct = totalEstHours > 0 ? Math.round((totalScheduledHours / totalEstHours) * 100) : 0;
  const totalUncoveredUnits = courseSummaries.reduce((s, c) => s + c.uncoveredUnits.length, 0);
  const totalMissingPhases = courseSummaries.reduce((s, c) => s + c.missingPhases.length, 0);

  // M3: Contextual severity based on plan duration
  const totalStudyDays = dayGaps.length + Object.keys(tasks).filter(d => d >= todayStr()).length;
  const hasIssues = emptyDays.length > 0 || partialDays.length > 0 || missingCourses.length > 0 || totalUncoveredUnits > 0 || totalMissingPhases > 0;
  const emptyRatio = totalStudyDays > 0 ? emptyDays.length / totalStudyDays : 0;
  const severity = missingCourses.length > 0 ? 'critical'
    : (emptyRatio > 0.3 || totalUncoveredUnits > activeCourses.length * 2) ? 'high'
    : hasIssues ? 'medium' : 'healthy';

  return {
    dayGaps, emptyDays, partialDays, totalGapHours,
    contentCoverage, courseSummaries, missingCourses,
    totalUncoveredUnits, totalMissingPhases,
    totalEstHours, totalScheduledHours, coveragePct, severity, hasIssues,
    hasLessonPlan: !!lessonPlan?.courses?.length,
    hasScheduleOutline: !!scheduleOutline?.weeks?.length,
  };
}

/**
 * Build AI prompt for filling gaps.
 * C4: Normalizes scheduleOutline week boundaries.
 * H2: Includes actual free time windows.
 * H8: Adds date validation instruction.
 */
export function buildGapFillPrompt(gapReport, weekDates, data) {
  const { courseSummaries, dayGaps } = gapReport;
  const { tasks, scheduleOutline, plannerConfig } = data;

  const weekGaps = dayGaps.filter(g => weekDates.includes(g.date));
  if (weekGaps.length === 0) return null;

  // C4: Determine course assignment from scheduleOutline with normalized dates
  let weekCourseAssignment = '';
  const assignedCourses = new Set();
  if (scheduleOutline?.weeks) {
    for (const w of scheduleOutline.weeks) {
      if (!w.week_of) continue;
      // Normalize the week_of date
      const weekOfDate = new Date(w.week_of + 'T12:00:00');
      if (isNaN(weekOfDate)) continue;
      const ws = weekOfDate.toISOString().split('T')[0];
      const weekEnd = new Date(weekOfDate); weekEnd.setDate(weekEnd.getDate() + 6);
      const we = weekEnd.toISOString().split('T')[0];
      const matching = weekGaps.filter(g => g.date >= ws && g.date <= we);
      if (matching.length > 0 && w.courses?.length > 0) {
        weekCourseAssignment += `Week of ${ws}: `;
        weekCourseAssignment += w.courses.map(c => `${c.course_code} (${c.hours}h, ${c.phase})`).join(', ');
        weekCourseAssignment += '\n';
        w.courses.forEach(c => assignedCourses.add(c.course_code));
      }
    }
  }

  // Only include content for courses assigned to these weeks
  const relevantCourses = courseSummaries.filter(c =>
    (assignedCourses.size === 0 || assignedCourses.has(c.courseCode)) && (c.hourGap > 0 || c.uncoveredUnits.length > 0)
  );

  let prompt = `Fill study sessions into the following gap days. ONLY generate tasks for the EXACT dates listed below.\n\n`;

  if (weekCourseAssignment) {
    prompt += `COURSE ASSIGNMENT (MUST follow):\n${weekCourseAssignment}\nDo NOT place a course on dates belonging to a different course's week.\n\n`;
  }

  // H2: Gap days with actual free time windows
  prompt += `GAP DAYS TO FILL:\n`;
  for (const gap of weekGaps) {
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][gap.dayOfWeek];
    prompt += `  ${gap.date} (${dow}):`;
    if (gap.freeWindows?.length > 0) {
      prompt += ` FREE WINDOWS: ${gap.freeWindows.map(f => `${minsToTime(f.start)}-${minsToTime(f.end)} (${Math.round((f.end - f.start) / 60 * 10) / 10}h)`).join(', ')}`;
    } else {
      prompt += ` ${gap.gapHours}h available`;
    }
    if (gap.taskCount > 0) {
      // L8: Only show time ranges for non-study tasks (privacy)
      const existing = (tasks[gap.date] || []).filter(t => !t._ghost).map(t => {
        const isStudy = ['study', 'review', 'exam-prep', 'exam-day'].includes(t.category);
        return isStudy ? `${t.time}-${t.endTime} ${t.title}` : `${t.time}-${t.endTime} [blocked]`;
      }).join('; ');
      prompt += ` (existing: ${existing})`;
    }
    prompt += '\n';
  }

  prompt += `\nUNCOVERED CONTENT (generate tasks for these topics):\n`;
  for (const cs of relevantCourses) {
    if (cs.uncoveredUnits.length === 0 && cs.missingPhases.length === 0) continue;
    prompt += `  ${cs.courseCode}: ${cs.hourGap}h remaining\n`;
    // M6: Show all unit titles, detailed topics for first 10
    for (const unit of cs.uncoveredUnits.slice(0, 10)) {
      prompt += `    - ${unit.title} (${unit.hours || '?'}h, ${unit.type})`;
      if (unit.topics?.length > 0) prompt += ` — ${unit.topics.join(', ')}`;
      prompt += '\n';
    }
    if (cs.uncoveredUnits.length > 10) {
      prompt += `    ... and ${cs.uncoveredUnits.length - 10} more: ${cs.uncoveredUnits.slice(10).map(u => u.title).join(', ')}\n`;
    }
    if (cs.missingPhases.length > 0) prompt += `    Missing phases: ${cs.missingPhases.join(', ')}\n`;
  }

  if (plannerConfig?.commitments?.length > 0) {
    prompt += `\nBLOCKED COMMITMENTS:\n`;
    const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (const c of plannerConfig.commitments) {
      prompt += `  ${c.label}: ${c.days.map(d => DAY_NAMES[d]).join('/')} ${c.start}-${c.end}\n`;
    }
  }

  // H8: Explicit date validation instruction
  const validDates = weekGaps.map(g => g.date).join(', ');
  prompt += `\nRULES:\n`;
  prompt += `- ONLY dates: ${validDates}. Tasks on any other date will be REJECTED.\n`;
  prompt += `- ONLY schedule within the FREE WINDOWS listed above.\n`;
  prompt += `- ONLY the assigned course for each date's week.\n`;
  prompt += `- Do NOT duplicate topics from existing tasks.\n`;
  prompt += `- Include study technique notes in the "notes" field.\n`;
  prompt += `- Include breaks between study blocks.\n`;
  prompt += `- Each task: date, time, endTime (24h), title ("CourseCode - Topic"), category, priority, notes.\n`;

  return prompt;
}

export default analyzeGaps;
