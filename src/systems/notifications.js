// Notification & Reminder System
// Works in both Electron (via window.vorra.notify) and browser (via Notification API)
// Features:
// - Study reminders at configurable intervals
// - Task due notifications
// - Break reminders (after X minutes of studying)
// - Streak maintenance reminders
// - Timer completion alerts

import { useState, useEffect, useRef } from 'react';
import { dlog } from './debug.js';

// ── Active Reminders ───────────────────────────────────────────────
const _reminders = new Map(); // id -> { timerId, title, body, repeat, delayMs }

// ── Default Settings Shape ─────────────────────────────────────────
// notifications: {
//   enabled: true,
//   studyReminder: { enabled: false, intervalMinutes: 60 },
//   breakReminder: { enabled: true, studyMinutes: 45 },
//   streakReminder: { enabled: true, hour: 20, minute: 0 },
//   taskReminders: { enabled: true, minutesBefore: 15 },
//   sound: true,
// }

// ── Permission ─────────────────────────────────────────────────────

/**
 * Request browser notification permission.
 * Returns the permission state: 'granted', 'denied', or 'default'.
 */
export async function requestPermission() {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') {
      dlog('warn', 'notify', 'Notification permission denied by user');
      return 'denied';
    }
    try {
      const result = await Notification.requestPermission();
      dlog('info', 'notify', `Permission result: ${result}`);
      return result;
    } catch (e) {
      dlog('error', 'notify', `Permission request failed: ${e.message}`);
      return 'default';
    }
  }
  // Electron or no API — assume granted
  return 'granted';
}

// ── Show Notification ──────────────────────────────────────────────

/**
 * Cross-platform notification display.
 * Tries Electron bridge first, falls back to browser Notification API,
 * then falls back to console.log.
 *
 * @param {string} title - Notification title
 * @param {string} body - Notification body text
 * @param {object} [options] - Additional options (icon, silent, etc.)
 */
export function showNotification(title, body, options = {}) {
  dlog('info', 'notify', `Showing: "${title}" — ${body}`);

  // 1. Try Electron bridge
  if (typeof window !== 'undefined' && window.vorra && window.vorra.notify && window.vorra.notify.show) {
    try {
      window.vorra.notify.show(title, body, options);
      return;
    } catch (e) {
      dlog('warn', 'notify', `Electron notify failed: ${e.message}`);
    }
  }

  // 2. Try browser Notification API
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body, ...options });
      return;
    } catch (e) {
      dlog('warn', 'notify', `Browser Notification failed: ${e.message}`);
    }
  }

  // 3. Fallback to console
  console.log(`[Vorra Notification] ${title}: ${body}`);
}

// ── Schedule / Cancel Reminders ────────────────────────────────────

/**
 * Schedule a future notification.
 *
 * @param {string} id - Unique reminder ID (used for cancellation)
 * @param {object} config
 * @param {string} config.title - Notification title
 * @param {string} config.body - Notification body
 * @param {number} config.delayMs - Delay in milliseconds before first notification
 * @param {boolean} [config.repeat=false] - If true, repeats every delayMs
 */
export function scheduleReminder(id, { title, body, delayMs, repeat = false }) {
  // Cancel existing reminder with the same ID
  cancelReminder(id);

  if (!delayMs || delayMs <= 0) {
    dlog('warn', 'notify', `Invalid delay for reminder "${id}": ${delayMs}`);
    return;
  }

  dlog('info', 'notify', `Scheduling "${id}": "${title}" in ${Math.round(delayMs / 1000)}s${repeat ? ' (repeating)' : ''}`);

  const fire = () => showNotification(title, body);

  if (repeat) {
    // Fire once after initial delay, then repeat
    const initialTimer = setTimeout(() => {
      fire();
      const intervalId = setInterval(fire, delayMs);
      // Update the stored timer to the interval
      _reminders.set(id, { timerId: intervalId, timerType: 'interval', title, body, repeat, delayMs });
    }, delayMs);
    _reminders.set(id, { timerId: initialTimer, timerType: 'timeout', title, body, repeat, delayMs });
  } else {
    const timerId = setTimeout(() => {
      fire();
      _reminders.delete(id);
    }, delayMs);
    _reminders.set(id, { timerId, timerType: 'timeout', title, body, repeat, delayMs });
  }
}

/**
 * Cancel a scheduled reminder by ID.
 * @param {string} id
 */
export function cancelReminder(id) {
  const entry = _reminders.get(id);
  if (!entry) return;

  if (entry.timerType === 'interval') {
    clearInterval(entry.timerId);
  } else {
    clearTimeout(entry.timerId);
  }
  _reminders.delete(id);
  dlog('debug', 'notify', `Cancelled reminder: ${id}`);
}

/**
 * Cancel all active reminders.
 */
export function cancelAllReminders() {
  const count = _reminders.size;
  for (const [id] of _reminders) {
    cancelReminder(id);
  }
  dlog('info', 'notify', `Cancelled all ${count} reminders`);
}

/**
 * List active reminders.
 * @returns {Array<{id: string, title: string, body: string, repeat: boolean, delayMs: number}>}
 */
export function getActiveReminders() {
  const result = [];
  for (const [id, entry] of _reminders) {
    result.push({
      id,
      title: entry.title,
      body: entry.body,
      repeat: entry.repeat,
      delayMs: entry.delayMs,
    });
  }
  return result;
}

// ── Reminder Presets ───────────────────────────────────────────────

/**
 * Schedule a recurring study reminder.
 * "Time to study!" every N minutes.
 *
 * @param {number} intervalMinutes
 */
export function scheduleStudyReminder(intervalMinutes) {
  if (!intervalMinutes || intervalMinutes <= 0) return;
  scheduleReminder('study-reminder', {
    title: 'Time to Study!',
    body: `Your ${intervalMinutes}-minute study reminder. Stay on track with your goals!`,
    delayMs: intervalMinutes * 60 * 1000,
    repeat: true,
  });
}

/**
 * Schedule a break reminder after N minutes of studying.
 * "Take a break!" fires once after the specified study duration.
 *
 * @param {number} studyMinutes - Minutes of studying before break reminder
 */
export function scheduleBreakReminder(studyMinutes) {
  if (!studyMinutes || studyMinutes <= 0) return;
  scheduleReminder('break-reminder', {
    title: 'Take a Break!',
    body: `You've been studying for ${studyMinutes} minutes. Rest your eyes and stretch!`,
    delayMs: studyMinutes * 60 * 1000,
    repeat: true,
  });
}

/**
 * Schedule a daily streak maintenance reminder at a specific time.
 * "Don't break your streak!" fires once per day.
 *
 * @param {number} hour - Hour (0-23)
 * @param {number} minute - Minute (0-59)
 */
export function scheduleStreakReminder(hour, minute) {
  // Calculate delay until the target time
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  // If the target time has already passed today, schedule for tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delayMs = target.getTime() - now.getTime();

  // Cancel existing and schedule as a one-shot, then reschedule after it fires
  cancelReminder('streak-reminder');

  dlog('info', 'notify', `Streak reminder: next fire in ${Math.round(delayMs / 60000)}min (${hour}:${String(minute).padStart(2, '0')})`);

  const timerId = setTimeout(() => {
    showNotification(
      "Don't Break Your Streak!",
      'Make sure to log a study session today to keep your streak going!'
    );
    // Reschedule for the next day
    scheduleStreakReminder(hour, minute);
  }, delayMs);

  _reminders.set('streak-reminder', {
    timerId,
    timerType: 'timeout',
    title: "Don't Break Your Streak!",
    body: 'Daily streak maintenance reminder',
    repeat: true,
    delayMs,
  });
}

/**
 * Schedule a reminder before a task's due time.
 *
 * @param {object} task - Task object with at minimum { id, title, scheduledTime }
 * @param {number} minutesBefore - Minutes before the task to fire the reminder
 */
export function scheduleTaskReminder(task, minutesBefore) {
  if (!task || !task.scheduledTime || !minutesBefore) return;

  const taskTime = new Date(task.scheduledTime).getTime();
  const fireTime = taskTime - (minutesBefore * 60 * 1000);
  const now = Date.now();
  const delayMs = fireTime - now;

  // Don't schedule if the reminder time has already passed
  if (delayMs <= 0) {
    dlog('debug', 'notify', `Task reminder for "${task.title}" already past — skipping`);
    return;
  }

  const id = `task-${task.id || task.title.replace(/\s+/g, '-').slice(0, 30)}`;

  scheduleReminder(id, {
    title: 'Upcoming Task',
    body: `"${task.title}" starts in ${minutesBefore} minute${minutesBefore !== 1 ? 's' : ''}!`,
    delayMs,
    repeat: false,
  });
}

// ── Timer Completion Alert ─────────────────────────────────────────

/**
 * Show a timer completion notification.
 * Called when a study timer finishes.
 *
 * @param {string} taskTitle - The task that was being studied
 * @param {number} elapsedMs - How long the session lasted
 */
export function notifyTimerComplete(taskTitle, elapsedMs) {
  const minutes = Math.round(elapsedMs / 60000);
  showNotification(
    'Study Session Complete!',
    `Great work! You studied "${taskTitle || 'Untitled'}" for ${minutes} minute${minutes !== 1 ? 's' : ''}.`
  );
}

// ── React Hook ─────────────────────────────────────────────────────

/**
 * React hook for managing notification reminders based on settings.
 * Sets up and tears down reminders when settings change.
 *
 * @param {object} settings - The notifications settings object
 * @param {boolean} settings.enabled - Master toggle
 * @param {object} settings.studyReminder - { enabled, intervalMinutes }
 * @param {object} settings.breakReminder - { enabled, studyMinutes }
 * @param {object} settings.streakReminder - { enabled, hour, minute }
 * @param {object} settings.taskReminders - { enabled, minutesBefore }
 * @param {boolean} settings.sound - Whether to play sound with notifications
 */
export function useNotifications(settings) {
  const prevSettings = useRef(null);

  useEffect(() => {
    if (!settings || !settings.enabled) {
      // Master toggle off — cancel everything
      cancelAllReminders();
      prevSettings.current = settings;
      return;
    }

    // Request permission on first enable
    requestPermission();

    // Study reminder
    if (settings.studyReminder?.enabled && settings.studyReminder?.intervalMinutes > 0) {
      scheduleStudyReminder(settings.studyReminder.intervalMinutes);
    } else {
      cancelReminder('study-reminder');
    }

    // Break reminder
    if (settings.breakReminder?.enabled && settings.breakReminder?.studyMinutes > 0) {
      scheduleBreakReminder(settings.breakReminder.studyMinutes);
    } else {
      cancelReminder('break-reminder');
    }

    // Streak reminder
    if (settings.streakReminder?.enabled) {
      const hour = settings.streakReminder.hour ?? 20;
      const minute = settings.streakReminder.minute ?? 0;
      scheduleStreakReminder(hour, minute);
    } else {
      cancelReminder('streak-reminder');
    }

    prevSettings.current = settings;

    // Cleanup on unmount
    return () => {
      cancelAllReminders();
    };
  }, [
    settings?.enabled,
    settings?.studyReminder?.enabled,
    settings?.studyReminder?.intervalMinutes,
    settings?.breakReminder?.enabled,
    settings?.breakReminder?.studyMinutes,
    settings?.streakReminder?.enabled,
    settings?.streakReminder?.hour,
    settings?.streakReminder?.minute,
  ]);
}
