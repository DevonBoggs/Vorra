// Background Task System (survives page navigation)

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";

let _bgState = { loading: false, regenId: null, logs: [], label: "", streamText: "", abortCtrl: null, outerAbortCtrl: null, batchStartedAt: null, courseStartedAt: null, courseTimes: {} };
let _bgSubs = [];

function bgNotify() {
  const s = { ..._bgState, logs: [..._bgState.logs] };
  _bgSubs.forEach(fn => fn(s));
}

export function bgSet(patch) { Object.assign(_bgState, patch); bgNotify(); }
export function bgLog(entry) { _bgState.logs.push(entry); bgNotify(); }
export function bgStream(text) { _bgState.streamText = text; bgNotify(); }
export function bgClear() {
  _bgState = { loading: false, regenId: null, logs: [], label: "", streamText: "", abortCtrl: null, outerAbortCtrl: null, batchStartedAt: null, courseStartedAt: null, courseTimes: {} };
  bgNotify();
}
export function bgAbort() {
  if (_bgState.outerAbortCtrl) { _bgState.outerAbortCtrl.abort(); dlog('info', 'api', 'Aborting outer loop (planner)'); }
  if (_bgState.abortCtrl) { _bgState.abortCtrl.abort(); dlog('info', 'api', 'User cancelled operation'); }
  bgLog({ type: "error", content: "\u26d4 Cancelled by user" });
  bgSet({ loading: false, regenId: null, label: "", streamText: "", abortCtrl: null, outerAbortCtrl: null });
}
export function bgNewAbort() {
  const c = new AbortController();
  _bgState.abortCtrl = c;
  return c.signal;
}
export function getBgState() { return _bgState; }

export function useBgTask() {
  const [s, setS] = useState({ ..._bgState, logs: [..._bgState.logs] });
  useEffect(() => {
    _bgSubs.push(setS);
    return () => { _bgSubs = _bgSubs.filter(fn => fn !== setS); };
  }, []);
  return s;
}
