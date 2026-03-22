// ICS/iCal Export Utility — generates RFC 5545 iCalendar files from task data
import { uid } from './helpers.js';

/**
 * Escape text for iCalendar format per RFC 5545.
 * Backslash, semicolons, commas, and newlines must be escaped.
 */
function escapeICS(text) {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Fold long lines to 75 octets per RFC 5545 Section 3.1.
 */
function foldLine(line) {
  const result = [];
  while (line.length > 75) {
    result.push(line.substring(0, 75));
    line = ' ' + line.substring(75);
  }
  result.push(line);
  return result.join('\r\n');
}

/**
 * Format a date string "YYYY-MM-DD" and optional time "HH:MM" into
 * iCalendar local datetime format: YYYYMMDDTHHMMSS
 */
function formatDT(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-');
  if (timeStr) {
    const parts = timeStr.split(':');
    const hh = (parts[0] || '00').padStart(2, '0');
    const mm = (parts[1] || '00').padStart(2, '0');
    return `${y}${m}${d}T${hh}${mm}00`;
  }
  return `${y}${m}${d}T000000`;
}

/**
 * Get a DTSTAMP in UTC format for the current moment.
 */
function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/**
 * Generate an ICS calendar string from Vorra tasks.
 *
 * @param {Object} tasks - The data.tasks object: { "YYYY-MM-DD": [{ id, title, time, endTime, category, notes, done }] }
 * @param {Object} [options={}]
 * @param {string} [options.calName='Vorra Study Plan'] - Calendar name
 * @param {Object} [options.dateRange] - { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
 * @param {string[]} [options.excludeCategories=[]] - Categories to exclude (e.g., ['break'])
 * @returns {string} RFC 5545 iCalendar text
 */
export function generateICS(tasks, options = {}) {
  const {
    calName = 'Vorra Study Plan',
    dateRange,
    excludeCategories = [],
  } = options;

  const excludeSet = new Set(excludeCategories.map(c => c.toLowerCase()));
  const stamp = nowStamp();
  const lines = [];

  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//Vorra//Study Planner//EN');
  lines.push(foldLine(`X-WR-CALNAME:${escapeICS(calName)}`));
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');

  const dates = Object.keys(tasks).sort();

  for (const dateStr of dates) {
    // Apply date range filter
    if (dateRange) {
      if (dateRange.start && dateStr < dateRange.start) continue;
      if (dateRange.end && dateStr > dateRange.end) continue;
    }

    const dayTasks = tasks[dateStr];
    if (!Array.isArray(dayTasks)) continue;

    for (const task of dayTasks) {
      // Apply category filter
      if (task.category && excludeSet.has(task.category.toLowerCase())) continue;

      const eventUid = task.id || uid();

      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${eventUid}@vorra`);
      lines.push(`DTSTAMP:${stamp}`);

      // DTSTART
      const dtStart = formatDT(dateStr, task.time);
      lines.push(`DTSTART:${dtStart}`);

      // DTEND — use endTime if available, otherwise default to 1 hour after start
      if (task.endTime) {
        lines.push(`DTEND:${formatDT(dateStr, task.endTime)}`);
      } else if (task.time) {
        // Default 1 hour duration
        const [h, m] = task.time.split(':').map(Number);
        const endH = h + 1;
        const endTime = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        lines.push(`DTEND:${formatDT(dateStr, endTime)}`);
      } else {
        // All-day event style: end is start + 1 hour
        lines.push(`DTEND:${formatDT(dateStr, '01:00')}`);
      }

      lines.push(foldLine(`SUMMARY:${escapeICS(task.title || 'Untitled Task')}`));

      if (task.notes) {
        lines.push(foldLine(`DESCRIPTION:${escapeICS(task.notes)}`));
      }

      if (task.category) {
        lines.push(foldLine(`CATEGORIES:${escapeICS(task.category)}`));
      }

      if (task.done) {
        lines.push('STATUS:COMPLETED');
      }

      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');

  return lines.join('\r\n');
}

/**
 * Generate and download an ICS file.
 *
 * @param {Object} tasks - The data.tasks object
 * @param {string} [filename='vorra-study-plan.ics'] - Download filename
 * @param {Object} [options={}] - Options passed to generateICS
 */
export function downloadICS(tasks, filename = 'vorra-study-plan.ics', options = {}) {
  const icsContent = generateICS(tasks, options);
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Cleanup
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}
