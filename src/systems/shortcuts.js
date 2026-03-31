// Keyboard Shortcut Registry & OS Detection
// Cross-platform shortcut system using tinykeys

import { tinykeys } from 'tinykeys';

// ── Platform Detection ──────────────────────────────────────────────

let _platform = null;

export function getPlatform() {
  if (_platform) return _platform;
  if (typeof navigator === 'undefined') return 'win';
  // Modern API first
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    const p = navigator.userAgentData.platform.toLowerCase();
    if (p.includes('mac')) { _platform = 'mac'; return _platform; }
    if (p.includes('linux')) { _platform = 'linux'; return _platform; }
    _platform = 'win';
    return _platform;
  }
  // Fallback to navigator.platform
  const p = (navigator.platform || '').toLowerCase();
  if (p.includes('mac')) { _platform = 'mac'; return _platform; }
  if (p.includes('linux')) { _platform = 'linux'; return _platform; }
  _platform = 'win';
  return _platform;
}

export function getModKey() {
  return getPlatform() === 'mac' ? 'Cmd' : 'Ctrl';
}

export function getModSymbol() {
  return getPlatform() === 'mac' ? '\u2318' : 'Ctrl';
}

// ── Format Shortcut for Display ─────────────────────────────────────

const MAC_SYMBOLS = {
  'Mod': '\u2318',
  'Ctrl': '\u2303',
  'Shift': '\u21E7',
  'Alt': '\u2325',
  'Meta': '\u2318',
  'Enter': '\u21A9',
  'Backspace': '\u232B',
  'Delete': '\u2326',
  'Escape': 'esc',
  'Space': '\u2423',
  'ArrowUp': '\u2191',
  'ArrowDown': '\u2193',
  'ArrowLeft': '\u2190',
  'ArrowRight': '\u2192',
  'Up': '\u2191',
  'Down': '\u2193',
  'Left': '\u2190',
  'Right': '\u2192',
};

const WIN_SYMBOLS = {
  'Mod': 'Ctrl',
  'Ctrl': 'Ctrl',
  'Shift': 'Shift',
  'Alt': 'Alt',
  'Meta': 'Win',
  'Enter': '\u21A9',
  'Backspace': 'Bksp',
  'Delete': 'Del',
  'Escape': 'Esc',
  'Space': 'Space',
  'ArrowUp': '\u2191',
  'ArrowDown': '\u2193',
  'ArrowLeft': '\u2190',
  'ArrowRight': '\u2192',
  'Up': '\u2191',
  'Down': '\u2193',
  'Left': '\u2190',
  'Right': '\u2192',
};

export function formatShortcut(shortcutKey) {
  if (!shortcutKey) return '';
  const isMac = getPlatform() === 'mac';
  const symbols = isMac ? MAC_SYMBOLS : WIN_SYMBOLS;
  const parts = shortcutKey.split('+');

  const formatted = parts.map(part => {
    const trimmed = part.trim();
    return symbols[trimmed] || trimmed.toUpperCase();
  });

  // On macOS, join without separator for compact display
  if (isMac) return formatted.join('');
  // On Windows/Linux, join with +
  return formatted.join('+');
}

// ── Shortcut Definitions ────────────────────────────────────────────

export const SHORTCUTS = {
  // Navigation
  'go-dashboard':     { key: 'Mod+1',       label: 'Go to Dashboard',      category: 'Navigation' },
  'go-courses':       { key: 'Mod+2',       label: 'Go to My Courses',     category: 'Navigation' },
  'go-planner':       { key: 'Mod+3',       label: 'Go to Study Planner',  category: 'Navigation' },
  'go-daily':         { key: 'Mod+4',       label: 'Go to Daily Planner',  category: 'Navigation' },
  'go-calendar':      { key: 'Mod+5',       label: 'Go to Calendar',      category: 'Navigation' },
  'go-chat':          { key: 'Mod+6',       label: 'Go to Study Chat',    category: 'Navigation' },
  'go-quiz':          { key: 'Mod+7',       label: 'Go to Practice Exam', category: 'Navigation' },
  'go-report':        { key: 'Mod+8',       label: 'Go to Weekly Report', category: 'Navigation' },
  'go-ambient':       { key: 'Mod+9',       label: 'Go to Study Radio',   category: 'Navigation' },
  'go-settings':      { key: 'Mod+,',       label: 'Settings',            category: 'Navigation' },

  // Command Palette
  'command-palette':  { key: 'Mod+K',       label: 'Command Palette',     category: 'General' },

  // Actions
  'new-task':         { key: 'Mod+N',       label: 'New Task',            category: 'Actions' },
  'quick-add':        { key: 'Mod+Shift+N', label: 'Quick Add Course',    category: 'Actions' },
  'search':           { key: 'Mod+F',       label: 'Search',              category: 'General' },
  'toggle-timer':     { key: 'Mod+T',       label: 'Start/Stop Timer',    category: 'Timer' },
  'pause-timer':      { key: 'Mod+P',       label: 'Pause Timer',         category: 'Timer' },

  // Media
  'media-play-pause': { key: 'Mod+Shift+Space', label: 'Play/Pause Media', category: 'Media' },
  'media-next':       { key: 'Mod+Shift+Right', label: 'Next Track',      category: 'Media' },
  'media-prev':       { key: 'Mod+Shift+Left',  label: 'Previous Track',  category: 'Media' },
  'media-stop':       { key: 'Mod+Shift+S',     label: 'Stop Media',      category: 'Media' },

  // View
  'toggle-sidebar':   { key: 'Mod+B',       label: 'Toggle Sidebar',      category: 'View' },
  'zoom-in':          { key: 'Mod+=',       label: 'Zoom In',             category: 'View' },
  'zoom-out':         { key: 'Mod+-',       label: 'Zoom Out',            category: 'View' },
  'zoom-reset':       { key: 'Mod+0',       label: 'Reset Zoom',          category: 'View' },
};

// ── Convert to tinykeys Format ──────────────────────────────────────

export function toTinykeysBinding(shortcutKey) {
  if (!shortcutKey) return '';
  // tinykeys v3 uses '$mod' as the cross-platform modifier
  // Keys should be lowercase for letter keys
  const parts = shortcutKey.split('+');
  const mapped = parts.map(part => {
    const trimmed = part.trim();
    if (trimmed === 'Mod') return '$mod';
    if (trimmed === 'Shift') return 'Shift';
    if (trimmed === 'Alt') return 'Alt';
    if (trimmed === 'Ctrl') return 'Control';
    if (trimmed === 'Meta') return 'Meta';
    // Arrow keys
    if (trimmed === 'Left') return 'ArrowLeft';
    if (trimmed === 'Right') return 'ArrowRight';
    if (trimmed === 'Up') return 'ArrowUp';
    if (trimmed === 'Down') return 'ArrowDown';
    if (trimmed === 'Space') return ' ';
    if (trimmed === 'Enter') return 'Enter';
    if (trimmed === 'Escape') return 'Escape';
    if (trimmed === 'Backspace') return 'Backspace';
    if (trimmed === 'Delete') return 'Delete';
    // Single letter keys -> lowercase for tinykeys
    if (trimmed.length === 1 && /[A-Z]/.test(trimmed)) return trimmed.toLowerCase();
    // Everything else pass through (numbers, punctuation)
    return trimmed;
  });
  return mapped.join('+');
}

// ── Register All Shortcuts ──────────────────────────────────────────

export function registerShortcuts(element, handler) {
  const bindings = {};

  for (const [id, shortcut] of Object.entries(SHORTCUTS)) {
    const binding = toTinykeysBinding(shortcut.key);
    bindings[binding] = (event) => {
      event.preventDefault();
      handler(id);
    };
  }

  return tinykeys(element, bindings);
}

// ── Get Shortcuts Grouped by Category ───────────────────────────────

export function getShortcutsByCategory() {
  const groups = {};
  for (const [id, shortcut] of Object.entries(SHORTCUTS)) {
    const cat = shortcut.category;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ id, ...shortcut });
  }
  return groups;
}

// ── Category ordering for display ───────────────────────────────────

export const CATEGORY_ORDER = [
  'General',
  'Navigation',
  'Actions',
  'Timer',
  'Media',
  'View',
];
