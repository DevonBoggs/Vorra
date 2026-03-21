// Shared planning calculation functions
// Extracted from CoursePlanner for reuse across pages

import { safeArr } from './toolExecution.js';

export const MAX_STUDY_HRS = 18;

/**
 * Calculate total estimated study hours across active courses.
 * Falls back to difficulty-based estimate if averageStudyHours is not set.
 */
export const calcTotalEstHours = (courses) => {
  const active = (courses || []).filter(c => c.status !== 'completed');
  return active.reduce((s, c) => {
    if (c.averageStudyHours > 0) return s + c.averageStudyHours;
    const base = [0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50;
    return s + base;
  }, 0);
};

/**
 * Count study days between two dates, excluding exception dates.
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @param {string[]} exceptionDates - array of YYYY-MM-DD to exclude
 * @returns {number}
 */
export const calcStudyDays = (fromDate, toDate, exceptionDates = []) => {
  if (!fromDate || !toDate) return 0;
  let count = 0;
  const d = new Date(fromDate + 'T12:00:00');
  const end = new Date(toDate + 'T12:00:00');
  let safety = 0;
  while (d <= end && safety < 1000) {
    const ds = d.toISOString().split('T')[0];
    if (!exceptionDates.includes(ds)) count++;
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return count;
};

/**
 * Calculate minimum hours/day needed to finish by a target date,
 * taking into account additional exception dates.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} targetDate - YYYY-MM-DD
 * @param {number} totalEstHours - total hours of study needed
 * @param {string[]} exceptionDates - base exception dates
 * @param {string[]} extraDates - additional dates to exclude
 * @returns {number|null}
 */
export const calcMinHrsWithDates = (startDate, targetDate, totalEstHours, exceptionDates = [], extraDates = []) => {
  if (!targetDate || !startDate) return null;
  const allEx = [...exceptionDates, ...extraDates];
  const count = calcStudyDays(startDate, targetDate, allEx);
  return count > 0 ? Math.ceil((totalEstHours / count) * 10) / 10 : 999;
};

/**
 * Estimate the completion date given a start date, number of raw study days needed,
 * and exception dates to skip.
 * @param {string} startDate - YYYY-MM-DD
 * @param {number} rawDaysNeeded - number of study days needed
 * @param {string[]} exceptionDates - dates to skip
 * @returns {string|null} YYYY-MM-DD
 */
export const calcEstCompletion = (startDate, rawDaysNeeded, exceptionDates = []) => {
  if (!startDate) return null;
  let remaining = rawDaysNeeded;
  const d = new Date(startDate + 'T12:00:00');
  let safety = 0;
  while (remaining > 0 && safety < 1000) {
    const ds = d.toISOString().split('T')[0];
    if (!exceptionDates.includes(ds)) remaining--;
    d.setDate(d.getDate() + 1);
    safety++;
  }
  return d.toISOString().split('T')[0];
};
