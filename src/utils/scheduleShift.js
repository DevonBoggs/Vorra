// Schedule Shift — cascading task redistribution when student falls behind
// Handles: full day missed, partial day, fixed exam dates, capacity limits

import { getEffectiveHours } from './availabilityCalc.js';
import { parseTime, todayStr } from './helpers.js';

/**
 * Shift undone tasks from a source date to future available days.
 * Cascades: if a target day gets overloaded, its excess shifts further.
 *
 * @param {Object} tasks - Full data.tasks object
 * @param {string} sourceDate - The date to shift tasks FROM (YYYY-MM-DD)
 * @param {Object} plannerConfig - Weekly availability config
 * @param {Array} exceptionDates - Dates with no study
 * @param {Object} options - { partialThreshold: 0.5, maxLookAhead: 30, fixedExamDates: {} }
 * @returns {Object} { updatedTasks, shiftedCount, summary, warnings }
 */
export function shiftUndoneTasks(tasks, sourceDate, plannerConfig, exceptionDates = [], options = {}) {
  const { partialThreshold = 0.5, maxLookAhead = 30, fixedExamDates = {} } = options;
  const updated = JSON.parse(JSON.stringify(tasks)); // deep copy
  const warnings = [];
  let shiftedCount = 0;
  const shiftLog = [];

  // Get undone non-break tasks from source date
  const sourceTasks = (updated[sourceDate] || []).filter(t => !t.done && t.category !== 'break' && !t._ghost);
  if (sourceTasks.length === 0) return { updatedTasks: updated, shiftedCount: 0, summary: 'No tasks to shift', warnings: [] };

  // Handle partial completions: if task was partially done (started timer), check threshold
  // For now, all undone tasks shift entirely

  // Remove undone tasks from source date (keep done tasks and breaks)
  updated[sourceDate] = (updated[sourceDate] || []).filter(t => t.done || t.category === 'break' || t._ghost);
  if (updated[sourceDate].length === 0) delete updated[sourceDate];

  // Build a queue of tasks to place
  let toPlace = [...sourceTasks];

  // Scan forward day by day to find landing spots
  const startDate = new Date(sourceDate + 'T12:00:00');
  startDate.setDate(startDate.getDate() + 1); // start from tomorrow

  for (let dayOffset = 0; dayOffset < maxLookAhead && toPlace.length > 0; dayOffset++) {
    const dt = new Date(startDate);
    dt.setDate(dt.getDate() + dayOffset);
    const ds = dt.toISOString().split('T')[0];
    const dow = dt.getDay();

    // Skip exception dates
    if (exceptionDates.includes(ds)) continue;

    // Skip unavailable days
    const dayAvail = plannerConfig ? getEffectiveHours(plannerConfig, dow) : 8;
    if (dayAvail <= 0) continue;

    // Calculate current load on this day
    const existingTasks = updated[ds] || [];
    let existingMins = 0;
    for (const t of existingTasks) {
      if (t._ghost) continue;
      const st = parseTime(t.time), et = parseTime(t.endTime);
      if (st && et) existingMins += Math.max(0, et.mins - st.mins);
    }
    const existingHrs = existingMins / 60;
    const capacityHrs = dayAvail - existingHrs;

    if (capacityHrs <= 0) continue; // Day is full

    // Place as many tasks as fit
    let capacityMins = capacityHrs * 60;
    const placed = [];
    const remaining = [];

    for (const task of toPlace) {
      const st = parseTime(task.time), et = parseTime(task.endTime);
      const taskMins = st && et ? Math.max(0, et.mins - st.mins) : 60;

      if (taskMins <= capacityMins) {
        // Task fits — place it here
        // Adjust time to fit after existing tasks
        const lastEnd = existingTasks.reduce((max, t) => {
          if (t._ghost) return max;
          const e = parseTime(t.endTime);
          return e ? Math.max(max, e.mins) : max;
        }, 0);
        const newStart = Math.max(lastEnd, parseTime(task.time)?.mins || 0);
        const newEnd = newStart + taskMins;
        const shiftedTask = {
          ...task,
          time: `${String(Math.floor(newStart / 60)).padStart(2, '0')}:${String(newStart % 60).padStart(2, '0')}`,
          endTime: `${String(Math.floor(newEnd / 60)).padStart(2, '0')}:${String(newEnd % 60).padStart(2, '0')}`,
          _shiftedFrom: sourceDate,
        };
        placed.push(shiftedTask);
        capacityMins -= taskMins;
        existingMins += taskMins;
        shiftedCount++;
        shiftLog.push({ task: task.title, from: sourceDate, to: ds });
      } else {
        remaining.push(task);
      }
    }

    if (placed.length > 0) {
      if (!updated[ds]) updated[ds] = [];
      updated[ds].push(...placed);
    }

    // Check if this day now displaces any of its OWN tasks (cascade)
    const totalDayMins = (updated[ds] || []).reduce((s, t) => {
      if (t._ghost) return s;
      const st = parseTime(t.time), et = parseTime(t.endTime);
      return s + (st && et ? Math.max(0, et.mins - st.mins) : 0);
    }, 0);

    if (totalDayMins / 60 > dayAvail * 1.1) {
      // Day is overloaded — cascade: move the LAST tasks on this day to the queue
      const dayTasks = (updated[ds] || []).filter(t => !t.done && !t._ghost);
      const excessMins = totalDayMins - dayAvail * 60;
      let removed = 0;
      for (let i = dayTasks.length - 1; i >= 0 && removed < excessMins; i--) {
        const t = dayTasks[i];
        const st = parseTime(t.time), et = parseTime(t.endTime);
        const mins = st && et ? Math.max(0, et.mins - st.mins) : 0;
        remaining.push(t);
        updated[ds] = (updated[ds] || []).filter(x => x.id !== t.id);
        removed += mins;
      }
      if (updated[ds]?.length === 0) delete updated[ds];
    }

    toPlace = remaining;
  }

  // Check for tasks that couldn't be placed
  if (toPlace.length > 0) {
    warnings.push(`${toPlace.length} task(s) could not be placed within ${maxLookAhead} days. Schedule may need to be extended.`);
    // Place them on the last available day as overflow
    const overflowDate = new Date(startDate);
    overflowDate.setDate(overflowDate.getDate() + maxLookAhead - 1);
    const overflowDs = overflowDate.toISOString().split('T')[0];
    if (!updated[overflowDs]) updated[overflowDs] = [];
    updated[overflowDs].push(...toPlace.map(t => ({ ...t, _shiftedFrom: sourceDate, _overflow: true })));
    shiftedCount += toPlace.length;
  }

  // Check fixed exam date conflicts
  for (const [courseCode, examDate] of Object.entries(fixedExamDates)) {
    // Check if any shifted tasks for this course land on or after the exam date
    const shiftedPast = shiftLog.filter(l => l.task.toLowerCase().includes(courseCode.toLowerCase()) && l.to >= examDate);
    if (shiftedPast.length > 0) {
      warnings.push(`${courseCode}: ${shiftedPast.length} task(s) shifted to or past exam date (${examDate}). Exam prep may be compressed.`);
    }
  }

  const summary = shiftedCount > 0
    ? `Shifted ${shiftedCount} task${shiftedCount !== 1 ? 's' : ''} from ${sourceDate} to upcoming days`
    : 'No tasks needed shifting';

  return { updatedTasks: updated, shiftedCount, summary, warnings, shiftLog };
}

/**
 * Auto-detect undone tasks from today and previous days, offer to shift.
 */
export function detectUndoneTasks(tasks, today, lookBackDays = 1) {
  const undone = [];
  for (let i = 0; i <= lookBackDays; i++) {
    const dt = new Date(today + 'T12:00:00');
    dt.setDate(dt.getDate() - i);
    const ds = dt.toISOString().split('T')[0];
    if (ds > today) continue;
    const dayTasks = (tasks[ds] || []).filter(t => !t.done && t.category !== 'break' && !t._ghost);
    if (dayTasks.length > 0) {
      undone.push({ date: ds, tasks: dayTasks, count: dayTasks.length });
    }
  }
  return undone;
}
