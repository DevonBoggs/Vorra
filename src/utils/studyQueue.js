// studyQueue.js — Task queue system for the study planner
// Converts AI lesson plans into an ordered task queue, populates daily tasks,
// and tracks progress/pacing without calendar-based scheduling.

import { getEffectiveHours, getWeeklyHours, getStudyDaysPerWeek } from './availabilityCalc.js';
import { todayStr, diffDays, uid } from './helpers.js';

// ── LESSON PLAN → TASK QUEUE ────────────────────────────────────────

/**
 * Convert a lesson plan into an ordered task queue.
 * Each unit becomes 1+ study blocks sized to the student's block style.
 * Queue order follows study mode (sequential/parallel/hybrid).
 */
export function lessonPlanToQueue(lessonPlan, options = {}) {
  const {
    studyMode = 'sequential',    // 'sequential' | 'parallel' | 'hybrid'
    blockStyle = 'standard',     // 'standard' | 'pomodoro' | 'sprint'
    courses = [],                // active course objects (for courseId matching)
  } = options;

  const blockMins = blockStyle === 'pomodoro' ? 50 : blockStyle === 'sprint' ? 50 : 90;
  const breakMins = blockStyle === 'pomodoro' ? 10 : blockStyle === 'sprint' ? 10 : 15;

  const queue = [];
  const courseUnits = {}; // course_code → [units]

  // Build per-course unit arrays
  for (const c of (lessonPlan.courses || [])) {
    courseUnits[c.course_code] = (c.units || []).map(u => ({
      ...u,
      course_code: c.course_code,
      course_name: c.course_name,
      course_total_hours: c.total_hours,
    }));
  }

  // Build ordered unit list based on study mode
  const orderedUnits = [];
  if (studyMode === 'sequential') {
    // All units of course 1, then course 2, etc.
    for (const c of (lessonPlan.courses || [])) {
      orderedUnits.push(...(courseUnits[c.course_code] || []));
    }
  } else if (studyMode === 'parallel') {
    // Round-robin: 1 unit from each course, repeat
    const queues = (lessonPlan.courses || []).map(c => [...(courseUnits[c.course_code] || [])]);
    while (queues.some(q => q.length > 0)) {
      for (const q of queues) {
        if (q.length > 0) orderedUnits.push(q.shift());
      }
    }
  } else {
    // Hybrid: same as sequential for now (daily population handles interleaving)
    for (const c of (lessonPlan.courses || [])) {
      orderedUnits.push(...(courseUnits[c.course_code] || []));
    }
  }

  // Convert each unit into study blocks
  for (const unit of orderedUnits) {
    const unitMins = (unit.hours || 2) * 60;
    const numBlocks = Math.max(1, Math.ceil(unitMins / blockMins));
    const minsPerBlock = Math.round(unitMins / numBlocks);

    // Map unit type to task category
    const category = unit.type === 'exam-day' ? 'exam-day'
      : unit.type === 'exam-prep' ? 'exam-prep'
      : unit.type === 'review' ? 'review'
      : unit.type === 'practice' ? 'study'
      : unit.type === 'project' ? 'project'
      : 'study';

    // Match course for courseId
    const courseMatch = courses.find(c =>
      (c.courseCode || '').toUpperCase().trim() === (unit.course_code || '').toUpperCase().trim()
    );

    // Build rich description for the task
    const topicsList = (unit.topics || []).join(', ');
    const objectiveStr = unit.objectives || '';
    const unitNotes = unit.notes || '';

    // Subtitle: the first line shown under the title in the daily view
    const subtitle = category === 'review'
      ? `Retrieval practice: without notes, write everything you know about ${topicsList || unit.title}. Then check and fill gaps.`
      : category === 'exam-prep'
      ? `Timed practice: simulate exam conditions. ${objectiveStr || 'Answer practice questions under time pressure, then review wrong answers.'}`
      : category === 'exam-day'
      ? `Assessment day. Light review only (30 min max), then take the exam.`
      : category === 'project'
      ? `${objectiveStr || unitNotes || 'Work on project deliverable — specify the section or artifact to produce.'}`
      : objectiveStr
      ? `Goal: ${objectiveStr}`
      : topicsList
      ? `Study: ${topicsList}`
      : `Study ${unit.title}`;

    // Full notes: detailed instructions shown when task is expanded
    const fullNotes = [
      subtitle,
      topicsList ? `\nTopics: ${topicsList}` : '',
      objectiveStr && !subtitle.includes(objectiveStr) ? `\nObjective: ${objectiveStr}` : '',
      unitNotes ? `\nNotes: ${unitNotes}` : '',
      category === 'study' ? '\nTechnique: Active recall — read for 15 min, close notes, write a summary from memory, compare against source, fill gaps.' : '',
      category === 'review' ? '\nTechnique: Self-quiz without notes first. Score yourself (target 80%+). Create flashcards for missed items.' : '',
      category === 'exam-prep' ? '\nTechnique: Set a timer matching real exam duration. No notes. After: analyze every wrong answer.' : '',
    ].filter(Boolean).join('');

    for (let bi = 0; bi < numBlocks; bi++) {
      const blockTitle = numBlocks === 1
        ? `${unit.course_code} — ${unit.title}`
        : `${unit.course_code} — ${unit.title} (${bi + 1}/${numBlocks})`;

      queue.push({
        id: uid(),
        title: blockTitle,
        subtitle, // Short description for daily view
        course_code: unit.course_code,
        course_name: unit.course_name,
        courseId: courseMatch?.id || '',
        unitNumber: unit.unit_number,
        unitTitle: unit.title,
        category,
        priority: category === 'exam-prep' || category === 'exam-day' ? 'high' : 'medium',
        estimatedMins: minsPerBlock,
        topics: unit.topics || [],
        objectives: objectiveStr,
        notes: fullNotes,
        done: false,
        doneDate: null,
        actualMins: null,
      });

      // Add break between blocks (not after the last one)
      if (bi < numBlocks - 1) {
        queue.push({
          id: uid(),
          title: 'Break',
          course_code: unit.course_code,
          courseId: '',
          unitNumber: unit.unit_number,
          category: 'break',
          priority: 'low',
          estimatedMins: breakMins,
          notes: '',
          done: false,
          doneDate: null,
          actualMins: null,
        });
      }
    }
  }

  return queue;
}


// ── DAILY QUEUE POPULATION ──────────────────────────────────────────

/**
 * Populate today's task list from the queue.
 * Returns { todayTasks, workAheadTasks, dailyTargetMins }.
 */
export function populateToday(queue, plannerConfig, options = {}) {
  const {
    pacingStyle = 'steady',  // 'steady' | 'wave' | 'sprint-rest'
    targetDate = null,       // YYYY-MM-DD
    startDate = null,        // YYYY-MM-DD
  } = options;

  const today = todayStr();
  const dow = new Date(today + 'T12:00:00').getDay();
  const availableHrs = plannerConfig ? getEffectiveHours(plannerConfig, dow) : 4;

  // Calculate daily target based on remaining work and time
  const remainingTasks = queue.filter(t => !t.done && t.category !== 'break');
  const remainingMins = remainingTasks.reduce((s, t) => s + (t.estimatedMins || 60), 0);
  const remainingBreaks = queue.filter(t => !t.done && t.category === 'break')
    .reduce((s, t) => s + (t.estimatedMins || 10), 0);
  const totalRemainingMins = remainingMins + remainingBreaks;

  // Days remaining to target
  let daysRemaining = null;
  if (targetDate) {
    daysRemaining = Math.max(1, diffDays(today, targetDate));
  }

  // Study days remaining (considering weekly pattern)
  let studyDaysRemaining = daysRemaining;
  if (plannerConfig && daysRemaining) {
    const studyDaysPerWeek = getStudyDaysPerWeek(plannerConfig);
    const fullWeeks = Math.floor(daysRemaining / 7);
    const partialDays = daysRemaining % 7;
    // Estimate study days in partial week
    let partialStudyDays = 0;
    for (let i = 0; i < partialDays; i++) {
      const d = (dow + i) % 7;
      if (getEffectiveHours(plannerConfig, d) > 0) partialStudyDays++;
    }
    studyDaysRemaining = fullWeeks * studyDaysPerWeek + partialStudyDays;
  }

  // Daily target (minutes)
  let dailyTargetMins;
  if (studyDaysRemaining && studyDaysRemaining > 0) {
    dailyTargetMins = Math.ceil(totalRemainingMins / studyDaysRemaining);
  } else {
    dailyTargetMins = availableHrs * 60;
  }

  // Apply pacing style
  if (pacingStyle === 'wave') {
    // Alternate heavy/light — use day of week parity
    const isHeavyDay = dow % 2 === 1; // Mon, Wed, Fri = heavy
    dailyTargetMins = isHeavyDay ? Math.round(dailyTargetMins * 1.3) : Math.round(dailyTargetMins * 0.7);
  } else if (pacingStyle === 'sprint-rest') {
    // 4 heavy days, then 1 light (review only)
    const dayOfWeekCycle = dow === 0 ? 6 : dow - 1; // Mon=0 through Sun=6
    const isRestDay = dayOfWeekCycle % 5 === 4; // Every 5th day
    dailyTargetMins = isRestDay ? Math.round(dailyTargetMins * 0.4) : Math.round(dailyTargetMins * 1.15);
  }

  // Cap at available hours
  dailyTargetMins = Math.min(dailyTargetMins, availableHrs * 60);

  // If today is an unavailable day, return empty
  if (availableHrs <= 0) {
    return { todayTasks: [], workAheadTasks: [], dailyTargetMins: 0, availableMins: 0, remainingMins };
  }

  // Fill today's queue from the next undone tasks
  const todayTasks = [];
  const workAheadTasks = [];
  let todayMins = 0;
  let targetReached = false;

  for (const task of queue) {
    if (task.done) continue;

    if (!targetReached && todayMins < dailyTargetMins) {
      todayTasks.push(task);
      todayMins += task.estimatedMins || 0;
      if (todayMins >= dailyTargetMins) targetReached = true;
    } else {
      // Work-ahead pool (show next ~3h worth)
      const aheadMins = workAheadTasks.reduce((s, t) => s + (t.estimatedMins || 0), 0);
      if (aheadMins < 180) workAheadTasks.push(task);
    }
  }

  return {
    todayTasks,
    workAheadTasks,
    dailyTargetMins,
    todayPlannedMins: todayMins,
    availableMins: availableHrs * 60,
    remainingMins,
    studyDaysRemaining,
  };
}


// ── PROGRESS METRICS ────────────────────────────────────────────────

/**
 * Compute progress metrics from the task queue.
 */
export function computeProgress(queue, options = {}) {
  const { targetDate = null, startDate = null, weeklyHours = 0 } = options;
  const today = todayStr();

  // Basic counts
  const allTasks = queue.filter(t => t.category !== 'break');
  const doneTasks = allTasks.filter(t => t.done);
  const totalMins = allTasks.reduce((s, t) => s + (t.estimatedMins || 60), 0);
  const doneMins = doneTasks.reduce((s, t) => s + (t.actualMins || t.estimatedMins || 60), 0);
  const remainingMins = totalMins - doneMins;
  const pct = totalMins > 0 ? Math.round(doneMins / totalMins * 100) : 0;

  // Per-course breakdown
  const courseProgress = {};
  for (const t of allTasks) {
    const key = t.course_code || 'Other';
    if (!courseProgress[key]) courseProgress[key] = { total: 0, done: 0, tasks: 0, tasksDone: 0 };
    courseProgress[key].total += t.estimatedMins || 60;
    courseProgress[key].tasks++;
    if (t.done) {
      courseProgress[key].done += t.actualMins || t.estimatedMins || 60;
      courseProgress[key].tasksDone++;
    }
  }

  // SPI (Schedule Performance Index)
  let spi = 1.0;
  let status = 'on-track'; // 'ahead' | 'on-track' | 'behind' | 'at-risk'
  let daysRemaining = null;
  let dailyNeedMins = 0;

  if (targetDate && startDate) {
    const totalDays = Math.max(1, diffDays(startDate, targetDate));
    const elapsed = Math.max(0, diffDays(startDate, today));
    const timePct = Math.min(1, elapsed / totalDays);
    const expectedMins = totalMins * timePct;

    spi = expectedMins > 0 ? doneMins / expectedMins : 1.0;
    daysRemaining = Math.max(0, diffDays(today, targetDate));

    if (spi >= 1.1) status = 'ahead';
    else if (spi >= 0.9) status = 'on-track';
    else if (spi >= 0.7) status = 'behind';
    else status = 'at-risk';

    // Daily need to finish on time
    if (daysRemaining > 0) {
      dailyNeedMins = Math.ceil(remainingMins / daysRemaining);
    }
  }

  // Estimated finish date (velocity-based, clamped to prevent Infinity)
  const velocityMinsPerDay = doneTasks.length > 0 && startDate
    ? doneMins / Math.max(1, diffDays(startDate, today))
    : (weeklyHours || 28) * 60 / 7; // fallback to 4h/day if weeklyHours is 0/undefined
  const daysToFinish = velocityMinsPerDay > 0 ? Math.min(9999, Math.ceil(remainingMins / velocityMinsPerDay)) : 999;
  const estFinishDate = (() => {
    const d = new Date(today + 'T12:00:00');
    d.setDate(d.getDate() + daysToFinish);
    return d.toISOString().split('T')[0];
  })();

  return {
    totalTasks: allTasks.length,
    doneTasks: doneTasks.length,
    totalMins,
    doneMins,
    remainingMins,
    pct,
    spi: Math.round(spi * 100) / 100,
    status,
    daysRemaining,
    dailyNeedMins,
    estFinishDate,
    daysToFinish,
    courseProgress,
    totalHrs: Math.round(totalMins / 60 * 10) / 10,
    doneHrs: Math.round(doneMins / 60 * 10) / 10,
    remainingHrs: Math.round(remainingMins / 60 * 10) / 10,
    dailyNeedHrs: Math.round(dailyNeedMins / 60 * 10) / 10,
  };
}
