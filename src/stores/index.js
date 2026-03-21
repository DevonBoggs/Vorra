// Vorra Store — Zustand state management with slice pattern
//
// Combines all slices into a single store with localStorage persistence.
// Provides backward-compatible `getData()` and `setData()` for gradual
// migration from the legacy `data`/`setData` prop-drilling pattern.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createCourseSlice } from './courseSlice.js';
import { createTaskSlice } from './taskSlice.js';
import { createSettingsSlice } from './settingsSlice.js';
import { createMediaSlice } from './mediaSlice.js';
import { INIT } from '../systems/storage.js';
import { useShallow } from 'zustand/shallow';

// ── Keys that belong to the persisted "data" shape ──────────────────
// These match the INIT object from storage.js — the legacy `data` blob
// that components currently receive as a prop.
const DATA_KEYS = Object.keys(INIT);

// ── Main Store ──────────────────────────────────────────────────────
export const useStore = create(
  persist(
    (set, get) => ({
      // Spread all slices
      ...createCourseSlice(set, get),
      ...createTaskSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createMediaSlice(set, get),

      // ── Backward Compatibility ──────────────────────────────────
      // getData() returns the legacy `data` shape so existing
      // components can do `const data = useStore(s => s.getData())`
      // or receive it from a parent that reads the store.
      getData: () => {
        const state = get();
        const data = {};
        for (const key of DATA_KEYS) {
          data[key] = state[key];
        }
        return data;
      },

      // setData(fn) mimics the legacy React setState pattern:
      //   setData(prev => ({ ...prev, courses: [...] }))
      //   setData({ theme: 'light' })
      setData: (fnOrObj) => {
        const state = get();
        const prevData = {};
        for (const key of DATA_KEYS) {
          prevData[key] = state[key];
        }

        const nextData = typeof fnOrObj === 'function'
          ? fnOrObj(prevData)
          : fnOrObj;

        // Only update keys that actually changed
        const updates = {};
        for (const key of DATA_KEYS) {
          if (nextData[key] !== undefined && nextData[key] !== state[key]) {
            updates[key] = nextData[key];
          }
        }

        if (Object.keys(updates).length > 0) {
          set(updates);
        }
      },
    }),
    {
      name: 'vorra-v1',
      // Only persist data keys — skip media (ephemeral) and actions
      partialize: (state) => {
        const persisted = {};
        for (const key of DATA_KEYS) {
          if (state[key] !== undefined) {
            persisted[key] = state[key];
          }
        }
        return persisted;
      },
      // Merge persisted state with defaults to handle new keys added
      // in future versions (keys in INIT but missing from storage).
      merge: (persisted, current) => {
        const merged = { ...current };
        if (persisted && typeof persisted === 'object') {
          for (const key of DATA_KEYS) {
            if (persisted[key] !== undefined) {
              merged[key] = persisted[key];
            }
          }
        }
        return merged;
      },
    }
  )
);

// ── Selector Hooks ──────────────────────────────────────────────────
// Fine-grained hooks for specific slices. Use these in new components
// to avoid unnecessary re-renders.

export const useCourses = () => useStore(
  useShallow((s) => ({
    courses: s.courses,
    chatHistories: s.chatHistories,
    addCourse: s.addCourse,
    updateCourse: s.updateCourse,
    deleteCourse: s.deleteCourse,
    setCourses: s.setCourses,
    reorderCourses: s.reorderCourses,
    setChatHistory: s.setChatHistory,
    appendChatMessage: s.appendChatMessage,
    clearChatHistory: s.clearChatHistory,
    clearAllChatHistories: s.clearAllChatHistories,
  }))
);

export const useTasks = () => useStore(
  useShallow((s) => ({
    tasks: s.tasks,
    studySessions: s.studySessions,
    studyStreak: s.studyStreak,
    setTasks: s.setTasks,
    setDayTasks: s.setDayTasks,
    addTask: s.addTask,
    updateTask: s.updateTask,
    deleteTask: s.deleteTask,
    toggleTaskDone: s.toggleTaskDone,
    getDayTasks: s.getDayTasks,
    setStudySessions: s.setStudySessions,
    addStudySession: s.addStudySession,
    setStudyStreak: s.setStudyStreak,
    updateStudyStreak: s.updateStudyStreak,
  }))
);

export const useSettings = () => useStore(
  useShallow((s) => ({
    profiles: s.profiles,
    activeProfileId: s.activeProfileId,
    targetDate: s.targetDate,
    targetCompletionDate: s.targetCompletionDate,
    studyStartDate: s.studyStartDate,
    studyStartTime: s.studyStartTime,
    studyHoursPerDay: s.studyHoursPerDay,
    overrideSafeguards: s.overrideSafeguards,
    exceptionDates: s.exceptionDates,
    userContext: s.userContext,
    universityProfile: s.universityProfile,
    theme: s.theme,
    fontScale: s.fontScale,
    uiZoom: s.uiZoom,
    ytApiKey: s.ytApiKey,
    setProfiles: s.setProfiles,
    addProfile: s.addProfile,
    updateProfile: s.updateProfile,
    deleteProfile: s.deleteProfile,
    setActiveProfileId: s.setActiveProfileId,
    getActiveProfile: s.getActiveProfile,
    setTargetDate: s.setTargetDate,
    setTargetCompletionDate: s.setTargetCompletionDate,
    setStudyStartDate: s.setStudyStartDate,
    setStudyStartTime: s.setStudyStartTime,
    setStudyHoursPerDay: s.setStudyHoursPerDay,
    setOverrideSafeguards: s.setOverrideSafeguards,
    setExceptionDates: s.setExceptionDates,
    setUserContext: s.setUserContext,
    setUniversityProfile: s.setUniversityProfile,
    setTheme: s.setTheme,
    setFontScale: s.setFontScale,
    setUiZoom: s.setUiZoom,
    setYtApiKey: s.setYtApiKey,
  }))
);

export const useMedia = () => useStore(
  useShallow((s) => ({
    somaPlaying: s.somaPlaying,
    somaPaused: s.somaPaused,
    somaVolume: s.somaVolume,
    somaStation: s.somaStation,
    ytStreams: s.ytStreams,
    ytVolumes: s.ytVolumes,
    setSomaPlaying: s.setSomaPlaying,
    setSomaStation: s.setSomaStation,
    toggleSomaPause: s.toggleSomaPause,
    setSomaPaused: s.setSomaPaused,
    setSomaVolume: s.setSomaVolume,
    stopSoma: s.stopSoma,
    setYtStreams: s.setYtStreams,
    addYtStream: s.addYtStream,
    removeYtStream: s.removeYtStream,
    clearYtStreams: s.clearYtStreams,
    toggleYtPause: s.toggleYtPause,
    toggleYtPauseAll: s.toggleYtPauseAll,
    setYtVolume: s.setYtVolume,
    setYtVolumeAll: s.setYtVolumeAll,
  }))
);
