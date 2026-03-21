// Shared course helper functions
import { safeArr } from './toolExecution.js';

// Section definitions (shared between CourseDetail + MyCoursesPage)
export const SECTIONS = [
  { id: 'assessment', label: 'Assessment', icon: '\uD83D\uDCCB' },
  { id: 'strategy', label: 'Strategy', icon: '\uD83C\uDFAF' },
  { id: 'competencies', label: 'Competencies', icon: '\uD83C\uDFC6' },
  { id: 'topics', label: 'Topics', icon: '\uD83D\uDCDA' },
  { id: 'terms', label: 'Terms', icon: '\uD83D\uDCD6' },
  { id: 'resources', label: 'Resources', icon: '\uD83D\uDD17' },
  { id: 'examTips', label: 'Exam Tips', icon: '\uD83D\uDCA1' },
  { id: 'mistakes', label: 'Mistakes', icon: '\u26A0\uFE0F' },
  { id: 'focus', label: 'Focus Areas', icon: '\uD83C\uDFAF' },
  { id: 'mnemonics', label: 'Mnemonics', icon: '\uD83E\uDDE0' },
  { id: 'milestones', label: 'Milestones', icon: '\uD83D\uDCC5' },
  { id: 'instructorTips', label: 'Instructor', icon: '\uD83D\uDC68\u200D\uD83C\uDFEB' },
  { id: 'community', label: 'Community', icon: '\uD83D\uDCAC' },
  { id: 'meta', label: 'Metadata', icon: '\u2139\uFE0F' },
];

// Section-to-field mapping for enrichment prompts
export const SECTION_FIELDS = {
  assessment: ['assessmentType', 'oaDetails', 'paDetails'],
  strategy: ['studyStrategy', 'studyOrder', 'timeAllocation', 'quickWins', 'hardestConcepts', 'practiceTestNotes'],
  competencies: ['competencies'],
  topics: ['topicBreakdown'],
  terms: ['keyTermsAndConcepts'],
  resources: ['officialResources', 'recommendedExternal'],
  examTips: ['examTips'],
  mistakes: ['commonMistakes'],
  focus: ['knownFocusAreas'],
  mnemonics: ['mnemonics'],
  milestones: ['weeklyMilestones'],
  instructorTips: ['instructorTips'],
  community: ['communityInsights'],
  meta: ['passRate', 'averageStudyHours', 'reportedDifficulty', 'certAligned', 'prerequisites', 'relatedCourses', 'versionInfo'],
};

// Compute which sections have data for a course
export function getSectionHasData(c) {
  if (!c) return {};
  const hasOA = c.assessmentType && (c.assessmentType.includes('OA') || c.assessmentType === 'Exam');
  const hasPA = c.assessmentType && (c.assessmentType.includes('PA') || c.assessmentType === 'Project');
  const oa = c.oaDetails || {};
  const pa = c.paDetails || {};
  return {
    assessment: (hasOA && Object.values(oa).some(v => v)) || (hasPA && Object.values(pa).some(v => v)),
    strategy: !!(c.studyStrategy || safeArr(c.studyOrder).length > 0 || safeArr(c.timeAllocation).length > 0 || safeArr(c.quickWins).length > 0 || safeArr(c.hardestConcepts).length > 0 || c.practiceTestNotes),
    competencies: safeArr(c.competencies).length > 0,
    topics: safeArr(c.topicBreakdown).length > 0,
    terms: safeArr(c.keyTermsAndConcepts).length > 0,
    resources: safeArr(c.officialResources).length > 0 || safeArr(c.recommendedExternal).length > 0,
    examTips: safeArr(c.examTips).length > 0,
    mistakes: safeArr(c.commonMistakes).length > 0,
    focus: safeArr(c.knownFocusAreas).length > 0,
    mnemonics: safeArr(c.mnemonics).length > 0,
    milestones: safeArr(c.weeklyMilestones).length > 0,
    instructorTips: safeArr(c.instructorTips).length > 0,
    community: safeArr(c.communityInsights).length > 0,
    meta: !!(c.passRate || c.averageStudyHours > 0 || c.reportedDifficulty || c.certAligned || safeArr(c.prerequisites).length > 0 || safeArr(c.relatedCourses).length > 0 || c.versionInfo),
  };
}

// Section item counts for badges
export function getSectionCounts(c) {
  if (!c) return {};
  return {
    competencies: safeArr(c.competencies).length,
    topics: safeArr(c.topicBreakdown).length,
    terms: safeArr(c.keyTermsAndConcepts).length,
    resources: safeArr(c.officialResources).length + safeArr(c.recommendedExternal).length,
    examTips: safeArr(c.examTips).length,
    mistakes: safeArr(c.commonMistakes).length,
    focus: safeArr(c.knownFocusAreas).length,
    mnemonics: safeArr(c.mnemonics).length,
    milestones: safeArr(c.weeklyMilestones).length,
    instructorTips: safeArr(c.instructorTips).length,
    community: safeArr(c.communityInsights).length,
  };
}

// Return array of section IDs that are missing data
export function missingSections(c) {
  const has = getSectionHasData(c);
  return SECTIONS.filter(s => !has[s.id]).map(s => s.id);
}

// Check if a course has enrichment context (lenient — any of 3 key fields)
export const hasCtx = (c) =>
  safeArr(c?.competencies).length > 0 ||
  safeArr(c?.topicBreakdown).length > 0 ||
  safeArr(c?.examTips).length > 0;

// Stricter check: requires >= 50% of enrichment fields populated
export function isFullyEnriched(c) {
  return courseCompleteness(c).pct >= 50;
}

// Data completeness — count how many enrichment field groups are populated
const ENRICHMENT_FIELDS = [
  c => c?.assessmentType,
  c => safeArr(c?.competencies).length > 0,
  c => safeArr(c?.topicBreakdown).length > 0,
  c => safeArr(c?.keyTermsAndConcepts).length > 0,
  c => safeArr(c?.examTips).length > 0,
  c => safeArr(c?.commonMistakes).length > 0,
  c => safeArr(c?.officialResources).length > 0 || safeArr(c?.recommendedExternal).length > 0,
  c => c?.studyStrategy,
  c => safeArr(c?.studyOrder).length > 0,
  c => safeArr(c?.knownFocusAreas).length > 0,
  c => c?.averageStudyHours > 0,
  c => c?.passRate,
];

export function courseCompleteness(c) {
  if (!c) return { filled: 0, total: ENRICHMENT_FIELDS.length, pct: 0 };
  const filled = ENRICHMENT_FIELDS.filter(fn => fn(c)).length;
  return { filled, total: ENRICHMENT_FIELDS.length, pct: Math.round((filled / ENRICHMENT_FIELDS.length) * 100) };
}

// Staleness — days since last enrichment
export function enrichmentAge(c) {
  if (!c?.lastUpdated) return null;
  const updated = new Date(c.lastUpdated);
  if (isNaN(updated)) return null;
  const days = Math.floor((Date.now() - updated) / 86400000);
  return days;
}

export function enrichmentAgeLabel(days) {
  if (days === null) return null;
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// Data health: should this course be regenerated?
export function dataHealth(c) {
  if (!c || !hasCtx(c)) return null;
  const comp = courseCompleteness(c);
  const age = enrichmentAge(c);
  const stale = age !== null && age > 30;
  if (comp.pct < 50) return { level: 'poor', label: 'Regen', color: 'red' };
  if (comp.pct < 75) return { level: 'low', label: 'Low', color: 'orange' };
  if (stale) return { level: 'stale', label: 'Stale', color: 'orange' };
  return null; // healthy — no indicator needed
}
