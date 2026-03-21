// Task Slice — daily tasks, study sessions, and streak tracking

export const createTaskSlice = (set, get) => ({
  // ── State ──────────────────────────────────────────────────────────
  tasks: {},  // { "2026-03-21": [{ id, time, endTime, title, category, priority, notes, done }] }
  studySessions: [],
  studyStreak: { lastStudyDate: '', currentStreak: 0, longestStreak: 0 },

  // ── Task Actions ──────────────────────────────────────────────────
  setTasks: (tasks) => set({ tasks }),

  setDayTasks: (date, dayTasks) => set((state) => ({
    tasks: { ...state.tasks, [date]: dayTasks },
  })),

  addTask: (date, task) => set((state) => ({
    tasks: {
      ...state.tasks,
      [date]: [...(state.tasks[date] || []), task],
    },
  })),

  updateTask: (date, taskId, updates) => set((state) => ({
    tasks: {
      ...state.tasks,
      [date]: (state.tasks[date] || []).map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    },
  })),

  deleteTask: (date, taskId) => set((state) => ({
    tasks: {
      ...state.tasks,
      [date]: (state.tasks[date] || []).filter((t) => t.id !== taskId),
    },
  })),

  toggleTaskDone: (date, taskId) => set((state) => ({
    tasks: {
      ...state.tasks,
      [date]: (state.tasks[date] || []).map((t) =>
        t.id === taskId ? { ...t, done: !t.done } : t
      ),
    },
  })),

  getDayTasks: (date) => get().tasks[date] || [],

  // ── Study Sessions ────────────────────────────────────────────────
  setStudySessions: (sessions) => set({ studySessions: sessions }),

  addStudySession: (session) => set((state) => ({
    studySessions: [...state.studySessions, session],
  })),

  // ── Study Streak ──────────────────────────────────────────────────
  setStudyStreak: (streak) => set({ studyStreak: streak }),

  updateStudyStreak: (updates) => set((state) => ({
    studyStreak: { ...state.studyStreak, ...updates },
  })),
});
