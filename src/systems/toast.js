// Toast Notification System

import { useState, useEffect } from "react";
import { dlog } from "./debug.js";

let _toasts = [];
let _toastSubs = [];
let _toastId = 0;

export function toast(message, type = "info", duration = 3500) {
  const id = ++_toastId;
  _toasts.push({ id, message, type, ts: Date.now() });
  _toastSubs.forEach(fn => fn([..._toasts]));
  setTimeout(() => {
    _toasts = _toasts.filter(t => t.id !== id);
    _toastSubs.forEach(fn => fn([..._toasts]));
  }, duration);
  dlog('debug', 'ui', `Toast [${type}]: ${message}`);
}

export function useToasts() {
  const [t, setT] = useState([..._toasts]);
  useEffect(() => {
    _toastSubs.push(setT);
    return () => { _toastSubs = _toastSubs.filter(fn => fn !== setT); };
  }, []);
  return t;
}
