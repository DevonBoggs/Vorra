// Tool Execution — processes AI tool calls and updates data

import { EMPTY_DEEP } from "../constants/tools.js";
import { dlog } from "../systems/debug.js";
import { toast } from "../systems/toast.js";
import { uid, todayStr } from "../utils/helpers.js";

export function safeArr(v) { return Array.isArray(v) ? v : []; }

// Normalize strings for matching — strip ALL punctuation/dashes, collapse whitespace
function normMatch(s) {
  return (s || '').toLowerCase()
    .replace(/[\u2013\u2014\u2015\u2212\u2010\u2011\u00AD\-]/g, ' ') // all dash/hyphen variants
    .replace(/[^\w\s]/g, ' ') // strip remaining punctuation
    .replace(/\s+/g, ' ').trim();
}
// Extract course code from a string (e.g., "D415" from "Software Defined Networking – D415")
function extractCode(s) {
  const m = (s || '').match(/\b([A-Za-z]{1,4}\d{2,4})\b/);
  return m ? m[1].toUpperCase() : '';
}

export function deepMergeCourse(existing, updates, opts = {}) {
  const m = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'course_name_match' || k === 'id' || v === undefined || v === null) continue;
    const expected = EMPTY_DEEP[k];
    if (expected !== undefined) {
      if (Array.isArray(expected) && !Array.isArray(v)) {
        if (typeof v === 'string' && v) m[k] = [v];
        else { dlog('warn','tool',`Skipping ${k}: expected array, got ${typeof v}`); continue; }
      } else if (typeof expected === 'object' && expected !== null && !Array.isArray(expected) && typeof v !== 'object') {
        dlog('warn','tool',`Skipping ${k}: expected object, got ${typeof v}`); continue;
      } else if (typeof expected === 'number' && typeof v !== 'number') {
        const num = Number(v);
        if (!isNaN(num)) m[k] = num;
        else continue;
      }
      // Arrays: never overwrite populated data with empty arrays
      else if (Array.isArray(v) && v.length > 0) {
        // In append mode (selective regen), merge arrays instead of replacing
        if (opts.appendArrays && Array.isArray(m[k]) && m[k].length > 0) {
          const existingKeys = new Set(m[k].map(item => JSON.stringify(item)));
          const newItems = v.filter(item => !existingKeys.has(JSON.stringify(item)));
          m[k] = [...m[k], ...newItems];
        } else {
          m[k] = v;
        }
      }
      else if (Array.isArray(v) && v.length === 0) continue; // Skip empty arrays — don't erase existing data
      else if (typeof v === 'object' && !Array.isArray(v)) m[k] = { ...(existing[k]||{}), ...v };
      else if (typeof v === 'string' && v !== '') m[k] = v;
      else if (typeof v === 'boolean') m[k] = v;
      // Skip empty strings, zero, and other falsy values to avoid overwriting
    } else {
      // Unknown field — only set if non-empty (don't pollute with AI-invented empty fields)
      if (v !== '' && v !== 0 && !(Array.isArray(v) && v.length === 0)) m[k] = v;
    }
  }
  m.lastUpdated = new Date().toISOString();
  return m;
}

export function findCourse(courses, match) {
  if (!match || !courses?.length) return -1;
  const l = normMatch(match);
  // Prefer exact matches first (normalized name or courseCode)
  const exact = courses.findIndex(c =>
    normMatch(c?.name) === l ||
    (c?.courseCode || '').toLowerCase().trim() === l
  );
  if (exact >= 0) return exact;
  // Then try courseCode in match string (short codes like "D415" are safe)
  const codeMatch = courses.findIndex(c => {
    const cc = (c?.courseCode || '').toLowerCase().trim();
    return cc && cc.length >= 2 && l.includes(cc);
  });
  if (codeMatch >= 0) return codeMatch;
  // Finally fall back to normalized name contains
  return courses.findIndex(c => {
    const cn = normMatch(c?.name);
    return (cn && l.includes(cn)) || (cn && cn.includes(l) && l.length > cn.length * 0.3);
  });
}

/**
 * Extract a course identifier from a task title and match it to a course.
 * Unified matching strategy used across the entire app.
 * Returns { courseId, courseKey } or { courseId: '', courseKey: titlePrefix }
 */
export function matchTaskToCourse(title, courses) {
  if (!title || !courses?.length) return { courseId: '', courseKey: title || 'Other' };
  // Extract the prefix before any separator (—, –, -, :, |)
  const prefix = title.split(/\s*[\u2014\u2013\u2015\-:|]\s*/)[0]?.trim() || title;
  // Try extracting a course code first (most reliable)
  const code = extractCode(prefix);
  if (code) {
    const idx = courses.findIndex(c => (c.courseCode || '').toUpperCase().trim() === code);
    if (idx >= 0) return { courseId: courses[idx].id || '', courseKey: courses[idx].courseCode || courses[idx].name };
  }
  // Fall back to findCourse with the full prefix
  const idx = findCourse(courses, prefix);
  if (idx >= 0) return { courseId: courses[idx].id || '', courseKey: courses[idx].courseCode || courses[idx].name };
  // Last resort: try the full title
  const idx2 = findCourse(courses, title);
  if (idx2 >= 0) return { courseId: courses[idx2].id || '', courseKey: courses[idx2].courseCode || courses[idx2].name };
  return { courseId: '', courseKey: prefix };
}

// H8: Normalize date/time formats from AI output
function normalizeDate(d) {
  if (!d) return todayStr();
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  // Try parsing as a date
  try { const dt = new Date(d + 'T12:00:00'); if (!isNaN(dt)) return dt.toISOString().split('T')[0]; } catch(_) {}
  return todayStr();
}
function normalizeTime(t) {
  if (!t) return '';
  // Already HH:MM — validate range
  if (/^\d{2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(':').map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return t;
    return '';
  }
  // Handle H:MM
  if (/^\d{1}:\d{2}$/.test(t)) return '0' + t;
  // Handle "8:00 AM" / "8:00 PM" format
  const m = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1]);
    const min = m[2];
    if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12;
    if (m[3]?.toLowerCase() === 'am' && h === 12) h = 0;
    return String(h).padStart(2, '0') + ':' + min;
  }
  return t;
}

const VALID_TOOLS = ['add_tasks', 'add_courses', 'update_courses', 'enrich_course_context', 'generate_study_plan'];

export function executeTools(toolCalls, data, setData) {
  dlog('tool','tool',`Executing ${toolCalls.length} tool(s)`);
  const results = [];
  for (const call of toolCalls) {
    const { name, input } = call;
    dlog('tool','tool',`Tool: ${name}`, { id: call.id });
    if (!VALID_TOOLS.includes(name)) {
      dlog('warn', 'tool', `Rejected unknown tool: ${name}`);
      results.push({id: call.id, result: `Unknown tool: ${name}`});
      continue;
    }
    try {
      if (name === "add_tasks") {
        const ct = safeArr(input.tasks).length;
        setData(d => {
          const tasks = { ...d.tasks };
          for (const t of safeArr(input.tasks)) { const dt=normalizeDate(t.date); if(!tasks[dt])tasks[dt]=[]; tasks[dt].push({id:uid(),time:normalizeTime(t.time),endTime:normalizeTime(t.endTime)||"",title:t.title,category:t.category||"study",priority:t.priority||"medium",notes:t.notes||"",done:false,courseId:t.courseId||""}); }
          return { ...d, tasks };
        });
        results.push({id:call.id,result:`Added ${ct} task(s)`});
        toast(`${ct} task(s) added to calendar`,"success");
      }
      else if (name === "add_courses") {
        const courses = safeArr(input.courses).filter(c => c && c.name);
        const ct = courses.length;
        dlog('info','tool',`add_courses: ${ct} valid courses from ${safeArr(input.courses).length} input`);
        if (ct === 0) {
          results.push({id:call.id,result:`No valid courses to add (input was empty or malformed)`});
        } else {
          let added = 0, merged = 0;
          setData(d => {
            const existing = [...d.courses];
            for (const c of courses) {
              // Sanitize
              const safe = {...EMPTY_DEEP};
              for (const [k,v] of Object.entries(c)) {
                if (v === null || v === undefined) continue;
                if (Array.isArray(EMPTY_DEEP[k]) && !Array.isArray(v)) { safe[k] = typeof v === 'string' ? [v] : []; }
                else if (typeof EMPTY_DEEP[k] === 'object' && !Array.isArray(EMPTY_DEEP[k]) && EMPTY_DEEP[k] !== null && typeof v !== 'object') { continue; }
                else { safe[k] = v; }
              }
              // Check if course already exists (by name or code)
              const nameL = (c.name||"").toLowerCase();
              const codeL = (c.courseCode||"").toLowerCase();
              if (!nameL && !codeL) { existing.push({...safe, id:uid(), name:c.name||"Unnamed", credits:Number(c.credits)||3, difficulty:Number(c.difficulty)||0, status:c.status||"not_started", lastUpdated:new Date().toISOString()}); added++; continue; }
              const existIdx = existing.findIndex(ex => {
                if(!ex?.name) return false;
                return ex.name.toLowerCase().includes(nameL) || nameL.includes(ex.name.toLowerCase()) ||
                (codeL && (ex.courseCode||"").toLowerCase() === codeL) ||
                (codeL && ex.name.toLowerCase().includes(codeL));
              });
              if (existIdx >= 0) {
                // Merge into existing course instead of duplicating
                dlog('info','tool',`add_courses: merging "${c.name}" into existing "${existing[existIdx].name}"`);
                existing[existIdx] = deepMergeCourse(existing[existIdx], safe);
                merged++;
              } else {
                existing.push({...safe, id:uid(), name:c.name||"Unnamed", credits:Number(c.credits)||3, difficulty:Number(c.difficulty)||0, status:c.status||"not_started", lastUpdated:new Date().toISOString()});
                added++;
              }
            }
            return {...d, courses: existing};
          });
          const parts = [];
          if (added > 0) parts.push(`added ${added}`);
          if (merged > 0) parts.push(`merged ${merged} into existing`);
          results.push({id:call.id,result:`${parts.join(", ")}: ${courses.map(c=>c.name).join(", ")}`});
        }
      }
      else if (name === "update_courses") {
        let matched = 0;
        setData(d => ({...d, courses:d.courses.map(c => {
          const u = safeArr(input.updates).find(u => { if(!u?.course_name_match) return false; const l=u.course_name_match.toLowerCase(); return c.name.toLowerCase().includes(l)||(c.courseCode||'').toLowerCase().includes(l); });
          if (!u) return c; matched++; return deepMergeCourse(c, u);
        })}));
        results.push({id:call.id,result:`Updated courses`});
      }
      else if (name === "enrich_course_context") {
        // Pre-compute matches BEFORE setData so counters are reliable
        // (setData updater may be deferred in async contexts)
        const enrichments = safeArr(input.enrichments);
        const matchResults = [];

        // Find which enrichment matches which course using current data
        const currentCourses = data?.courses || [];
        for (const e of enrichments) {
          if (!e?.course_name_match && !e?.courseCode && !e?.name) continue;
          const storedIdx = currentCourses.findIndex(c => {
            const storedCode = (c.courseCode || '').toUpperCase().trim();
            const storedName = normMatch(c.name);
            if (e.courseCode && storedCode && e.courseCode.toUpperCase().trim() === storedCode) return true;
            const matchCode = extractCode(e.course_name_match || e.name || '');
            if (matchCode && storedCode && matchCode === storedCode) return true;
            if (matchCode && normMatch(c.name).includes(matchCode.toLowerCase())) return true;
            if (e.courseCode && normMatch(c.name).includes(e.courseCode.toLowerCase())) return true;
            const matchName = normMatch(e.course_name_match || e.name || '');
            if (storedName && matchName && storedName === matchName) return true;
            if (storedName.length >= 8 && matchName.includes(storedName)) return true;
            if (matchName.length >= 8 && storedName.includes(matchName)) return true;
            return false;
          });
          if (storedIdx >= 0) {
            matchResults.push({ courseIdx: storedIdx, courseName: currentCourses[storedIdx].name, enrichment: e });
          } else {
            // Log all failed matches for debugging
            for (const c of currentCourses) {
              dlog('debug', 'tool', `No match: stored="${c.name}" code="${c.courseCode || ''}" vs match="${e.course_name_match}" eCode="${e.courseCode || ''}" | codes: "${(c.courseCode || '').toUpperCase()}" vs "${extractCode(e.course_name_match || e.name || '')}"`);
            }
          }
        }

        if (matchResults.length > 0) {
          setData(d => ({...d, courses: d.courses.map((c, idx) => {
            const match = matchResults.find(m => m.courseIdx === idx);
            if (!match) return c;
            const merged = deepMergeCourse(c, match.enrichment);
            if (!merged.averageStudyHours || merged.averageStudyHours <= 0) {
              merged.averageStudyHours = [0, 20, 35, 50, 70, 100][merged.difficulty || 3] || 50;
              dlog('info', 'tool', `Auto-set averageStudyHours=${merged.averageStudyHours} for ${c.name} (from difficulty ${merged.difficulty || 3})`);
            }
            const warnings = [];
            if (!safeArr(merged.topicBreakdown).length) warnings.push('topics');
            if (!safeArr(merged.competencies).length) warnings.push('competencies');
            if (!safeArr(merged.examTips).length) warnings.push('exam tips');
            if (warnings.length > 0) dlog('warn', 'tool', `Enrichment for ${c.name} missing: ${warnings.join(', ')}`);
            return merged;
          })}));
        }

        const enrichNames = matchResults.map(m => m.courseName);
        results.push({id:call.id,result:`Enriched ${enrichNames.length} course(s): ${enrichNames.join(", ")}`});
        if (enrichNames.length > 0) toast(`Enriched: ${enrichNames.join(", ")}`,"success");
        else dlog('warn', 'tool', `enrich_course_context called but no courses matched. Enrichments: ${enrichments.map(e => e.course_name_match || e.courseCode || '?').join(', ')}`);
      }
      else if (name === "generate_study_plan") {
        const ct = safeArr(input.daily_tasks).length;
        setData(d => {
          const tasks = { ...d.tasks };
          const courses = d.courses || [];
          for (const t of safeArr(input.daily_tasks)) {
            const dt = normalizeDate(t.date);
            if (!tasks[dt]) tasks[dt] = [];
            // H6: Auto-populate courseId by matching task title to courses
            let cid = t.courseId || '';
            if (!cid || !courses.some(c => c.id === cid)) {
              const { courseId } = matchTaskToCourse(t.title, courses);
              cid = courseId;
            }
            tasks[dt].push({ id: uid(), time: normalizeTime(t.time), endTime: normalizeTime(t.endTime) || '', title: t.title, category: t.category || 'study', priority: t.priority || 'medium', notes: t.notes || '', done: false, courseId: cid });
          }
          return { ...d, tasks };
        });
        results.push({id:call.id,result:`Plan: ${input.summary||'(no summary)'}. ${ct} tasks added.`});
        toast(`Study plan created: ${ct} tasks`,"success");
      }
    } catch(e) {
      dlog('error','tool',`Tool "${name}" error`, e.message);
      results.push({id:call.id,result:`Error: ${e.message}`});
    }
  }
  return results;
}
