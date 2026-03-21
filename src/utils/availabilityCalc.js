// Availability calculation utilities for study planner
// All functions are pure — computed at render time, never stored

import { todayStr } from './helpers.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export { DAY_NAMES };

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToTime(m) {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/**
 * Expand a time range into intervals, handling overnight wrapping (e.g., 22:00-06:00).
 * Returns array of {start, end} in minutes, split at midnight if needed.
 */
function expandTimeRange(startTime, endTime) {
  const s = timeToMinutes(startTime);
  const e = timeToMinutes(endTime);
  if (e > s) return [{ start: s, end: e }];
  // Overnight: split into [start..midnight] + [midnight..end]
  if (e < s) return [{ start: s, end: 1440 }, { start: 0, end: e }];
  return []; // same time = zero duration
}

/**
 * Compute effective study hours for a specific day of the week.
 * weeklyAvailability windows minus commitment overlaps.
 * Handles overnight commitments (e.g., night shift 22:00-06:00).
 */
export function getEffectiveHours(plannerConfig, dayOfWeek) {
  if (!plannerConfig?.weeklyAvailability) return 4; // legacy fallback
  const day = plannerConfig.weeklyAvailability[dayOfWeek];
  if (!day || !day.available || !day.windows?.length) return 0;

  let totalMinutes = 0;
  for (const w of day.windows) {
    const ranges = expandTimeRange(w.start, w.end);
    for (const r of ranges) totalMinutes += r.end - r.start;
  }

  // Subtract overlapping commitments (handle overnight commitments)
  const dayCommitments = (plannerConfig.commitments || [])
    .filter(c => c.days?.includes(dayOfWeek));
  for (const c of dayCommitments) {
    const commitRanges = expandTimeRange(c.start, c.end);
    for (const cr of commitRanges) {
      for (const w of day.windows) {
        const winRanges = expandTimeRange(w.start, w.end);
        for (const wr of winRanges) {
          const overlapStart = Math.max(wr.start, cr.start);
          const overlapEnd = Math.min(wr.end, cr.end);
          if (overlapEnd > overlapStart) {
            totalMinutes -= (overlapEnd - overlapStart);
          }
        }
      }
    }
  }

  return Math.max(0, Math.round(totalMinutes / 60 * 10) / 10);
}

/**
 * Compute average effective hours per study day across the week.
 * Replaces the flat studyHoursPerDay for all calculations.
 */
export function getAvgHoursPerDay(plannerConfig) {
  if (!plannerConfig?.weeklyAvailability) return 4;
  let totalHours = 0;
  let studyDays = 0;
  for (let d = 0; d < 7; d++) {
    const hrs = getEffectiveHours(plannerConfig, d);
    if (hrs > 0) {
      totalHours += hrs;
      studyDays++;
    }
  }
  return studyDays > 0 ? Math.round((totalHours / studyDays) * 10) / 10 : 0;
}

/**
 * Compute total weekly available hours (sum across all 7 days).
 */
export function getWeeklyHours(plannerConfig) {
  if (!plannerConfig?.weeklyAvailability) return 28; // 4h * 7
  let total = 0;
  for (let d = 0; d < 7; d++) {
    total += getEffectiveHours(plannerConfig, d);
  }
  return Math.round(total * 10) / 10;
}

/**
 * Get study days per week (days with > 0 effective hours).
 */
export function getStudyDaysPerWeek(plannerConfig) {
  if (!plannerConfig?.weeklyAvailability) return 7;
  let count = 0;
  for (let d = 0; d < 7; d++) {
    if (getEffectiveHours(plannerConfig, d) > 0) count++;
  }
  return count;
}

/**
 * For a specific calendar date, get available study windows
 * (availability minus commitments minus exception dates).
 */
export function getDateAvailability(plannerConfig, dateStr, exceptionDates = []) {
  if (exceptionDates.includes(dateStr)) {
    return { available: false, windows: [], totalHours: 0 };
  }
  const dayOfWeek = new Date(dateStr + 'T12:00:00').getDay();

  if (!plannerConfig?.weeklyAvailability) {
    return { available: true, windows: [{ start: '08:00', end: '22:00' }], totalHours: 4 };
  }

  const day = plannerConfig.weeklyAvailability[dayOfWeek];
  if (!day || !day.available || !day.windows?.length) {
    return { available: false, windows: [], totalHours: 0 };
  }

  // Start with availability windows, subtract commitments
  const dayCommitments = (plannerConfig.commitments || [])
    .filter(c => c.days?.includes(dayOfWeek));

  // Simple approach: return the windows and total hours
  const totalHours = getEffectiveHours(plannerConfig, dayOfWeek);
  return { available: totalHours > 0, windows: day.windows, totalHours };
}

/**
 * Build per-day availability description for AI prompt.
 */
export function buildAvailabilityPrompt(plannerConfig) {
  if (!plannerConfig?.weeklyAvailability) return 'Uniform schedule: study any time during the day.';

  const lines = [];
  for (let d = 0; d < 7; d++) {
    const day = plannerConfig.weeklyAvailability[d];
    const hrs = getEffectiveHours(plannerConfig, d);
    if (!day?.available || hrs === 0) {
      lines.push(`${DAY_NAMES[d]}: OFF`);
    } else {
      const windowStr = day.windows.map(w => `${w.start}-${w.end}`).join(', ');
      lines.push(`${DAY_NAMES[d]}: ${windowStr} (${hrs}h available)`);
    }
  }

  const commitments = plannerConfig.commitments || [];
  let commitStr = '';
  if (commitments.length > 0) {
    commitStr = '\n\nBLOCKED COMMITMENTS (do NOT schedule study during these):\n' +
      commitments.map(c => `- ${c.label}: ${c.days.map(d => DAY_NAMES[d]).join('/')} ${c.start}-${c.end}`).join('\n');
  }

  return `WEEKLY AVAILABILITY:\n${lines.join('\n')}${commitStr}`;
}

/**
 * Enhanced study days calculation that respects weekly availability.
 */
export function calcStudyDaysWithAvailability(fromDate, toDate, plannerConfig, exceptionDates = []) {
  if (!fromDate || !toDate) return 0;
  let count = 0;
  const d = new Date(fromDate + 'T12:00:00');
  const end = new Date(toDate + 'T12:00:00');
  let safety = 0;
  while (d <= end && safety < 1000) {
    const ds = d.toISOString().split('T')[0];
    if (!exceptionDates.includes(ds)) {
      if (plannerConfig?.weeklyAvailability) {
        const dow = d.getDay();
        const day = plannerConfig.weeklyAvailability[dow];
        if (day?.available && getEffectiveHours(plannerConfig, dow) > 0) count++;
      } else {
        count++; // legacy: all non-exception days are study days
      }
    }
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return count;
}

/**
 * Calculate total available hours between two dates (not flat — per-day-aware).
 */
export function calcTotalAvailableHours(fromDate, toDate, plannerConfig, exceptionDates = []) {
  if (!fromDate || !toDate) return 0;
  let totalHours = 0;
  const d = new Date(fromDate + 'T12:00:00');
  const end = new Date(toDate + 'T12:00:00');
  let safety = 0;
  while (d <= end && safety < 1000) {
    const ds = d.toISOString().split('T')[0];
    if (!exceptionDates.includes(ds)) {
      totalHours += getEffectiveHours(plannerConfig, d.getDay());
    }
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return Math.round(totalHours * 10) / 10;
}

/**
 * Calculate minimum hours needed per day to finish by target, using per-day availability.
 * Returns how much of available time must be used (as a multiplier or absolute).
 */
export function calcMinHrsWithAvailability(startDate, targetDate, totalEstHours, plannerConfig, exceptionDates = []) {
  if (!startDate || !targetDate) return null;
  const totalAvail = calcTotalAvailableHours(startDate, targetDate, plannerConfig, exceptionDates);
  if (totalAvail <= 0) return 999;
  // If total available >= needed, it's feasible. Return avg needed per study day.
  const studyDays = calcStudyDaysWithAvailability(startDate, targetDate, plannerConfig, exceptionDates);
  if (studyDays <= 0) return 999;
  return Math.ceil((totalEstHours / studyDays) * 10) / 10;
}

/**
 * Estimate completion date using per-day availability.
 */
export function calcEstCompletionWithAvailability(startDate, totalEstHours, plannerConfig, exceptionDates = []) {
  if (!startDate || totalEstHours <= 0) return null;
  let remaining = totalEstHours;
  const d = new Date(startDate + 'T12:00:00');
  let safety = 0;
  while (remaining > 0 && safety < 1000) {
    const ds = d.toISOString().split('T')[0];
    if (!exceptionDates.includes(ds)) {
      const dayHrs = getEffectiveHours(plannerConfig, d.getDay());
      remaining -= dayHrs;
    }
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return d.toISOString().split('T')[0];
}

/**
 * Auto-derive study mode from university profile.
 */
export function deriveStudyMode(universityProfile) {
  if (!universityProfile) return 'sequential';
  const em = universityProfile.educationModel || '';
  const ts = universityProfile.termStructure || '';
  if (em === 'competency-based' || ts === 'self-paced') return 'sequential';
  if (em === 'credit-hour') return 'parallel';
  return 'sequential';
}

/**
 * Auto-derive target date from university profile term structure.
 */
export function deriveTargetDate(universityProfile) {
  // Use sub-term weeks if available (e.g., SNHU 8-week, ASU 7.5-week)
  if (universityProfile?.subTermWeeks) {
    const days = Math.round(universityProfile.subTermWeeks * 7);
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }
  const ts = universityProfile?.termStructure || '';
  const daysMap = {
    '6-month-term': 182,
    'semester': 112,
    'quarter': 70,
    'trimester': 90,
    'self-paced': 180,
  };
  const days = daysMap[ts] || 120;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

/**
 * Derive a representative "start time" from weekly availability.
 * Returns the earliest window start across all active weekdays.
 * Used to feed buildSystemPrompt and DailyPage when they need a single start time.
 */
export function deriveStartTime(plannerConfig) {
  if (!plannerConfig?.weeklyAvailability) return '08:00';
  let earliest = 1440; // midnight
  for (let d = 0; d < 7; d++) {
    const day = plannerConfig.weeklyAvailability[d];
    if (!day?.available || !day.windows?.length) continue;
    for (const w of day.windows) {
      const m = timeToMinutes(w.start);
      if (m < earliest) earliest = m;
    }
  }
  return earliest < 1440 ? minutesToTime(earliest) : '08:00';
}

/**
 * Build plannerConfig from legacy flat fields (migration helper).
 */
export function migrateToPlannerConfig(data) {
  const hrs = data.studyHoursPerDay || 4;
  const startTime = data.studyStartTime || '08:00';
  const startH = parseInt(startTime.split(':')[0]) || 8;
  const endH = Math.min(23, startH + Math.ceil(hrs));
  const endTime = `${String(endH).padStart(2, '0')}:00`;

  const weeklyAvailability = {};
  for (let d = 0; d < 7; d++) {
    weeklyAvailability[d] = {
      available: true,
      windows: [{ start: startTime, end: endTime }],
    };
  }

  return {
    version: 1,
    weeklyAvailability,
    commitments: [],
    studyMode: deriveStudyMode(data.universityProfile),
    pacingStyle: 'steady',
    blockStyle: 'standard',
    parallelCourseLimit: 2,
    lifeTemplate: null,
  };
}
