// Course Slice — courses, chat histories, and degree planning state

export const createCourseSlice = (set, get) => ({
  // ── State ──────────────────────────────────────────────────────────
  courses: [],
  chatHistories: {},

  // ── Actions ────────────────────────────────────────────────────────
  addCourse: (course) => set((state) => ({
    courses: [...state.courses, course],
  })),

  updateCourse: (id, updates) => set((state) => ({
    courses: state.courses.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    ),
  })),

  deleteCourse: (id) => set((state) => ({
    courses: state.courses.filter((c) => c.id !== id),
    chatHistories: (() => {
      const { [id]: _removed, ...rest } = state.chatHistories;
      return rest;
    })(),
  })),

  setCourses: (courses) => set({ courses }),

  reorderCourses: (fromIndex, toIndex) => set((state) => {
    const arr = [...state.courses];
    const [moved] = arr.splice(fromIndex, 1);
    arr.splice(toIndex, 0, moved);
    return { courses: arr };
  }),

  // ── Chat Histories ────────────────────────────────────────────────
  setChatHistory: (courseId, messages) => set((state) => ({
    chatHistories: { ...state.chatHistories, [courseId]: messages },
  })),

  appendChatMessage: (courseId, message) => set((state) => ({
    chatHistories: {
      ...state.chatHistories,
      [courseId]: [...(state.chatHistories[courseId] || []), message],
    },
  })),

  clearChatHistory: (courseId) => set((state) => {
    const { [courseId]: _removed, ...rest } = state.chatHistories;
    return { chatHistories: rest };
  }),

  clearAllChatHistories: () => set({ chatHistories: {} }),
});
