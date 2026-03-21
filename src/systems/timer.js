// Study Session Timer (global, persists across pages)
// Supports both countdown (25m, 45m, custom) and count-up modes

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";
import { toast } from "./toast.js";

let _timerState = {
  running: false,
  taskTitle: "",
  startedAt: 0,
  elapsed: 0,
  paused: false,
  courseMatch: "",
  // Countdown fields
  durationMs: 0,      // 0 = count-up, >0 = countdown (total duration in ms)
  remaining: 0,        // ms remaining (countdown mode only)
  finished: false,     // true when countdown reaches 0
};
let _timerSubs = [];
let _timerInterval = null;
let _sessionLogFn = null;

function todayStr() { return new Date().toISOString().split("T")[0]; }

export function setSessionLogger(fn) { _sessionLogFn = fn; }

function timerNotify() { _timerSubs.forEach(fn => fn({ ..._timerState })); }

/**
 * Start a timer.
 * @param {string} title - Display title
 * @param {string} [courseHint] - Course name for session logging
 * @param {number} [durationMins] - If provided, runs as countdown. 0 or omitted = count-up.
 */
export function timerStart(title, courseHint, durationMins) {
  const durationMs = durationMins ? durationMins * 60000 : 0;
  _timerState = {
    running: true,
    taskTitle: title,
    startedAt: Date.now(),
    elapsed: 0,
    paused: false,
    courseMatch: courseHint || "",
    durationMs,
    remaining: durationMs,
    finished: false,
  };
  clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    if (!_timerState.paused) {
      _timerState.elapsed = Date.now() - _timerState.startedAt;
      if (_timerState.durationMs > 0) {
        _timerState.remaining = Math.max(0, _timerState.durationMs - _timerState.elapsed);
        if (_timerState.remaining <= 0 && !_timerState.finished) {
          _timerState.finished = true;
          _timerState.remaining = 0;
          toast(`Timer complete: ${title}`, "success");
          dlog('info', 'ui', `Timer countdown finished: ${title}`);
          // Auto-stop and log session
          timerStop();
          return;
        }
      }
    }
    timerNotify();
  }, 1000);
  timerNotify();
  const label = durationMins ? `${durationMins}m countdown` : 'count-up';
  toast(`Timer started: ${title} (${label})`, "info");
  dlog('info', 'ui', `Timer start: ${title} (${label})`);
}

export function timerStop() {
  clearInterval(_timerInterval);
  const mins = Math.round(_timerState.elapsed / 60000);
  if (mins >= 1 && _sessionLogFn) _sessionLogFn({ title: _timerState.taskTitle, course: _timerState.courseMatch, mins, date: todayStr(), ts: Date.now() });
  _timerState = { ..._timerState, running: false };
  timerNotify();
  toast(`Timer stopped: ${mins}m`, "success");
  dlog('info', 'ui', `Timer stop: ${mins}m`);
  return mins;
}

export function timerPause() {
  if (_timerState.paused) {
    // Resuming — adjust startedAt so elapsed stays consistent
    const pausedElapsed = _timerState.elapsed;
    _timerState.startedAt = Date.now() - pausedElapsed;
  }
  _timerState.paused = !_timerState.paused;
  timerNotify();
}

export function useTimer() {
  const [s, setS] = useState({ ..._timerState });
  useEffect(() => {
    _timerSubs.push(setS);
    return () => { _timerSubs = _timerSubs.filter(fn => fn !== setS); };
  }, []);
  return s;
}

/** Format ms as countdown or elapsed display */
export function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
