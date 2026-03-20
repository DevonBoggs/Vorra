// Study Session Timer (global, persists across pages)

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";
import { toast } from "./toast.js";

let _timerState = { running: false, taskTitle: "", startedAt: 0, elapsed: 0, paused: false, courseMatch: "" };
let _timerSubs = [];
let _timerInterval = null;
let _sessionLogFn = null;

function todayStr() { return new Date().toISOString().split("T")[0]; }

export function setSessionLogger(fn) { _sessionLogFn = fn; }

function timerNotify() { _timerSubs.forEach(fn => fn({ ..._timerState })); }

export function timerStart(title, courseHint) {
  _timerState = { running: true, taskTitle: title, startedAt: Date.now(), elapsed: 0, paused: false, courseMatch: courseHint || "" };
  clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    if (!_timerState.paused) _timerState.elapsed = Date.now() - _timerState.startedAt;
    timerNotify();
  }, 1000);
  timerNotify();
  toast(`Timer started: ${title}`, "info");
  dlog('info', 'ui', `Timer start: ${title}`);
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

export function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
