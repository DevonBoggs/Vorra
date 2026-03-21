// Storage System — localStorage persistence

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
  universityProfile: "", // e.g. "wgu", "snhu", "purdue-global", or custom
  chatHistories: {},
  theme: "dark",
  fontScale: 100,
  uiZoom: 100,
  ytApiKey: "",
  studySessions: [],
  studyStreak: { lastStudyDate: "", currentStreak: 0, longestStreak: 0 },
};

export const load = async (k, fb) => {
  try {
    const r = localStorage.getItem(k);
    return r ? JSON.parse(r) : fb;
  } catch (e) {
    console.error("[LP:storage] Load failed:", k, e);
    return fb;
  }
};

export const save = async (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {
    console.error("[LP:storage] Save failed:", k, e);
  }
};

// Migrate legacy localStorage keys to Vorra
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
  // Clean up legacy keys
  for (const prefix of ['xs-', 'ds-']) {
    for (const suffix of ['v1', 'favs', 'custom-streams']) {
      localStorage.removeItem(`${prefix}${suffix}`);
    }
  }
  if (localStorage.getItem('vorra-v1')) console.log('[Vorra] Legacy data migration complete');
}
