// Settings Slice — user preferences, AI profiles, and study planning config

export const createSettingsSlice = (set, get) => ({
  // ── AI Profiles ───────────────────────────────────────────────────
  profiles: [],
  activeProfileId: null,

  // ── Study Planning ────────────────────────────────────────────────
  targetDate: '',
  targetCompletionDate: '',
  studyStartDate: '',
  studyStartTime: '',
  studyHoursPerDay: 4,
  overrideSafeguards: false,
  exceptionDates: [],
  userContext: '',
  universityProfile: null,

  // ── UI Preferences ────────────────────────────────────────────────
  theme: 'dark',
  fontScale: 100,
  uiZoom: 100,

  // ── Integrations ──────────────────────────────────────────────────
  ytApiKey: '',

  // ── Profile Actions ───────────────────────────────────────────────
  setProfiles: (profiles) => set({ profiles }),

  addProfile: (profile) => set((state) => ({
    profiles: [...state.profiles, profile],
  })),

  updateProfile: (id, updates) => set((state) => ({
    profiles: state.profiles.map((p) =>
      p.id === id ? { ...p, ...updates } : p
    ),
  })),

  deleteProfile: (id) => set((state) => ({
    profiles: state.profiles.filter((p) => p.id !== id),
    activeProfileId: state.activeProfileId === id ? null : state.activeProfileId,
  })),

  setActiveProfileId: (id) => set({ activeProfileId: id }),

  getActiveProfile: () => {
    const { profiles, activeProfileId } = get();
    return profiles.find((p) => p.id === activeProfileId) || null;
  },

  // ── Study Planning Actions ────────────────────────────────────────
  setTargetDate: (targetDate) => set({ targetDate }),
  setTargetCompletionDate: (targetCompletionDate) => set({ targetCompletionDate }),
  setStudyStartDate: (studyStartDate) => set({ studyStartDate }),
  setStudyStartTime: (studyStartTime) => set({ studyStartTime }),
  setStudyHoursPerDay: (studyHoursPerDay) => set({ studyHoursPerDay }),
  setOverrideSafeguards: (overrideSafeguards) => set({ overrideSafeguards }),
  setExceptionDates: (exceptionDates) => set({ exceptionDates }),
  setUserContext: (userContext) => set({ userContext }),
  setUniversityProfile: (universityProfile) => set({ universityProfile }),

  // ── UI Preference Actions ─────────────────────────────────────────
  setTheme: (theme) => set({ theme }),
  setFontScale: (fontScale) => set({ fontScale }),
  setUiZoom: (uiZoom) => set({ uiZoom }),

  // ── Integration Actions ───────────────────────────────────────────
  setYtApiKey: (ytApiKey) => set({ ytApiKey }),
});
