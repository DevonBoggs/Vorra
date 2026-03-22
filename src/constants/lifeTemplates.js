// Life template presets for study planner
// Pre-fill weeklyAvailability + commitments in one click
// Hours are realistic — accounting for commute, meals, sleep, and sustainability

export const LIFE_TEMPLATES = {
  'nine-to-five': {
    label: '9-to-5 Worker',
    icon: '\uD83D\uDCBC',
    description: 'Evenings & weekends',
    weeklyAvailability: {
      0: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
      1: { available: true,  windows: [{ start: '19:30', end: '22:00' }] },
      2: { available: true,  windows: [{ start: '19:30', end: '22:00' }] },
      3: { available: true,  windows: [{ start: '19:30', end: '22:00' }] },
      4: { available: true,  windows: [{ start: '19:30', end: '22:00' }] },
      5: { available: true,  windows: [{ start: '19:30', end: '22:00' }] },
      6: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] },
    },
    commitments: [
      { id: 'work', label: 'Day job', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', category: 'work' },
      { id: 'commute', label: 'Commute', days: [1, 2, 3, 4, 5], start: '17:00', end: '17:45', category: 'commute' },
      { id: 'dinner', label: 'Dinner & wind down', days: [1, 2, 3, 4, 5], start: '17:45', end: '19:30', category: 'family' },
    ],
  },
  'night-shift': {
    label: 'Night Shift',
    icon: '\uD83C\uDF19',
    description: 'Afternoons free, work nights',
    weeklyAvailability: {
      0: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
      1: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
      2: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
      3: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
      4: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
      5: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
      6: { available: true,  windows: [{ start: '15:00', end: '18:00' }, { start: '19:00', end: '21:00' }] },
    },
    commitments: [
      { id: 'work', label: 'Night shift', days: [1, 2, 3, 4, 5], start: '22:00', end: '06:00', category: 'work' },
      { id: 'sleep', label: 'Sleep', days: [1, 2, 3, 4, 5], start: '06:00', end: '14:00', category: 'other' },
    ],
  },
  'parent': {
    label: 'Parent',
    icon: '\uD83D\uDC68\u200D\uD83D\uDC67',
    description: 'School hours + after bedtime',
    weeklyAvailability: {
      0: { available: true,  windows: [{ start: '12:00', end: '14:00' }, { start: '20:30', end: '23:00' }] },
      1: { available: true,  windows: [{ start: '09:00', end: '14:30' }, { start: '20:30', end: '23:00' }] },
      2: { available: true,  windows: [{ start: '09:00', end: '14:30' }, { start: '20:30', end: '23:00' }] },
      3: { available: true,  windows: [{ start: '09:00', end: '14:30' }, { start: '20:30', end: '23:00' }] },
      4: { available: true,  windows: [{ start: '09:00', end: '14:30' }, { start: '20:30', end: '23:00' }] },
      5: { available: true,  windows: [{ start: '09:00', end: '14:30' }, { start: '20:30', end: '23:00' }] },
      6: { available: true,  windows: [{ start: '12:00', end: '14:00' }, { start: '20:30', end: '23:00' }] },
    },
    commitments: [
      { id: 'morning', label: 'Morning routine', days: [1, 2, 3, 4, 5], start: '06:30', end: '09:00', category: 'family' },
      { id: 'kids-wd', label: 'Kids (weekday)', days: [1, 2, 3, 4, 5], start: '14:30', end: '20:30', category: 'family' },
      { id: 'kids-we', label: 'Kids (weekend)', days: [0, 6], start: '07:00', end: '12:00', category: 'family' },
      { id: 'kids-we-pm', label: 'Kids afternoon', days: [0, 6], start: '14:00', end: '18:00', category: 'family' },
    ],
  },
  'full-time-student': {
    label: 'Full-Time Student',
    icon: '\uD83C\uDF93',
    description: 'Classes + self-study afternoons',
    weeklyAvailability: {
      0: { available: false, windows: [] },
      1: { available: true,  windows: [{ start: '14:30', end: '17:30' }, { start: '19:00', end: '21:30' }] },
      2: { available: true,  windows: [{ start: '14:30', end: '17:30' }, { start: '19:00', end: '21:30' }] },
      3: { available: true,  windows: [{ start: '14:30', end: '17:30' }, { start: '19:00', end: '21:30' }] },
      4: { available: true,  windows: [{ start: '14:30', end: '17:30' }, { start: '19:00', end: '21:30' }] },
      5: { available: true,  windows: [{ start: '14:30', end: '17:30' }, { start: '19:00', end: '21:30' }] },
      6: { available: true,  windows: [{ start: '10:00', end: '15:00' }] },
    },
    commitments: [
      { id: 'classes', label: 'Classes & labs', days: [1, 2, 3, 4, 5], start: '09:00', end: '14:00', category: 'work' },
    ],
  },
  'part-time': {
    label: 'Part-Time Worker',
    icon: '\u23F0',
    description: 'Afternoons + evenings',
    weeklyAvailability: {
      0: { available: false, windows: [] },
      1: { available: true,  windows: [{ start: '14:00', end: '17:00' }, { start: '19:00', end: '22:00' }] },
      2: { available: true,  windows: [{ start: '14:00', end: '17:00' }, { start: '19:00', end: '22:00' }] },
      3: { available: true,  windows: [{ start: '14:00', end: '17:00' }, { start: '19:00', end: '22:00' }] },
      4: { available: true,  windows: [{ start: '14:00', end: '17:00' }, { start: '19:00', end: '22:00' }] },
      5: { available: false, windows: [] },
      6: { available: true,  windows: [{ start: '10:00', end: '16:00' }] },
    },
    commitments: [
      { id: 'work', label: 'Part-time job', days: [1, 2, 3, 4], start: '08:00', end: '12:00', category: 'work' },
    ],
  },
  'freelancer': {
    label: 'Freelancer',
    icon: '\uD83C\uDFE0',
    description: 'Mornings + evenings, work midday',
    weeklyAvailability: {
      0: { available: false, windows: [] },
      1: { available: true,  windows: [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '21:00' }] },
      2: { available: true,  windows: [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '21:00' }] },
      3: { available: true,  windows: [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '21:00' }] },
      4: { available: true,  windows: [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '21:00' }] },
      5: { available: true,  windows: [{ start: '07:00', end: '09:00' }, { start: '18:00', end: '21:00' }] },
      6: { available: true,  windows: [{ start: '10:00', end: '16:00' }] },
    },
    commitments: [
      { id: 'work', label: 'Client work', days: [1, 2, 3, 4, 5], start: '09:30', end: '17:30', category: 'work' },
    ],
  },
  'healthcare': {
    label: 'Healthcare (12h)',
    icon: '\u2695\uFE0F',
    description: '3\u00D712h shifts, 4 days off',
    weeklyAvailability: {
      0: { available: false, windows: [] },
      1: { available: false, windows: [] },
      2: { available: false, windows: [] },
      3: { available: false, windows: [] },
      4: { available: true,  windows: [{ start: '13:00', end: '17:00' }] },
      5: { available: true,  windows: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '18:00' }] },
      6: { available: true,  windows: [{ start: '10:00', end: '15:00' }] },
    },
    commitments: [
      { id: 'shift', label: '12h shift', days: [1, 2, 3], start: '07:00', end: '19:00', category: 'work' },
    ],
  },
  'remote-worker': {
    label: 'Remote Worker',
    icon: '\uD83D\uDCBB',
    description: 'Lunch break + evenings',
    weeklyAvailability: {
      0: { available: true,  windows: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '18:00' }] },
      1: { available: true,  windows: [{ start: '12:00', end: '13:00' }, { start: '18:00', end: '21:00' }] },
      2: { available: true,  windows: [{ start: '12:00', end: '13:00' }, { start: '18:00', end: '21:00' }] },
      3: { available: true,  windows: [{ start: '12:00', end: '13:00' }, { start: '18:00', end: '21:00' }] },
      4: { available: true,  windows: [{ start: '12:00', end: '13:00' }, { start: '18:00', end: '21:00' }] },
      5: { available: true,  windows: [{ start: '12:00', end: '13:00' }, { start: '18:00', end: '21:00' }] },
      6: { available: true,  windows: [{ start: '09:00', end: '13:00' }, { start: '15:00', end: '18:00' }] },
    },
    commitments: [
      { id: 'work', label: 'Remote work', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', category: 'work' },
    ],
  },
  'retiree': {
    label: 'Career Changer',
    icon: '\uD83C\uDF1F',
    description: 'Structured days, relaxed pace',
    weeklyAvailability: {
      0: { available: false, windows: [] },
      1: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '16:00' }] },
      2: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '16:00' }] },
      3: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '16:00' }] },
      4: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '16:00' }] },
      5: { available: true,  windows: [{ start: '09:00', end: '12:00' }, { start: '13:30', end: '16:00' }] },
      6: { available: true,  windows: [{ start: '09:00', end: '13:00' }] },
    },
    commitments: [],
  },
  'retail': {
    label: 'Retail / Service',
    icon: '\uD83D\uDED2',
    description: 'Tue & Wed off, mornings on work days',
    weeklyAvailability: {
      0: { available: true,  windows: [{ start: '08:00', end: '12:00' }] },
      1: { available: true,  windows: [{ start: '08:00', end: '12:00' }] },
      2: { available: true,  windows: [{ start: '09:00', end: '13:00' }, { start: '14:30', end: '18:00' }] },
      3: { available: true,  windows: [{ start: '09:00', end: '13:00' }, { start: '14:30', end: '18:00' }] },
      4: { available: true,  windows: [{ start: '08:00', end: '12:00' }] },
      5: { available: true,  windows: [{ start: '08:00', end: '12:00' }] },
      6: { available: true,  windows: [{ start: '08:00', end: '12:00' }] },
    },
    commitments: [
      { id: 'shift', label: 'Shift work', days: [1, 4, 5], start: '14:00', end: '22:00', category: 'work' },
      { id: 'weekend-shift', label: 'Weekend shift', days: [0, 6], start: '13:00', end: '21:00', category: 'work' },
    ],
  },
  'blank-slate': {
    label: 'Blank Slate',
    icon: '\u270F\uFE0F',
    description: 'Start from scratch',
    weeklyAvailability: {
      0: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
      1: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
      2: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
      3: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
      4: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
      5: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
      6: { available: true, windows: [{ start: '09:00', end: '17:00' }] },
    },
    commitments: [],
  },
};

export const LIFE_TEMPLATE_IDS = Object.keys(LIFE_TEMPLATES);
