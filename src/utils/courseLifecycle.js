// Course Lifecycle Utilities — shared course-completion cleanup and acceleration logic

import { todayStr } from './helpers.js';
import { matchTaskToCourse } from './toolExecution.js';

/**
 * Remove future plan tasks for a completed course from data.tasks.
 * Returns the cleaned tasks object (does not call setData).
 */
export function removeFutureCourseTasks(tasks, course, courses) {
  const today = todayStr();
  const cleaned = { ...tasks };
  let removed = 0;

  for (const [dt, dayTasks] of Object.entries(cleaned)) {
    if (dt <= today) continue;
    const filtered = dayTasks.filter(t => {
      if (!t.planId) return true; // keep non-plan tasks
      const { courseKey } = matchTaskToCourse(t.title, courses);
      const matches = courseKey === (course.courseCode || course.name);
      if (matches) removed++;
      return !matches;
    });
    if (filtered.length !== dayTasks.length) {
      cleaned[dt] = filtered.length > 0 ? filtered : undefined;
      if (!cleaned[dt]) delete cleaned[dt];
    }
  }

  return { tasks: cleaned, removed };
}

/**
 * Find the next undone plan task from a date forward.
 * Returns { task, date } or null.
 */
export function findNextUndonePlanTask(tasks, planId, fromDate, excludeDate = null) {
  const sortedDates = Object.keys(tasks || {}).filter(d => d >= fromDate && d !== excludeDate).sort();
  for (const dt of sortedDates) {
    for (const t of (tasks[dt] || [])) {
      if (t.planId === planId && !t.done && t.category !== 'break') {
        return { task: t, date: dt };
      }
    }
  }
  return null;
}

/**
 * Pull a task from a future date to today.
 * Returns the updated tasks object with the task moved and a ghost placeholder left behind.
 */
export function pullTaskToToday(tasks, taskId, sourceDate, today) {
  const updated = { ...tasks };
  const sourceTasks = [...(updated[sourceDate] || [])];
  const taskIdx = sourceTasks.findIndex(t => t.id === taskId);
  if (taskIdx < 0) return { tasks: updated, pulled: null };

  const task = { ...sourceTasks[taskIdx] };
  // Remove from source and leave ghost placeholder
  sourceTasks[taskIdx] = { ...task, _pulledTo: today, _ghost: true, done: true };
  updated[sourceDate] = sourceTasks;

  // Add to today
  const todayTasks = [...(updated[today] || [])];
  todayTasks.push({ ...task, _pulledFrom: sourceDate, accelerated: true });
  updated[today] = todayTasks;

  return { tasks: updated, pulled: task };
}

/**
 * Compute actual hours completed per course from tasks data.
 * Returns { courseCode: { done: hours, planned: hours, tasksDone: n, tasksTotal: n } }
 */
export function computeCourseProgress(tasks, planId, courses) {
  const progress = {};
  for (const [, dayTasks] of Object.entries(tasks || {})) {
    for (const t of (dayTasks || [])) {
      if (t.planId !== planId || t._ghost) continue;
      const { courseKey } = matchTaskToCourse(t.title, courses);
      if (!progress[courseKey]) progress[courseKey] = { done: 0, planned: 0, tasksDone: 0, tasksTotal: 0 };
      const st = t.time ? t.time.split(':').map(Number) : null;
      const et = t.endTime ? t.endTime.split(':').map(Number) : null;
      const mins = st && et ? Math.max(0, (et[0] * 60 + et[1]) - (st[0] * 60 + st[1])) : 0;
      progress[courseKey].planned += mins / 60;
      progress[courseKey].tasksTotal++;
      if (t.done) {
        progress[courseKey].done += mins / 60;
        progress[courseKey].tasksDone++;
      }
    }
  }
  return progress;
}
