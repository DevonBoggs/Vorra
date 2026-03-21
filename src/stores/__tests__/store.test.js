import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../index.js';
import { INIT } from '../../systems/storage.js';

// Reset the store data keys to defaults before each test.
// We must NOT use the replace flag (true) because that would blow away
// the action functions created by the slices. Instead we merge INIT
// values back into the existing state.
beforeEach(() => {
  useStore.setState({
    ...INIT,
    // Ensure slice defaults that may diverge from INIT are also reset
    courses: [],
    chatHistories: {},
    tasks: {},
    studySessions: [],
    studyStreak: { lastStudyDate: '', currentStreak: 0, longestStreak: 0 },
    profiles: [],
    activeProfileId: null,
    theme: 'dark',
    fontScale: 100,
    uiZoom: 100,
    targetDate: '',
    targetCompletionDate: '',
    studyStartDate: '',
    studyStartTime: '',
    studyHoursPerDay: 4,
    overrideSafeguards: false,
    exceptionDates: [],
    userContext: '',
    universityProfile: '',
    ytApiKey: '',
  });
});

// ── Store initialization ────────────────────────────────────────────────

describe('store initialization', () => {
  it('initializes with INIT values', () => {
    const state = useStore.getState();
    expect(state.courses).toEqual(INIT.courses);
    expect(state.tasks).toEqual(INIT.tasks);
    expect(state.profiles).toEqual(INIT.profiles);
    expect(state.activeProfileId).toBe(INIT.activeProfileId);
    expect(state.theme).toBe(INIT.theme);
    expect(state.fontScale).toBe(INIT.fontScale);
    expect(state.uiZoom).toBe(INIT.uiZoom);
    expect(state.studyHoursPerDay).toBe(INIT.studyHoursPerDay);
    expect(state.chatHistories).toEqual(INIT.chatHistories);
    expect(state.studySessions).toEqual(INIT.studySessions);
    expect(state.studyStreak).toEqual(INIT.studyStreak);
  });
});

// ── Course actions ──────────────────────────────────────────────────────

describe('addCourse', () => {
  it('adds a course to the store', () => {
    const course = { id: 'c1', name: 'Intro to CS', credits: 3 };
    useStore.getState().addCourse(course);

    const state = useStore.getState();
    expect(state.courses).toHaveLength(1);
    expect(state.courses[0]).toEqual(course);
  });

  it('appends to existing courses', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'Course 1' });
    useStore.getState().addCourse({ id: 'c2', name: 'Course 2' });

    const state = useStore.getState();
    expect(state.courses).toHaveLength(2);
    expect(state.courses[0].id).toBe('c1');
    expect(state.courses[1].id).toBe('c2');
  });
});

describe('updateCourse', () => {
  it('updates course fields by id', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'Old Name', credits: 3 });
    useStore.getState().updateCourse('c1', { name: 'New Name', credits: 4 });

    const state = useStore.getState();
    expect(state.courses[0].name).toBe('New Name');
    expect(state.courses[0].credits).toBe(4);
    expect(state.courses[0].id).toBe('c1');
  });

  it('does not affect other courses', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'A' });
    useStore.getState().addCourse({ id: 'c2', name: 'B' });
    useStore.getState().updateCourse('c1', { name: 'Updated A' });

    const state = useStore.getState();
    expect(state.courses[0].name).toBe('Updated A');
    expect(state.courses[1].name).toBe('B');
  });
});

describe('deleteCourse', () => {
  it('removes a course by id', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'A' });
    useStore.getState().addCourse({ id: 'c2', name: 'B' });
    useStore.getState().deleteCourse('c1');

    const state = useStore.getState();
    expect(state.courses).toHaveLength(1);
    expect(state.courses[0].id).toBe('c2');
  });

  it('also removes associated chat history', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'A' });
    useStore.getState().setChatHistory('c1', [{ role: 'user', content: 'hi' }]);
    expect(useStore.getState().chatHistories['c1']).toBeDefined();

    useStore.getState().deleteCourse('c1');
    expect(useStore.getState().chatHistories['c1']).toBeUndefined();
  });
});

// ── Task actions ────────────────────────────────────────────────────────

describe('addTask', () => {
  it('adds a task to the correct date', () => {
    const task = { id: 't1', title: 'Study math', done: false };
    useStore.getState().addTask('2026-03-21', task);

    const state = useStore.getState();
    expect(state.tasks['2026-03-21']).toHaveLength(1);
    expect(state.tasks['2026-03-21'][0]).toEqual(task);
  });

  it('appends to existing tasks for a date', () => {
    useStore.getState().addTask('2026-03-21', { id: 't1', title: 'A', done: false });
    useStore.getState().addTask('2026-03-21', { id: 't2', title: 'B', done: false });

    const state = useStore.getState();
    expect(state.tasks['2026-03-21']).toHaveLength(2);
  });

  it('keeps tasks for different dates separate', () => {
    useStore.getState().addTask('2026-03-21', { id: 't1', title: 'A', done: false });
    useStore.getState().addTask('2026-03-22', { id: 't2', title: 'B', done: false });

    const state = useStore.getState();
    expect(state.tasks['2026-03-21']).toHaveLength(1);
    expect(state.tasks['2026-03-22']).toHaveLength(1);
  });
});

describe('toggleTaskDone', () => {
  it('toggles task completion', () => {
    useStore.getState().addTask('2026-03-21', { id: 't1', title: 'A', done: false });

    useStore.getState().toggleTaskDone('2026-03-21', 't1');
    expect(useStore.getState().tasks['2026-03-21'][0].done).toBe(true);

    useStore.getState().toggleTaskDone('2026-03-21', 't1');
    expect(useStore.getState().tasks['2026-03-21'][0].done).toBe(false);
  });

  it('only toggles the specified task', () => {
    useStore.getState().addTask('2026-03-21', { id: 't1', title: 'A', done: false });
    useStore.getState().addTask('2026-03-21', { id: 't2', title: 'B', done: false });

    useStore.getState().toggleTaskDone('2026-03-21', 't1');
    const tasks = useStore.getState().tasks['2026-03-21'];
    expect(tasks[0].done).toBe(true);
    expect(tasks[1].done).toBe(false);
  });
});

// ── Settings actions ────────────────────────────────────────────────────

describe('setTheme', () => {
  it('updates the theme', () => {
    useStore.getState().setTheme('ocean');
    expect(useStore.getState().theme).toBe('ocean');

    useStore.getState().setTheme('warm');
    expect(useStore.getState().theme).toBe('warm');
  });
});

// ── getData / setData (backward compatibility) ──────────────────────────

describe('getData', () => {
  it('returns an object shaped like INIT', () => {
    const data = useStore.getState().getData();
    for (const key of Object.keys(INIT)) {
      expect(data).toHaveProperty(key);
    }
  });

  it('reflects current store state', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'Test' });
    useStore.getState().setTheme('light');

    const data = useStore.getState().getData();
    expect(data.courses).toHaveLength(1);
    expect(data.courses[0].id).toBe('c1');
    expect(data.theme).toBe('light');
  });
});

describe('setData', () => {
  it('works with function updater', () => {
    useStore.getState().setData((prev) => ({
      ...prev,
      theme: 'mono',
      studyHoursPerDay: 6,
    }));

    const state = useStore.getState();
    expect(state.theme).toBe('mono');
    expect(state.studyHoursPerDay).toBe(6);
  });

  it('works with object updater', () => {
    useStore.getState().setData({ theme: 'warm' });
    expect(useStore.getState().theme).toBe('warm');
  });

  it('only updates changed keys', () => {
    useStore.getState().addCourse({ id: 'c1', name: 'Keep Me' });
    useStore.getState().setData({ theme: 'ocean' });

    const state = useStore.getState();
    expect(state.theme).toBe('ocean');
    expect(state.courses).toHaveLength(1);
    expect(state.courses[0].name).toBe('Keep Me');
  });
});

// ── getActiveProfile ────────────────────────────────────────────────────

describe('getActiveProfile', () => {
  it('returns null when no profiles exist', () => {
    expect(useStore.getState().getActiveProfile()).toBeNull();
  });

  it('returns null when activeProfileId does not match any profile', () => {
    useStore.getState().addProfile({ id: 'p1', name: 'Profile 1' });
    useStore.getState().setActiveProfileId('nonexistent');
    expect(useStore.getState().getActiveProfile()).toBeNull();
  });

  it('returns the correct active profile', () => {
    useStore.getState().addProfile({ id: 'p1', name: 'Profile 1', provider: 'anthropic' });
    useStore.getState().addProfile({ id: 'p2', name: 'Profile 2', provider: 'openai' });
    useStore.getState().setActiveProfileId('p2');

    const active = useStore.getState().getActiveProfile();
    expect(active).not.toBeNull();
    expect(active.id).toBe('p2');
    expect(active.name).toBe('Profile 2');
    expect(active.provider).toBe('openai');
  });

  it('returns null after active profile is deleted', () => {
    useStore.getState().addProfile({ id: 'p1', name: 'Profile 1' });
    useStore.getState().setActiveProfileId('p1');
    expect(useStore.getState().getActiveProfile()).not.toBeNull();

    useStore.getState().deleteProfile('p1');
    expect(useStore.getState().getActiveProfile()).toBeNull();
    expect(useStore.getState().activeProfileId).toBeNull();
  });
});
