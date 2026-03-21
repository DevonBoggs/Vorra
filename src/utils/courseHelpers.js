// Shared course helper functions
import { safeArr } from './toolExecution.js';

// Check if a course has enrichment context
export const hasCtx = (c) =>
  safeArr(c?.competencies).length > 0 ||
  safeArr(c?.topicBreakdown).length > 0 ||
  safeArr(c?.examTips).length > 0;
