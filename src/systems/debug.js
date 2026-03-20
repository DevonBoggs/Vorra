// Debug Log System
// Circular buffer of 500 entries with pub/sub

import { useState, useEffect } from "react";

const MAX_LOG = 500;
let _logs = [];
let _logSubs = [];

export function dlog(level, cat, msg, detail = null) {
  const e = {
    id: Date.now() + Math.random(),
    ts: new Date().toISOString(),
    level, cat, msg,
    detail: detail != null ? (typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)) : null,
  };
  _logs.push(e);
  if (_logs.length > MAX_LOG) _logs = _logs.slice(-MAX_LOG);
  _logSubs.forEach(fn => fn([..._logs]));
  const p = `[LP:${cat}]`;
  if (level === 'error') console.error(p, msg, detail ?? '');
  else if (level === 'warn') console.warn(p, msg, detail ?? '');
  else console.log(p, msg, detail ?? '');
}

export function useDebugLog() {
  const [l, setL] = useState([..._logs]);
  useEffect(() => {
    _logSubs.push(setL);
    return () => { _logSubs = _logSubs.filter(fn => fn !== setL); };
  }, []);
  return l;
}

export function getLogText() {
  return _logs.map(e => {
    let s = `[${e.ts}] [${e.level.toUpperCase()}] [${e.cat}] ${e.msg}`;
    if (e.detail) s += `\n    ${e.detail.replace(/\n/g, '\n    ')}`;
    return s;
  }).join('\n');
}
