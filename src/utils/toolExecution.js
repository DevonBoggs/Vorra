// Tool Execution — processes AI tool calls and updates data

import { EMPTY_DEEP } from "../constants/tools.js";
import { dlog } from "../systems/debug.js";
import { toast } from "../systems/toast.js";
import { uid, todayStr } from "../utils/helpers.js";

export function safeArr(v) { return Array.isArray(v) ? v : []; }

export function deepMergeCourse(existing, updates) {
  const m = { ...existing };
  for (const [k, v] of Object.entries(updates)) {
    if (k === 'course_name_match' || k === 'id' || v === undefined || v === null) continue;
    // Type-check against EMPTY_DEEP defaults to prevent render crashes
    const expected = EMPTY_DEEP[k];
    if (expected !== undefined) {
      if (Array.isArray(expected) && !Array.isArray(v)) {
        // Expected array, got something else — wrap string in array or skip
        if (typeof v === 'string' && v) m[k] = [v];
        else { dlog('warn','tool',`Skipping ${k}: expected array, got ${typeof v}`); continue; }
      } else if (typeof expected === 'object' && expected !== null && !Array.isArray(expected) && typeof v !== 'object') {
        dlog('warn','tool',`Skipping ${k}: expected object, got ${typeof v}`); continue;
      } else if (typeof expected === 'number' && typeof v !== 'number') {
        const num = Number(v);
        if (!isNaN(num)) m[k] = num;
        else continue;
      }
      else if (Array.isArray(v) && v.length > 0) m[k] = v;
      else if (typeof v === 'object' && !Array.isArray(v)) m[k] = { ...(existing[k]||{}), ...v };
      else if (v !== '' && v !== 0) m[k] = v;
    } else {
      // Field not in EMPTY_DEEP — just set it
      m[k] = v;
    }
  }
  m.lastUpdated = new Date().toISOString();
  return m;
}

export function findCourse(courses, match) {
  const l = match.toLowerCase();
  return courses.findIndex(c => c.name.toLowerCase().includes(l) || (c.courseCode||'').toLowerCase().includes(l));
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
          const e = safeArr(input.enrichments).find(e => { if(!e?.course_name_match) return false; const l=e.course_name_match.toLowerCase(); return c.name.toLowerCase().includes(l)||(c.courseCode||'').toLowerCase().includes(l); });
          if (!e) return c;
          enriched++; enrichNames.push(c.name);
          const merged = deepMergeCourse(c, e);
          // Guarantee averageStudyHours is set after enrichment
          if (!merged.averageStudyHours || merged.averageStudyHours <= 0) {
            merged.averageStudyHours = [0, 20, 35, 50, 70, 100][merged.difficulty || 3] || 50;
            dlog('info', 'tool', `Auto-set averageStudyHours=${merged.averageStudyHours} for ${c.name} (from difficulty ${merged.difficulty || 3})`);
          }
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
