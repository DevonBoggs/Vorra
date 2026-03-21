// University Profile System — structured school profiles that customize all AI prompts

// Profile schema — stored in data.universityProfile (replaces the old bare string)
export const EMPTY_UNIVERSITY_PROFILE = {
  name: '',                    // "Western Governors University"
  shortName: '',               // "WGU"
  country: '',                 // "US"
  type: '',                    // "private-nonprofit" | "public" | "for-profit" | ""
  modality: '',                // "online" | "campus" | "hybrid" | ""
  educationModel: '',          // "competency-based" | "credit-hour" | "quarter" | "trimester" | ""
  gradingSystem: '',           // "pass-fail" | "letter-grade" | "percentage" | ""
  assessmentModel: '',         // "oa-pa" | "midterm-final" | "continuous" | "mixed" | ""
  creditUnit: '',              // "CU" | "credit-hours" | "ECTS" | "units" | ""
  creditUnitLabel: '',         // "Competency Units" | "Credit Hours" | "ECTS Credits" | ""
  lms: '',                     // "canvas" | "blackboard" | "d2l" | "moodle" | ""
  termStructure: '',           // "6-month-term" | "semester" | "quarter" | "trimester" | "self-paced" | ""
  communityResources: [],      // ["r/WGU", "WGU Discord"]
  customContext: '',           // Free-text for anything the student wants to add
  isPreset: false,
  presetId: '',                // "wgu" | "asu-online" | "snhu" | "" for custom
};

// Dropdown options for the Settings UI
export const EDUCATION_MODELS = [
  { value: '', label: 'Not specified' },
  { value: 'competency-based', label: 'Competency-Based' },
  { value: 'credit-hour', label: 'Credit Hour (Semester)' },
  { value: 'quarter', label: 'Credit Hour (Quarter)' },
  { value: 'trimester', label: 'Trimester' },
];

export const GRADING_SYSTEMS = [
  { value: '', label: 'Not specified' },
  { value: 'pass-fail', label: 'Pass / Fail' },
  { value: 'letter-grade', label: 'Letter Grade (A-F)' },
  { value: 'percentage', label: 'Percentage' },
];

export const ASSESSMENT_MODELS = [
  { value: '', label: 'Not specified' },
  { value: 'oa-pa', label: 'OA / PA (Objective + Performance)' },
  { value: 'midterm-final', label: 'Midterm + Final Exam' },
  { value: 'continuous', label: 'Continuous Assessment' },
  { value: 'mixed', label: 'Mixed (Exams + Projects + Participation)' },
];

export const CREDIT_UNITS = [
  { value: '', label: 'Not specified' },
  { value: 'CU', label: 'Competency Units (CU)' },
  { value: 'credit-hours', label: 'Credit Hours' },
  { value: 'ECTS', label: 'ECTS Credits' },
  { value: 'units', label: 'Units' },
];

export const LMS_PLATFORMS = [
  { value: '', label: 'Not specified' },
  { value: 'canvas', label: 'Canvas' },
  { value: 'blackboard', label: 'Blackboard' },
  { value: 'd2l', label: 'D2L Brightspace' },
  { value: 'moodle', label: 'Moodle' },
  { value: 'custom', label: 'Other' },
];

export const TERM_STRUCTURES = [
  { value: '', label: 'Not specified' },
  { value: '6-month-term', label: '6-Month Term' },
  { value: 'semester', label: 'Semester (16 weeks)' },
  { value: 'quarter', label: 'Quarter (10 weeks)' },
  { value: 'trimester', label: 'Trimester' },
  { value: 'self-paced', label: 'Self-Paced' },
];

// Built-in presets for popular schools
export const UNIVERSITY_PRESETS = [
  {
    presetId: 'wgu',
    name: 'Western Governors University',
    shortName: 'WGU',
    country: 'US',
    type: 'private-nonprofit',
    modality: 'online',
    educationModel: 'competency-based',
    gradingSystem: 'pass-fail',
    assessmentModel: 'oa-pa',
    creditUnit: 'CU',
    creditUnitLabel: 'Competency Units',
    lms: 'custom',
    termStructure: '6-month-term',
    subTermWeeks: null,
    subTermsPerTerm: null,
    communityResources: ['r/WGU', 'WGU Discord', 'Course Instructors (CIs)'],
    customContext: '',
    isPreset: true,
  },
  {
    presetId: 'snhu',
    name: 'Southern New Hampshire University',
    shortName: 'SNHU',
    country: 'US',
    type: 'private-nonprofit',
    modality: 'online',
    educationModel: 'credit-hour',
    gradingSystem: 'letter-grade',
    assessmentModel: 'mixed',
    creditUnit: 'credit-hours',
    creditUnitLabel: 'Credit Hours',
    lms: 'blackboard',
    termStructure: 'semester',
    subTermWeeks: 8,
    subTermsPerTerm: 2,
    communityResources: ['r/SNHU', 'SNHU Academic Support'],
    customContext: '',
    isPreset: true,
  },
  {
    presetId: 'asu-online',
    name: 'Arizona State University Online',
    shortName: 'ASU Online',
    country: 'US',
    type: 'public',
    modality: 'online',
    educationModel: 'credit-hour',
    gradingSystem: 'letter-grade',
    assessmentModel: 'mixed',
    creditUnit: 'credit-hours',
    creditUnitLabel: 'Credit Hours',
    lms: 'canvas',
    termStructure: 'semester',
    subTermWeeks: 7.5,
    subTermsPerTerm: 2,
    communityResources: ['r/ASU', 'ASU Tutoring'],
    customContext: '',
    isPreset: true,
  },
  {
    presetId: 'purdue-global',
    name: 'Purdue University Global',
    shortName: 'Purdue Global',
    country: 'US',
    type: 'public',
    modality: 'online',
    educationModel: 'credit-hour',
    gradingSystem: 'letter-grade',
    assessmentModel: 'mixed',
    creditUnit: 'credit-hours',
    creditUnitLabel: 'Credit Hours',
    lms: 'blackboard',
    termStructure: 'semester',
    communityResources: ['r/PurdueGlobal'],
    customContext: '',
    isPreset: true,
  },
  {
    presetId: 'self-study',
    name: 'Independent Study',
    shortName: 'Self-Study',
    country: '',
    type: '',
    modality: '',
    educationModel: '',
    gradingSystem: '',
    assessmentModel: '',
    creditUnit: '',
    creditUnitLabel: '',
    lms: '',
    termStructure: 'self-paced',
    communityResources: [],
    customContext: '',
    isPreset: true,
  },
];

// Resolve a preset by ID, returning a full profile object
export function getPreset(presetId) {
  return UNIVERSITY_PRESETS.find(p => p.presetId === presetId) || null;
}

// Migrate old string universityProfile to new structured format
export function migrateUniversityProfile(old) {
  if (!old) return null;
  if (typeof old === 'object' && old.name !== undefined) return old; // already migrated
  // Old format was a plain string like "wgu" or "Western Governors University"
  const str = String(old).toLowerCase().trim();
  // Check if it matches a preset
  const preset = UNIVERSITY_PRESETS.find(p =>
    p.presetId === str ||
    p.shortName.toLowerCase() === str ||
    p.name.toLowerCase() === str
  );
  if (preset) return { ...preset };
  // Unknown school — create a minimal profile from the string
  return { ...EMPTY_UNIVERSITY_PROFILE, name: String(old).trim() };
}
