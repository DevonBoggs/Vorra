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

// Migrate old XenoSYNC localStorage keys to DevonSYNC on first load
if (!localStorage.getItem('ds-v1') && localStorage.getItem('xs-v1')) {
  localStorage.setItem('ds-v1', localStorage.getItem('xs-v1'));
  if (localStorage.getItem('xs-favs')) localStorage.setItem('ds-favs', localStorage.getItem('xs-favs'));
  if (localStorage.getItem('xs-custom-streams')) localStorage.setItem('ds-custom-streams', localStorage.getItem('xs-custom-streams'));
  console.log('[DevonSYNC] Migrated data from XenoSYNC');
}
