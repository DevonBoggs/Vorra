// Undo/Redo Stack — session-level snapshot system for bulk schedule operations
// Memory-only (not persisted to localStorage) — clears on app restart
// Max 10 snapshots to limit memory usage (~80KB per snapshot × 10 = ~800KB)

import { dlog } from './debug.js';
import { toast } from './toast.js';

const MAX_STACK = 10;

let _undoStack = []; // Array of { timestamp, label, tasks }
let _redoStack = [];
let _subscribers = [];

function notify() {
  const state = { canUndo: _undoStack.length > 0, canRedo: _redoStack.length > 0, undoLabel: _undoStack.length > 0 ? _undoStack[_undoStack.length - 1].label : '', redoLabel: _redoStack.length > 0 ? _redoStack[_redoStack.length - 1].label : '' };
  _subscribers.forEach(fn => fn(state));
}

/**
 * Take a snapshot of data.tasks before a bulk operation.
 * Call this BEFORE modifying tasks.
 */
export function pushUndoSnapshot(label, tasks) {
  // Deep copy tasks
  const snapshot = JSON.parse(JSON.stringify(tasks || {}));
  _undoStack.push({ timestamp: Date.now(), label, tasks: snapshot });
  // Trim oldest if over limit
  if (_undoStack.length > MAX_STACK) _undoStack.shift();
  // Clear redo stack (new branch)
  _redoStack = [];
  dlog('info', 'undo', `Snapshot: "${label}" (${_undoStack.length} in stack)`);
  notify();
}

/**
 * Undo the last bulk operation.
 * Returns the tasks to restore, or null if nothing to undo.
 */
export function undo(currentTasks) {
  if (_undoStack.length === 0) return null;
  const snapshot = _undoStack.pop();
  // Push current state to redo stack
  _redoStack.push({ timestamp: Date.now(), label: snapshot.label, tasks: JSON.parse(JSON.stringify(currentTasks || {})) });
  dlog('info', 'undo', `Undo: "${snapshot.label}" (${_undoStack.length} remaining)`);
  toast(`Undone: ${snapshot.label}`, 'info');
  notify();
  return snapshot.tasks;
}

/**
 * Redo the last undone operation.
 * Returns the tasks to restore, or null if nothing to redo.
 */
export function redo(currentTasks) {
  if (_redoStack.length === 0) return null;
  const snapshot = _redoStack.pop();
  // Push current state to undo stack
  _undoStack.push({ timestamp: Date.now(), label: snapshot.label, tasks: JSON.parse(JSON.stringify(currentTasks || {})) });
  dlog('info', 'undo', `Redo: "${snapshot.label}" (${_redoStack.length} remaining)`);
  toast(`Redone: ${snapshot.label}`, 'info');
  notify();
  return snapshot.tasks;
}

/**
 * Check if undo/redo is available.
 */
export function canUndo() { return _undoStack.length > 0; }
export function canRedo() { return _redoStack.length > 0; }
export function getUndoLabel() { return _undoStack.length > 0 ? _undoStack[_undoStack.length - 1].label : ''; }
export function getRedoLabel() { return _redoStack.length > 0 ? _redoStack[_redoStack.length - 1].label : ''; }

/**
 * Clear both stacks (e.g., when a new plan is generated).
 */
export function clearUndoStack() {
  _undoStack = [];
  _redoStack = [];
  notify();
}

/**
 * React hook to subscribe to undo/redo state changes.
 */
import { useState, useEffect } from 'react';
export function useUndoState() {
  const [state, setState] = useState({ canUndo: false, canRedo: false, undoLabel: '', redoLabel: '' });
  useEffect(() => {
    _subscribers.push(setState);
    return () => { _subscribers = _subscribers.filter(fn => fn !== setState); };
  }, []);
  return state;
}
