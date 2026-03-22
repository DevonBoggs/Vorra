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
          for (const t of safeArr(input.tasks)) { const dt=t.date||todayStr(); if(!tasks[dt])tasks[dt]=[]; tasks[dt].push({id:uid(),time:t.time,endTime:t.endTime||"",title:t.title,category:t.category||"study",priority:t.priority||"medium",notes:t.notes||"",done:false,courseId:t.courseId||""}); }
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
              if (!nameL && !codeL) { existing.push({...safe, id:uid(), name:c.name||"Unnamed", credits:Number(c.credits)||3, difficulty:Number(c.difficulty)||3, status:c.status||"not_started", lastUpdated:new Date().toISOString()}); added++; continue; }
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
                existing.push({...safe, id:uid(), name:c.name||"Unnamed", credits:Number(c.credits)||3, difficulty:Number(c.difficulty)||3, status:c.status||"not_started", lastUpdated:new Date().toISOString()});
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
        let enriched = 0;
        const enrichNames = [];
        setData(d => ({...d, courses:d.courses.map(c => {
          const e = safeArr(input.enrichments).find(e => {
            if (!e?.course_name_match && !e?.courseCode && !e?.name) return false;
            // Strategy: try multiple matching approaches, most specific first
            const storedCode = (c.courseCode || '').toUpperCase().trim();
            const storedName = normMatch(c.name);

            // 1. CourseCode match (most reliable) — from enrichment's courseCode field
            if (e.courseCode && storedCode && e.courseCode.toUpperCase().trim() === storedCode) return true;

            // 2. CourseCode extracted from course_name_match or name
            const matchCode = extractCode(e.course_name_match || e.name || '');
            if (matchCode && storedCode && matchCode === storedCode) return true;

            // 3. CourseCode from enrichment data found in stored course name
            if (matchCode && normMatch(c.name).includes(matchCode.toLowerCase())) return true;
            if (e.courseCode && normMatch(c.name).includes(e.courseCode.toLowerCase())) return true;

            // 4. Normalized name matching
            const matchName = normMatch(e.course_name_match || e.name || '');
            if (storedName && matchName && storedName === matchName) return true;
            if (storedName.length >= 8 && matchName.includes(storedName)) return true;
            if (matchName.length >= 8 && storedName.includes(matchName)) return true;

            dlog('debug', 'tool', `No match: stored="${c.name}" code="${storedCode}" vs match="${e.course_name_match}" eCode="${e.courseCode}" | norm: "${storedName}" vs "${matchName}" | codes: "${storedCode}" vs "${matchCode}"`);
            return false;
          });
          if (!e) return c;
          enriched++; enrichNames.push(c.name);
          const merged = deepMergeCourse(c, e);
          // Guarantee averageStudyHours is set after enrichment
          if (!merged.averageStudyHours || merged.averageStudyHours <= 0) {
            merged.averageStudyHours = [0, 20, 35, 50, 70, 100][merged.difficulty || 3] || 50;
            dlog('info', 'tool', `Auto-set averageStudyHours=${merged.averageStudyHours} for ${c.name} (from difficulty ${merged.difficulty || 3})`);
          }
          // Post-merge validation: warn if key fields are still empty
          const warnings = [];
          if (!safeArr(merged.topicBreakdown).length) warnings.push('topics');
          if (!safeArr(merged.competencies).length) warnings.push('competencies');
          if (!safeArr(merged.examTips).length) warnings.push('exam tips');
          if (warnings.length > 0) dlog('warn', 'tool', `Enrichment for ${c.name} missing: ${warnings.join(', ')}`);
          return merged;
        })}));
        results.push({id:call.id,result:`Enriched ${enrichNames.length} course(s): ${enrichNames.join(", ")}`});
        if (enrichNames.length > 0) toast(`Enriched: ${enrichNames.join(", ")}`,"success");
      }
      else if (name === "generate_study_plan") {
        const ct = safeArr(input.daily_tasks).length;
        setData(d => {
          const tasks = { ...d.tasks };
          for (const t of safeArr(input.daily_tasks)) { const dt=t.date||todayStr(); if(!tasks[dt])tasks[dt]=[]; tasks[dt].push({id:uid(),time:t.time,endTime:t.endTime||"",title:t.title,category:t.category||"study",priority:t.priority||"medium",notes:t.notes||"",done:false,courseId:t.courseId||""}); }
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
