// Focus Pulse System (15-min check-in)

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";
import { toast } from "./toast.js";

let _focusState = { active: false, streak: 0, lastPulse: 0, showPulse: false, totalFocusMins: 0 };
let _focusSubs = [];
let _focusInterval = null;

function focusNotify() { _focusSubs.forEach(fn => fn({ ..._focusState })); }

export function focusStart() {
  _focusState = { active: true, streak: 0, lastPulse: Date.now(), showPulse: false, totalFocusMins: 0 };
  clearInterval(_focusInterval);
  _focusInterval = setInterval(() => {
    const mins = Math.round((Date.now() - _focusState.lastPulse) / 60000);
    if (mins >= 15 && !_focusState.showPulse) {
      _focusState.showPulse = true;
      focusNotify();
    }
  }, 10000);
  focusNotify();
  toast("Focus mode activated", "success");
}

export function focusPulseYes() {
  _focusState.showPulse = false;
  _focusState.streak++;
  _focusState.totalFocusMins += 15;
  _focusState.lastPulse = Date.now();
  focusNotify();
  toast(`Focus streak: ${_focusState.streak} (${_focusState.totalFocusMins}m)`, "success");
}

export function focusStop() {
  clearInterval(_focusInterval);
  const mins = _focusState.totalFocusMins;
  _focusState = { ..._focusState, active: false, showPulse: false };
  focusNotify();
  toast(`Focus session: ${mins}m total`, "info");
  return mins;
}

export function useFocus() {
  const [s, setS] = useState({ ..._focusState });
  useEffect(() => {
    _focusSubs.push(setS);
    return () => { _focusSubs = _focusSubs.filter(fn => fn !== setS); };
  }, []);
  return s;
}
