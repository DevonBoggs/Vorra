// CSV Import Utility — parses CSV text into Vorra course objects
import { uid } from './helpers.js';

/**
 * Parse a single CSV line respecting quoted fields.
 * Fields containing the delimiter or quotes are wrapped in double quotes.
 * Double quotes inside quoted fields are escaped as "".
 */
function parseLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          // End of quoted field
          inQuotes = false;
          i++;
        }
      } else {
        current += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
        i++;
      } else {
        current += ch;
        i++;
      }
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Auto-detect whether the CSV uses comma or tab delimiters.
 * Counts occurrences of each in the first few lines and picks the more common one.
 */
function detectDelimiter(text) {
  const lines = text.split('\n').slice(0, 5);
  let commas = 0;
  let tabs = 0;

  for (const line of lines) {
    for (const ch of line) {
      if (ch === ',') commas++;
      if (ch === '\t') tabs++;
    }
  }

  return tabs > commas ? '\t' : ',';
}

// Common header names mapped to our field names (all lowercase for matching)
const HEADER_MAP = {
  'name': 'name',
  'course': 'name',
  'course name': 'name',
  'coursename': 'name',
  'title': 'name',
  'code': 'courseCode',
  'coursecode': 'courseCode',
  'course code': 'courseCode',
  'course_code': 'courseCode',
  'credits': 'credits',
  'cu': 'credits',
  'credit': 'credits',
  'credit hours': 'credits',
  'credit_hours': 'credits',
  'units': 'credits',
  'difficulty': 'difficulty',
  'diff': 'difficulty',
  'level': 'difficulty',
  'status': 'status',
  'assessment': 'assessmentType',
  'assessmenttype': 'assessmentType',
  'assessment type': 'assessmentType',
  'assessment_type': 'assessmentType',
  'type': 'assessmentType',
};

/**
 * Check if a row looks like a header row.
 * Returns true if the first column matches a known header name.
 */
function isHeaderRow(fields) {
  if (!fields.length) return false;
  const first = fields[0].toLowerCase().replace(/[^a-z\s_]/g, '').trim();
  return HEADER_MAP.hasOwnProperty(first) || ['#', 'no', 'number', 'row', 'index'].includes(first);
}

/**
 * Parse CSV text into an array of Vorra course objects.
 *
 * Supports:
 * - Comma and tab delimiters (auto-detected)
 * - Quoted fields (CSV standard)
 * - Case-insensitive column matching
 * - Flexible column names (Name/Course/Title, Code/CourseCode, Credits/CU, etc.)
 * - Skips empty rows and header row
 *
 * @param {string} csvText - Raw CSV text
 * @returns {{ courses: Object[], errors: string[] }} Parsed courses and any warnings
 */
export function parseCoursesCSV(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { courses: [], errors: ['No CSV text provided.'] };
  }

  const errors = [];
  const text = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = detectDelimiter(text);
  const rawLines = text.split('\n').filter(l => l.trim().length > 0);

  if (rawLines.length === 0) {
    return { courses: [], errors: ['CSV is empty.'] };
  }

  // Parse first line to check for headers
  const firstFields = parseLine(rawLines[0], delimiter);
  let columnMap = {}; // index -> field name
  let dataStartIndex = 0;

  if (isHeaderRow(firstFields)) {
    // Map each header column to a field name
    for (let i = 0; i < firstFields.length; i++) {
      const key = firstFields[i].toLowerCase().replace(/[^a-z\s_]/g, '').trim();
      if (HEADER_MAP[key]) {
        columnMap[i] = HEADER_MAP[key];
      }
    }
    dataStartIndex = 1;
  } else {
    // No header — assume positional: Name, Code, Credits, Difficulty
    columnMap = { 0: 'name', 1: 'courseCode', 2: 'credits', 3: 'difficulty' };
  }

  // Ensure we have at least a name column
  const hasNameCol = Object.values(columnMap).includes('name');
  if (!hasNameCol) {
    // Fallback: first column is name
    columnMap[0] = 'name';
  }

  const courses = [];

  for (let i = dataStartIndex; i < rawLines.length; i++) {
    const fields = parseLine(rawLines[i], delimiter);

    // Skip rows where all fields are empty
    if (fields.every(f => !f)) continue;

    const row = {};
    for (const [idx, fieldName] of Object.entries(columnMap)) {
      const val = fields[Number(idx)];
      if (val !== undefined && val !== '') {
        row[fieldName] = val;
      }
    }

    // Must have a name
    if (!row.name) {
      errors.push(`Row ${i + 1}: Missing course name, skipped.`);
      continue;
    }

    const course = {
      id: uid(),
      name: row.name,
      courseCode: row.courseCode || '',
      credits: parseCredits(row.credits),
      difficulty: parseDifficulty(row.difficulty),
      status: parseStatus(row.status),
    };

    if (row.assessmentType) {
      course.assessmentType = row.assessmentType;
    }

    courses.push(course);
  }

  if (courses.length === 0 && errors.length === 0) {
    errors.push('No valid courses found in CSV.');
  }

  return { courses, errors };
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseCredits(val) {
  if (!val) return 3;
  const n = Number(val);
  return isNaN(n) || n < 1 ? 3 : Math.round(n);
}

function parseDifficulty(val) {
  if (!val) return 3;
  const n = Number(val);
  if (isNaN(n)) return 3;
  return Math.max(1, Math.min(5, Math.round(n)));
}

function parseStatus(val) {
  if (!val) return 'not_started';
  const s = val.toLowerCase().trim();
  if (s === 'done' || s === 'completed' || s === 'complete' || s === 'passed') return 'completed';
  if (s === 'in_progress' || s === 'in progress' || s === 'active' || s === 'current') return 'in_progress';
  if (s === 'failed' || s === 'not passed') return 'failed';
  return 'not_started';
}
