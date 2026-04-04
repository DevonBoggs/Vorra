// Storage System — dual-write: SQLite (primary in Electron) + localStorage (fallback/cache)
import { db as bridgeDb, isElectron } from './electron-bridge.js';

export const INIT = {
  tasks: {},
  profiles: [],
  activeProfileId: null,
  courses: [],
  targetDate: "",
  targetCompletionDate: "",
  studyStartDate: "",
  studyStartTime: "",
  studyHoursPerDay: 4,
  overrideSafeguards: false,
  exceptionDates: [],
  userContext: "",
  universityProfile: null, // structured profile object or null
  chatHistories: {},
  theme: "dark",
  fontScale: 100,
  uiZoom: 100,
  ytApiKey: "",
  studySessions: [],
  studyStreak: { lastStudyDate: "", currentStreak: 0, longestStreak: 0 },
  plannerConfig: null,
  planHistory: [],
  pendingPlan: null, // { planId, tasks: [], summary } — transient, cleared on confirm/discard
  lessonPlan: null, // AI-generated per-course learning path (what to study, in what order)
  scheduleOutline: null, // Legacy — replaced by taskQueue
  taskQueue: [], // Ordered study task queue from lesson plan (queue model)
  planPrompt: '', // User's additional context for plan generation
  onboardingComplete: false,
  examHistory: [],
  activeExam: null, // persisted in-progress exam state
  termHistory: [],
  dashboardWidgets: null,
  lastSeenVersion: null, // for What's New detection
  lastSession: { page: 'dashboard' }, // session restore
};

// ── Storage size monitoring ──
let _saveCount = 0;
let _lastSizeWarning = 0;
const QUOTA_WARN_MB = 7;
const QUOTA_ERROR_MB = 9;

function checkStorageSize() {
  try {
    const raw = localStorage.getItem('vorra-v1');
    if (!raw) return;
    const sizeMB = new Blob([raw]).size / (1024 * 1024);
    const now = Date.now();
    // Only warn once per 5 minutes to avoid spam
    if (now - _lastSizeWarning < 300000) return;
    if (sizeMB > QUOTA_ERROR_MB) {
      _lastSizeWarning = now;
      import('./toast.js').then(m => m.toast(
        `Storage critically full (${sizeMB.toFixed(1)}MB / 10MB). Export a backup immediately in Settings!`,
        'error'
      ));
    } else if (sizeMB > QUOTA_WARN_MB) {
      _lastSizeWarning = now;
      import('./toast.js').then(m => m.toast(
        `Storage getting full (${sizeMB.toFixed(1)}MB / 10MB). Consider exporting a backup.`,
        'warn'
      ));
    }
  } catch (e) { /* ignore size check errors */ }
}

// ── Core persistence functions ──

export const load = async (k, fb) => {
  // In Electron: try SQLite first, then localStorage, then crash-recovery backup
  if (isElectron()) {
    try {
      const sqliteData = await bridgeDb.get(k);
      if (sqliteData) {
        console.log('[storage] Loaded from SQLite');
        return sqliteData;
      }
    } catch (e) {
      console.warn('[storage] SQLite load failed, falling back to localStorage:', e.message);
    }
  }
  // localStorage fallback (browser mode, or SQLite empty/failed)
  try {
    const r = localStorage.getItem(k);
    if (!r) {
      const prev = localStorage.getItem(k + '-prev');
      if (prev) {
        console.log('[storage] Primary data missing, recovered from backup');
        localStorage.setItem(k, prev);
        return JSON.parse(prev);
      }
      return fb;
    }
    const parsed = JSON.parse(r);
    // If Electron and SQLite was empty, migrate localStorage data to SQLite
    if (isElectron()) {
      try { await bridgeDb.set(k, parsed); console.log('[storage] Migrated localStorage → SQLite'); }
      catch (e) { console.warn('[storage] SQLite migration failed:', e.message); }
    }
    return parsed;
  } catch (e) {
    console.error('[storage] Load failed:', k, e);
    try {
      const prev = localStorage.getItem(k + '-prev');
      if (prev) {
        const recovered = JSON.parse(prev);
        console.log('[storage] Recovered from backup after parse failure');
        localStorage.setItem(k, prev);
        return recovered;
      }
    } catch (e2) { /* backup also corrupt */ }
    return fb;
  }
};

let _saveTimer = null;
let _pendingSave = null;

export const save = async (k, v) => {
  _pendingSave = { k, v };
  // Debounce: batch rapid saves into one write (300ms)
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (!_pendingSave) return;
    const { k: key, v: val } = _pendingSave;
    _pendingSave = null;
    _doSave(key, val);
  }, 300);
};

// Flush any pending save immediately (call on unmount/beforeunload)
export const flushSave = () => {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  if (_pendingSave) {
    const { k, v } = _pendingSave;
    _pendingSave = null;
    _doSave(k, v);
  }
};

function _doSave(k, v) {
  // Dual-write: SQLite (primary in Electron) + localStorage (fallback/cache)
  if (isElectron()) {
    bridgeDb.set(k, v).catch(e => console.error('[storage] SQLite save failed:', e.message));
  }
  try {
    const json = JSON.stringify(v);
    // Atomic save: keep previous version as crash recovery
    const current = localStorage.getItem(k);
    if (current) {
      try { localStorage.setItem(k + '-prev', current); }
      catch (e) { /* prev save failed, continue with primary */ }
    }
    localStorage.setItem(k, json);
    _saveCount++;
    if (_saveCount % 10 === 0) checkStorageSize();
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      console.error('[storage] QUOTA EXCEEDED:', k);
      // In Electron, SQLite write already succeeded — localStorage is just a cache
      if (!isElectron()) {
        import('./toast.js').then(m => m.toast(
          'Storage full! Your changes may not be saved. Export a backup immediately in Settings.',
          'error'
        ));
      } else {
        import('./toast.js').then(m => m.toast(
          'Local cache full, but your data is safe in the database. Consider clearing old chat history.',
          'warn'
        ));
      }
    } else {
      console.error('[storage] Save failed:', k, e);
    }
  }
}

// ── Legacy migrations ──
// XenoSYNC (xs-*) → DevonSYNC (ds-*) → Vorra (vorra-*)
const MIGRATIONS = [
  ['xs-v1', 'vorra-v1'], ['xs-favs', 'vorra-favs'], ['xs-custom-streams', 'vorra-custom-streams'],
  ['ds-v1', 'vorra-v1'], ['ds-favs', 'vorra-favs'], ['ds-custom-streams', 'vorra-custom-streams'],
];
if (!localStorage.getItem('vorra-v1')) {
  for (const [oldKey, newKey] of MIGRATIONS) {
    const val = localStorage.getItem(oldKey);
    if (val && !localStorage.getItem(newKey)) {
      localStorage.setItem(newKey, val);
      console.log(`[Vorra] Migrated ${oldKey} → ${newKey}`);
    }
  }
  for (const prefix of ['xs-', 'ds-']) {
    for (const suffix of ['v1', 'favs', 'custom-streams']) {
      localStorage.removeItem(`${prefix}${suffix}`);
    }
  }
  if (localStorage.getItem('vorra-v1')) console.log('[Vorra] Legacy data migration complete');
}

// Migrate universityProfile from string to structured object
try {
  const raw = localStorage.getItem('vorra-v1');
  if (raw) {
    const parsed = JSON.parse(raw);
    if (typeof parsed.universityProfile === 'string' && parsed.universityProfile) {
      const oldVal = parsed.universityProfile.trim();
      const presetMap = { wgu: 'Western Governors University', snhu: 'Southern New Hampshire University', asu: 'Arizona State University Online' };
      parsed.universityProfile = { name: presetMap[oldVal.toLowerCase()] || oldVal };
      localStorage.setItem('vorra-v1', JSON.stringify(parsed));
      console.log('[Vorra] Migrated universityProfile to structured format');
    }
  }
} catch (e) { /* migration skipped */ }
