import { useState, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, uid, fileToBase64 } from '../../utils/helpers.js';
import { getSTATUS_C, STATUS_L } from '../../constants/categories.js';
import { EMPTY_DEEP, TOOLS, getProviderQuirks, isLikelyVisionCapable, isLikelyToolCapable } from '../../constants/tools.js';
import { useBreakpoint } from '../../systems/breakpoint.js';
import { dlog } from '../../systems/debug.js';
import { toast } from '../../systems/toast.js';
import { buildSystemPrompt, runAILoop, callAIStream } from '../../systems/api.js';
import { useBgTask, bgSet, bgClear, bgAbort, bgLog, bgStream, bgNewAbort, getBgState } from '../../systems/background.js';
import { executeTools, safeArr, deepMergeCourse, findCourse } from '../../utils/toolExecution.js';
import { Badge } from '../../components/ui/Badge.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { Label } from '../../components/ui/Label.jsx';
import { Btn } from '../../components/ui/Btn.jsx';
import { ErrorBoundary } from '../../components/ui/ErrorBoundary.jsx';
import { LogLine } from '../../components/ui/LogLine.jsx';
import { CtxBadge } from '../../components/ui/CtxBadge.jsx';
import CourseDetail from '../../components/course/CourseDetail.jsx';
import { hasCtx, isFullyEnriched, courseCompleteness, enrichmentAge, enrichmentAgeLabel, dataHealth, missingSections, SECTIONS, SECTION_FIELDS } from '../../utils/courseHelpers.js';
import { UNIVERSITY_PRESETS } from '../../constants/universityProfiles.js';
import { CelebrationModal } from '../../components/ui/CelebrationModal.jsx';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const MyCoursesPage = ({ data, setData, profile, setPage, setDate }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', credits: 3, difficulty: 3, status: 'not_started', topics: '', notes: '', assessmentType: '', courseCode: '' });
  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [expanded, setExpanded] = useState({});
  const fileRef = useRef(null);

  // Timer state — computed from bg timestamps (persist across navigation)
  const [now, setNow] = useState(Date.now());
  // Initialize from current bg state so remount doesn't reset the course tracking
  const prevRegenIdRef = useRef(getBgState().regenId || null);

  // Import zone — only used as a secondary "Import More" collapsible after first import
  const [importMoreOpen, setImportMoreOpen] = useState(false);

  // "Complete" done state — 5-second green checkmark after enrichment finishes
  const [enrichDoneAt, setEnrichDoneAt] = useState(null);
  const prevLoadingRef = useRef(false);

  // Global background task state
  const bg = useBgTask();

  const courses = data.courses || [];
  const totalCU = courses.reduce((s, c) => s + (c.credits || 0), 0);
  const doneCU = courses.filter(c => c.status === 'completed').reduce((s, c) => s + (c.credits || 0), 0);
  const activeCourses = courses.filter(c => c.status !== 'completed');
  const unenriched = courses.filter(c => c.status !== 'completed' && !hasCtx(c));
  const enrichedCount = activeCourses.filter(c => hasCtx(c)).length;
  const enrichDone = activeCourses.length > 0 && activeCourses.every(c => isFullyEnriched(c));
  const step1Done = courses.length > 0;

  // Fix 3: robust isEnriching check — no string matching
  const isEnriching = bg.loading && bg.regenId !== null;

  // Keep a ref to fresh data so async loops can read current state (not stale closure)
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; });

  // Shared tool-restricted wrapper — only allows enrich_course_context during enrichment
  const enrichOnlyTools = (calls, d, sd) => {
    const filtered = calls.filter(c => c.name === 'enrich_course_context');
    if (filtered.length < calls.length) {
      const rejected = calls.filter(c => c.name !== 'enrich_course_context').map(c => c.name);
      dlog('warn', 'tool', `Rejected non-enrichment tools: ${rejected.join(', ')}`);
    }
    return filtered.length > 0 ? executeTools(filtered, d, sd) : [{ id: 'skip', result: 'No enrichment tool called' }];
  };

  // Pre-enrichment check — warns about tool-call support
  const checkToolSupport = () => {
    if (!profile) { toast('Connect an AI provider in Settings first', 'warn'); return false; }
    if (!isLikelyToolCapable(profile)) {
      toast(`${profile.name}${profile.model ? ` (${profile.model})` : ''} may not support tool calling. Enrichment requires a model with function calling support (e.g., GPT-4o, Claude Sonnet, Llama 3.1+).`, 'error');
      return false;
    }
    return true;
  };

  // Celebration modal state
  const [celebration, setCelebration] = useState(null);

  // Drag-drop + priority reordering
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const moveCourse = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    dlog('debug', 'state', `Move course ${fromIdx} → ${toIdx}`);
    setData(d => {
      const arr = [...d.courses];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return { ...d, courses: arr };
    });
  };

  const setPriority = (courseId, newNum) => {
    const num = parseInt(newNum);
    if (isNaN(num) || num < 1) return;
    const fromIdx = courses.findIndex(c => c.id === courseId);
    const toIdx = Math.min(Math.max(num - 1, 0), courses.length - 1);
    moveCourse(fromIdx, toIdx);
  };

  const handleDragStart = (e, idx) => {
    setDragIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idx);
  };
  const handleDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverIdx(idx); };
  const handleDragLeave = () => setDragOverIdx(null);
  const handleDrop = (e, toIdx) => { e.preventDefault(); const fromIdx = dragIdx; setDragIdx(null); setDragOverIdx(null); if (fromIdx !== null) moveCourse(fromIdx, toIdx); };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  // Single tick interval — drives both timers from bg timestamps
  useEffect(() => {
    if (!bg.loading) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [bg.loading]);

  // Track course transitions — only set courseStartedAt on genuine regenId changes
  useEffect(() => {
    if (bg.loading && bg.regenId && prevRegenIdRef.current !== bg.regenId) {
      // Save previous course's elapsed time
      if (prevRegenIdRef.current && bg.courseStartedAt) {
        getBgState().courseTimes[prevRegenIdRef.current] = Math.floor((Date.now() - bg.courseStartedAt) / 1000);
      }
      prevRegenIdRef.current = bg.regenId;
      bgSet({ courseStartedAt: Date.now() });
    }
    if (!bg.loading && prevRegenIdRef.current && bg.courseStartedAt) {
      getBgState().courseTimes[prevRegenIdRef.current] = Math.floor((Date.now() - bg.courseStartedAt) / 1000);
      prevRegenIdRef.current = null;
    }
  }, [bg.loading, bg.regenId]);

  // Computed timer values (derived from persistent bg timestamps)
  const batchElapsed = bg.batchStartedAt && bg.loading ? Math.floor((now - bg.batchStartedAt) / 1000) : (bg.batchStartedAt ? Math.floor((Date.now() - bg.batchStartedAt) / 1000) : 0);
  const enrichElapsed = bg.courseStartedAt && bg.loading ? Math.floor((now - bg.courseStartedAt) / 1000) : 0;
  const enrichTimesRef = { current: bg.courseTimes || {} };

  // Fix 3: Detect enrichment completion → show "Complete" state for 5 seconds
  // Only show "Complete" if enrichment actually succeeded (no errors as last log, and courses were enriched)
  useEffect(() => {
    if (prevLoadingRef.current && !bg.loading && bg.logs.length > 0) {
      const lastLog = bg.logs[bg.logs.length - 1];
      const wasAborted = lastLog?.type === 'error' && (lastLog?.content || '').toLowerCase().includes('stop');
      const anyEnriched = activeCourses.some(c => hasCtx(c));
      if (!wasAborted && anyEnriched) {
        setEnrichDoneAt(Date.now());
        const timeout = setTimeout(() => setEnrichDoneAt(null), 5000);
        return () => clearTimeout(timeout);
      }
    }
    prevLoadingRef.current = bg.loading;
  }, [bg.loading]);

  // Course CRUD
  const openAdd = () => { setForm({ name: '', credits: 3, difficulty: 3, status: 'not_started', topics: '', notes: '', assessmentType: '', courseCode: '' }); setEditId(null); setShowAdd(true); };
  const openEdit = c => { setForm({ name: c.name, credits: c.credits, difficulty: c.difficulty, status: c.status, topics: c.topics || '', notes: c.notes || '', assessmentType: c.assessmentType || '', courseCode: c.courseCode || '' }); setEditId(c.id); setShowAdd(true); };
  const saveCourse = () => {
    if (!form.name.trim()) return;
    if (editId) {
      const oldCourse = (data.courses || []).find(c => c.id === editId);
      const wasCompleted = oldCourse?.status === 'completed';
      const nowCompleted = form.status === 'completed';

      setData(d => {
        const updated = { ...d, courses: d.courses.map(c => c.id === editId ? { ...c, ...form, credits: Number(form.credits), difficulty: Number(form.difficulty), lastUpdated: new Date().toISOString() } : c) };

        // Auto-cleanup: remove future plan tasks for the completed course
        if (!wasCompleted && nowCompleted && oldCourse) {
          const todayDate = todayStr();
          const courseName = oldCourse.name.toLowerCase().split(' \u2013 ')[0].split(' - ')[0];
          const courseCode = (oldCourse.courseCode || '').toLowerCase();
          const newTasks = { ...updated.tasks };
          for (const [dt, dayTasks] of Object.entries(newTasks)) {
            if (dt > todayDate) {
              const filtered = dayTasks.filter(t => {
                const titleLower = (t.title || '').toLowerCase();
                const matchesName = courseName && titleLower.includes(courseName);
                const matchesCode = courseCode && titleLower.includes(courseCode);
                return !(t.planId && (matchesName || matchesCode));
              });
              if (filtered.length !== dayTasks.length) {
                newTasks[dt] = filtered;
              }
            }
          }
          updated.tasks = newTasks;
        }

        return updated;
      });

      // Trigger celebration if newly completed
      if (!wasCompleted && nowCompleted && oldCourse) {
        const sessions = data.studySessions || [];
        const courseName = oldCourse.name.toLowerCase().split(' \u2013 ')[0].split(' - ')[0];
        const courseCode = (oldCourse.courseCode || '').toLowerCase();
        const totalMins = sessions.filter(s => {
          const sName = (s.course || '').toLowerCase();
          return (courseName && sName.includes(courseName)) || (courseCode && sName.includes(courseCode));
        }).reduce((sum, s) => sum + (s.mins || 0), 0);
        const totalStudyHoursForCourse = Math.round(totalMins / 6) / 10;
        setCelebration({ courseName: oldCourse.name, credits: oldCourse.credits || 0, studyHours: totalStudyHoursForCourse });
      }

      toast('Course updated', 'success');
    } else {
      setData(d => ({ ...d, courses: [...d.courses, { ...EMPTY_DEEP, ...form, id: uid(), credits: Number(form.credits), difficulty: Number(form.difficulty), lastUpdated: new Date().toISOString() }] }));
      toast(`Added: ${form.name}`, 'success');
    }
    setShowAdd(false);
  };
  const deleteCourse = id => { const name = (data.courses || []).find(c => c.id === id)?.name || ''; setData(d => ({ ...d, courses: d.courses.filter(c => c.id !== id) })); toast(`Removed: ${name}`, 'warn'); };
  const handleImg = e => { const f = e.target.files?.[0]; if (!f) return; setImgFile(f); const r = new FileReader(); r.onload = () => setImgPreview(r.result); r.readAsDataURL(f); e.target.value = ''; };

  // Image parsing
  const parseImage = async () => {
    if (!profile || !imgFile) return;
    if (!isLikelyVisionCapable(profile)) {
      const proceed = window.confirm(
        `${profile.name} (${profile.model || 'unknown model'}) likely does not support image parsing.\n\n` +
        `For best results, switch to a vision-capable model such as GPT-4o, Claude Sonnet/Opus, or Gemini Pro.\n\n` +
        `Try anyway? (The API will attempt a fallback without the image, but results will be poor.)`
      );
      if (!proceed) return;
    }

    bgSet({ loading: true, logs: [{ type: 'user', content: `\uD83D\uDCF7 Parsing: ${imgFile.name}` }], label: 'Parsing degree plan...' });
    bgNewAbort();
    const b64 = await fileToBase64(imgFile);

    const simpleSystem = `You are a degree plan parser. Extract the MINIMUM info for each course visible in the image.
For each course, ONLY extract:
- name: The full course name including code (e.g. "Software Defined Networking \u2013 D415")
- courseCode: Just the code (e.g. "D415")
- credits: Credit units (number)
- status: completed, in_progress, or not_started (based on visual indicators)

Do NOT estimate difficulty, do NOT add topics, do NOT add notes. Keep it minimal \u2014 enrichment will fill in details later.
Call add_courses with ALL courses you can see. Do NOT return an empty array.`;

    const addCourseTool = TOOLS.find(t => t.name === 'add_courses');
    const toolsForParse = [addCourseTool];
    const userMsg = 'Parse this degree plan. Extract ONLY course name, code, credits, and status for each course. Keep data minimal.';
    const imageData = { type: imgFile.type, data: b64 };
    dlog('info', 'api', `Image parse: callAIStream with focused prompt (${simpleSystem.length} chars sys)`);

    let resp;
    try {
      const onChunk = (text) => bgStream(text);
      resp = await callAIStream(profile, simpleSystem, [{ role: 'user', content: userMsg }], imageData, onChunk, toolsForParse);
    } catch (e) {
      if (e.message === 'Cancelled') { bgLog({ type: 'error', content: 'Cancelled' }); bgSet({ loading: false, label: '' }); return; }
      bgLog({ type: 'error', content: `Error: ${e.message}` });
      bgSet({ loading: false, label: '' }); setImgFile(null); setImgPreview(null); return;
    }

    const { toolCalls } = resp;
    dlog('info', 'api', `Image parse done: ${toolCalls.length} tool calls, args: ${JSON.stringify(toolCalls.map(t => ({ name: t.name, coursesCount: safeArr(t.input.courses).length }))).slice(0, 300)}`);

    if (toolCalls.length > 0) {
      const totalCourses = toolCalls.reduce((sum, tc) => sum + safeArr(tc.input.courses).length, 0);
      for (const tc of toolCalls) bgLog({ type: 'tool_call', content: `Tool: ${tc.name}: ${safeArr(tc.input.courses).length} courses` });
      const results = executeTools(toolCalls, data, setData);
      for (const r of results) bgLog({ type: 'tool_result', content: `Done: ${r.result}` });
      if (totalCourses > 0) {
        toast(`${totalCourses} courses imported!`, 'success');
      } else {
        toast(`Model responded but found 0 courses. Try a clearer image or a vision model (Claude Sonnet, GPT-4o).`, 'warn');
      }
    } else {
      if (resp.text) bgLog({ type: 'text', content: resp.text });
      bgLog({ type: 'error', content: 'Model didn\'t return tool calls. The image may not be clear or the model may not support vision.' });
      toast(`Parse failed with ${profile?.name || 'current model'}. Try a vision-capable model (Claude Sonnet/Opus, GPT-4o, Gemini Pro).`, 'warn');
    }

    bgStream(''); bgSet({ loading: false, label: '' }); setImgFile(null); setImgPreview(null);
  };

  // AI enrichment — full course
  const regenCourse = async (course) => {
    if (!checkToolSupport()) return;
    bgSet({ loading: true, regenId: course.id, logs: [{ type: 'user', content: `\uD83D\uDD04 Enriching: ${course.name}` }], label: `Enriching ${course.name}...` });
    dlog('info', 'api', `Regen: ${course.name}`);
    const sys = buildSystemPrompt(dataRef.current, `Regenerate deep context for "${course.name}" using enrich_course_context. Use course_name_match: "${course.name}". Include ALL fields.`);
    const { logs } = await runAILoop(profile, sys, [{ role: 'user', content: `Tell me everything I truly need to know to pass ${course.name}. Fill in all context.` }], dataRef.current, setData, enrichOnlyTools, null, true, 1);
    for (const l of logs) bgLog(l);
    bgSet({ loading: false, regenId: null, label: '' });
  };

  // Selective section regeneration — only specific sections
  const regenSections = async (course, sectionIds) => {
    if (!checkToolSupport() || !sectionIds.length) return;
    const sectionLabels = sectionIds.map(id => SECTIONS.find(s => s.id === id)?.label).filter(Boolean);
    const fieldsList = sectionIds.flatMap(id => SECTION_FIELDS[id] || []);
    bgSet({ loading: true, regenId: course.id, logs: [{ type: 'user', content: `\u2728 Generating ${sectionLabels.join(', ')} for ${course.name}` }], label: `Generating sections for ${course.name}...` });
    dlog('info', 'api', `Selective regen: ${course.name} — sections: ${sectionIds.join(', ')}`);

    const existingContext = [];
    if (safeArr(course.topicBreakdown).length > 0) existingContext.push(`${safeArr(course.topicBreakdown).length} topics: ${safeArr(course.topicBreakdown).map(t => t.topic).join(', ')}`);
    if (safeArr(course.examTips).length > 0) existingContext.push(`${safeArr(course.examTips).length} exam tips`);
    if (course.assessmentType) existingContext.push(`Assessment: ${course.assessmentType}`);

    const sys = buildSystemPrompt(dataRef.current, `Generate ONLY the following sections for "${course.name}" using enrich_course_context. Use course_name_match: "${course.name}": ${sectionLabels.join(', ')}.\n\nDo NOT include other fields \u2014 they already exist.\n${existingContext.length > 0 ? `\nExisting context: ${existingContext.join('; ')}` : ''}`);
    const { logs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate the following missing data for ${course.name}: ${sectionLabels.join(', ')}. Only fill in these specific fields: ${fieldsList.join(', ')}.` }], dataRef.current, setData, enrichOnlyTools, null, true, 1);
    for (const l of logs) bgLog(l);
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const regenAll = async () => {
    if (!checkToolSupport()) return;
    const active = courses.filter(c => c.status !== 'completed');
    if (!active.length) return;
    bgNewAbort();
    bgSet({ loading: true, logs: [{ type: 'user', content: `\uD83D\uDD04 Regenerating ${active.length} courses individually` }], label: `Regenerating 1/${active.length}...`, batchStartedAt: Date.now(), courseStartedAt: null, courseTimes: {} });
    dlog('info', 'api', `Regen all (sequential): ${active.length} courses`);
    let completed = 0;
    let wasCancelled = false;
    for (const course of active) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({ type: 'error', content: `Stopped after ${completed}/${active.length}` }); wasCancelled = true; break; }
      bgSet({ label: `Regenerating ${completed + 1}/${active.length}: ${course.name}...`, regenId: course.id });
      bgLog({ type: 'user', content: `\uD83D\uDD04 ${completed + 1}/${active.length}: ${course.name}` });
      try {
        const sys = buildSystemPrompt(dataRef.current, `Regenerate deep context for "${course.name}" using enrich_course_context. Use course_name_match: "${course.name}". Include ALL fields.`);
        const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Tell me everything I truly need to know to pass ${course.name}. Fill in all context \u2014 competencies, topics with weights, exam tips, key terms, focus areas, resources, common mistakes.` }], dataRef.current, setData, enrichOnlyTools, null, true, 1);
        for (const l of cLogs) bgLog(l);
        completed++;
      } catch (e) {
        bgLog({ type: 'error', content: `Failed: ${course.name} \u2014 ${e.message}` });
      }
    }
    toast(wasCancelled ? `Regeneration stopped: ${completed}/${active.length}` : `Regeneration complete: ${completed}/${active.length}`, wasCancelled ? 'warn' : 'success');
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const enrichNew = async () => {
    if (!checkToolSupport()) return;
    const toEnrich = courses.filter(c => c.status !== 'completed' && !hasCtx(c));
    if (!toEnrich.length) { toast('All courses already enriched!', 'info'); return; }

    bgNewAbort();
    bgSet({ loading: true, regenId: null, logs: [{ type: 'user', content: `\u2728 Enriching ${toEnrich.length} course${toEnrich.length > 1 ? 's' : ''} individually` }], label: `Enriching 1/${toEnrich.length}...`, batchStartedAt: Date.now(), courseStartedAt: null, courseTimes: {} });
    dlog('info', 'api', `Enrich new (sequential): ${toEnrich.length} courses`);

    let completed = 0;
    let wasCancelled = false;
    for (let i = 0; i < toEnrich.length; i++) {
      if (getBgState().abortCtrl?.signal?.aborted) {
        bgLog({ type: 'error', content: `Stopped after ${completed}/${toEnrich.length} courses` });
        wasCancelled = true;
        break;
      }
      const course = toEnrich[i];
      bgSet({ label: `Enriching ${i + 1}/${toEnrich.length}: ${course.name}...`, regenId: course.id });
      bgLog({ type: 'user', content: `\uD83D\uDD04 ${i + 1}/${toEnrich.length}: ${course.name}` });

      try {
        const sys = buildSystemPrompt(dataRef.current, `Generate deep context for ONLY "${course.name}" (${course.courseCode || 'no code'}) using enrich_course_context. Use the EXACT course name "${course.name}" as the course_name_match value. Include ALL fields. Do NOT enrich other courses.`);
        const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate comprehensive study context for ${course.name}${course.courseCode ? ` (${course.courseCode})` : ''}.${course.credits ? ` ${course.credits} CU.` : ''} Include everything a student needs to pass: assessment format, all competencies, topic breakdown with weights, exam tips, key terms, focus areas, resources, common mistakes, and estimated total study hours (averageStudyHours). Use course_name_match: "${course.name}"` }], dataRef.current, setData, enrichOnlyTools, null, true, 1);
        for (const l of cLogs) bgLog(l);
        // Verify enrichment by checking tool result logs (dataRef may not have updated yet)
        const wasEnriched = cLogs.some(l => l.type === 'tool_result' && l.content.includes('Enriched') && !l.content.includes('Enriched 0'));
        if (wasEnriched) {
          completed++;
          dlog('info', 'api', `Enriched ${completed}/${toEnrich.length}: ${course.name}`);
        } else {
          bgLog({ type: 'warn', content: `${course.name}: AI may not have called the enrichment tool correctly. Check if your model supports function calling.` });
          dlog('warn', 'api', `Enrichment may have failed for ${course.name} — no successful tool result in logs`);
        }
      } catch (e) {
        bgLog({ type: 'error', content: `Failed: ${course.name} \u2014 ${e.message}` });
        dlog('error', 'api', `Enrich failed: ${course.name}`, e.message);
      }
    }

    if (wasCancelled) {
      toast(`Enrichment stopped: ${completed}/${toEnrich.length} courses completed`, 'warn');
    } else {
      toast(`Enrichment complete: ${completed}/${toEnrich.length} courses processed`, 'success');
    }
    bgSet({ loading: false, regenId: null, label: '' });
  };

  // Fill All Gaps — selective regen for all courses with missing sections
  const fillAllGaps = async () => {
    if (!profile) return;
    const coursesWithGaps = activeCourses.filter(c => hasCtx(c) && missingSections(c).length > 0);
    if (!coursesWithGaps.length) { toast('All sections populated!', 'info'); return; }

    bgSet({ loading: true, logs: [{ type: 'user', content: `\u2728 Filling gaps in ${coursesWithGaps.length} course${coursesWithGaps.length > 1 ? 's' : ''}` }], label: `Filling gaps 1/${coursesWithGaps.length}...`, batchStartedAt: Date.now(), courseStartedAt: null, courseTimes: {} });
    dlog('info', 'api', `Fill all gaps: ${coursesWithGaps.length} courses`);

    let completed = 0;
    for (const course of coursesWithGaps) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({ type: 'error', content: `Stopped after ${completed}/${coursesWithGaps.length}` }); break; }
      completed++;
      const missing = missingSections(course);
      const sectionLabels = missing.map(id => SECTIONS.find(s => s.id === id)?.label).filter(Boolean);
      const fieldsList = missing.flatMap(id => SECTION_FIELDS[id] || []);

      bgSet({ label: `Filling gaps ${completed}/${coursesWithGaps.length}: ${course.name} (${missing.length} sections)...`, regenId: course.id });
      bgLog({ type: 'user', content: `\u2728 ${completed}/${coursesWithGaps.length}: ${course.name} \u2014 missing: ${sectionLabels.join(', ')}` });

      const existingContext = [];
      if (safeArr(course.topicBreakdown).length > 0) existingContext.push(`${safeArr(course.topicBreakdown).length} topics`);
      if (safeArr(course.examTips).length > 0) existingContext.push(`${safeArr(course.examTips).length} exam tips`);
      if (course.assessmentType) existingContext.push(`Assessment: ${course.assessmentType}`);

      const sys = buildSystemPrompt(dataRef.current, `Generate ONLY the following sections for "${course.name}" using enrich_course_context. Use course_name_match: "${course.name}": ${sectionLabels.join(', ')}.\n\nDo NOT include other fields \u2014 they already exist.\n${existingContext.length > 0 ? `\nExisting context: ${existingContext.join('; ')}` : ''}`);
      const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate the following missing data for ${course.name}: ${sectionLabels.join(', ')}. Only fill in these specific fields: ${fieldsList.join(', ')}.` }], dataRef.current, setData, enrichOnlyTools, null, true, 1);
      for (const l of cLogs) bgLog(l);
    }

    toast(`Gaps filled: ${completed}/${coursesWithGaps.length} courses updated`, 'success');
    bgSet({ loading: false, regenId: null, label: '' });
  };

  // Count courses needing regen based on data health
  const coursesNeedingRegen = activeCourses.filter(c => {
    const h = dataHealth(c);
    return h && (h.level === 'poor' || h.level === 'stale');
  });
  const coursesWithGaps = activeCourses.filter(c => hasCtx(c) && missingSections(c).length > 0);

  return (
    <div className="fade">
      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="sf-nav" onClick={() => setPage('dashboard')} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: T.soft, fontSize: fs(12), fontWeight: 600 }}>{'\u2190'} Dashboard</button>
          <div><h1 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 2 }}>My Courses</h1><p style={{ color: T.dim, fontSize: fs(13) }}>{courses.length} courses {'\u00B7'} {doneCU}/{totalCU} CU</p></div>
        </div>
      </div>

      {/* Hidden file input — used by import buttons */}
      <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />

      {/* Image preview — shown when a file is selected, regardless of which section triggered it */}
      {imgPreview && (
        <div style={{ marginBottom: 16, padding: 12, background: T.bg2, borderRadius: 10, border: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: fs(12), fontWeight: 700 }}>Degree Plan Image</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn small v="ghost" onClick={() => { setImgFile(null); setImgPreview(null); }}>Remove</Btn>
              <Btn small v="ai" onClick={parseImage} disabled={bg.loading || !profile}>
                {bg.loading ? <><Ic.Spin s={14} /> Parsing...</> : <><Ic.AI s={14} /> Extract Courses</>}
              </Btn>
            </div>
          </div>
          <img src={imgPreview} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, border: `1px solid ${T.border}` }} alt="Uploaded degree plan" />
          {!profile && <div style={{ marginTop: 8, padding: '6px 10px', borderRadius: 6, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(10), color: T.orange }}>Connect an AI provider in Settings to extract courses.</div>}
        </div>
      )}

      {/* ─── AI ACTIVITY BAR ─── */}
      {(bg.loading || bg.logs.length > 0) && (
        <div style={{ background: T.panel, border: `1px solid ${bg.loading ? T.purple + '33' : enrichDoneAt ? T.accent + '33' : T.border}`, borderRadius: 10, padding: 14, marginBottom: 16, transition: 'border-color .3s' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bg.streamText || bg.logs.length > 0 ? 8 : 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {bg.loading ? <Ic.Spin s={14} /> : enrichDoneAt ? <span style={{ color: T.accent, fontSize: fs(14) }}>{'\u2713'}</span> : null}
              <span style={{ fontSize: fs(12), fontWeight: 700, color: bg.loading ? T.purple : enrichDoneAt ? T.accent : T.soft }}>
                {bg.loading ? (bg.label || 'AI working...') : enrichDoneAt ? 'Complete' : 'AI Activity'}
              </span>
              {/* Per-course timer */}
              {isEnriching && (
                <span style={{ color: T.dim, fontFamily: "'JetBrains Mono',monospace", fontSize: fs(10) }}>
                  ({fmtTime(enrichElapsed)})
                </span>
              )}
              {/* Batch total timer */}
              {isEnriching && batchElapsed > 0 && (
                <span style={{ color: T.dim, fontFamily: "'JetBrains Mono',monospace", fontSize: fs(9), marginLeft: 4 }}>
                  total {fmtTime(batchElapsed)}
                </span>
              )}
              {/* Show batch total after completion */}
              {!bg.loading && enrichDoneAt && batchElapsed > 0 && (
                <span style={{ color: T.dim, fontFamily: "'JetBrains Mono',monospace", fontSize: fs(9), marginLeft: 4 }}>
                  {fmtTime(batchElapsed)} total
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {bg.loading && getBgState().abortCtrl && <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, regenId: null, label: '' }); toast('Cancelled', 'info'); }} style={{ color: T.red, borderColor: T.red }}>Stop</Btn>}
              {!bg.loading && bg.logs.length > 0 && <Btn small v="ghost" onClick={() => { bgSet({ logs: [], batchStartedAt: null, courseStartedAt: null, courseTimes: {} }); setEnrichDoneAt(null); }}>Clear</Btn>}
            </div>
          </div>
          {/* Enrichment progress bar */}
          {isEnriching && (() => {
            const total = activeCourses.length;
            const done = activeCourses.filter(c => hasCtx(c)).length;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            return (
              <div style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: fs(10), color: T.dim, marginBottom: 4 }}>
                  <span>{done}/{total} courses enriched</span>
                  <span>{pct}%</span>
                </div>
                <div style={{ height: 4, borderRadius: 4, background: T.input, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, background: `linear-gradient(90deg, ${T.purple}, ${T.accent})`, transition: 'width 0.6s cubic-bezier(.4,0,.2,1)' }} />
                </div>
              </div>
            );
          })()}
          {/* Per-course chips with elapsed times */}
          {(isEnriching || (!bg.loading && Object.keys(enrichTimesRef.current).length > 0 && enrichDoneAt)) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: bg.streamText || bg.logs.length > 0 ? 8 : 0 }}>
              {courses.filter(c => c.status !== 'completed').map(c => {
                const enriched = hasCtx(c);
                const active = bg.regenId === c.id;
                const savedTime = enrichTimesRef.current[c.id];
                return (
                  <span key={c.id} style={{ fontSize: fs(9), padding: '3px 8px', borderRadius: 5, fontWeight: 600,
                    background: active ? T.purpleD : enriched ? T.accentD : T.input,
                    color: active ? T.purple : enriched ? T.accent : T.dim,
                    border: !enriched && !active ? `1px dashed ${T.border}` : '1px solid transparent',
                  }}>
                    {active ? '\u23F3 ' : ''}{c.courseCode || c.name.slice(0, 15)}{enriched ? ' \u2713' : ''}
                    {savedTime > 0 && (
                      <span style={{ marginLeft: 4, fontSize: fs(8), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>
                        {savedTime}s
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          )}
          {bg.streamText && <div style={{ padding: '6px 10px', borderRadius: 7, background: T.purpleD, border: `1px solid ${T.purple}33`, fontSize: fs(11), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto', marginBottom: 4 }}>{bg.streamText}</div>}
          {bg.logs.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>{bg.logs.map((l, i) => <LogLine key={i} l={l} />)}</div>}
        </div>
      )}

      {/* ═══ UNIFIED SETUP GUIDE — single adaptive card ═══ */}
      {(() => {
        const hasSchool = !!data.universityProfile?.name;
        const schoolName = data.universityProfile?.shortName || data.universityProfile?.name || '';
        const hasImport = courses.length > 0;
        const hasEnrich = activeCourses.length > 0 && activeCourses.every(c => hasCtx(c));
        const hasPlan = (data.planHistory || []).length > 0;
        const hasProfile = !!profile;
        const allDone = hasImport && hasSchool && hasEnrich && hasPlan;
        const hasEnrichErrors = bg.logs.some(l => l.type === 'error');
        const enrichPartial = enrichedCount > 0 && unenriched.length > 0;

        // Steps in logical order: school first (often done in onboarding), then import, enrich, plan
        const steps = [
          { key: 'school', label: 'School', done: hasSchool },
          { key: 'import', label: 'Import', done: hasImport },
          { key: 'enrich', label: 'Study Prep', done: hasEnrich },
          { key: 'plan', label: 'Plan', done: hasPlan },
        ];
        const doneCount = steps.filter(s => s.done).length;
        const activeStep = steps.find(s => !s.done) || null;

        if (allDone) return null;

        return (
          <div style={{ display: 'flex', borderRadius: 12, overflow: 'hidden', marginBottom: 16, border: `1px solid ${T.accent}44`, background: T.card, boxShadow: `0 0 20px ${T.accent}11` }}>
            <div style={{ width: 5, flexShrink: 0, background: `linear-gradient(180deg, ${T.accent}, ${T.purple})` }} />
            <div style={{ flex: 1, padding: '16px 20px' }}>
              {/* Step checklist — horizontal dots */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
                {steps.map((s, i) => (
                  <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {i > 0 && <div style={{ width: 20, height: 1, background: s.done ? T.accent : T.border }} />}
                    <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(11), fontWeight: 700, background: activeStep === s ? T.accent : s.done ? T.accent + '33' : T.input, color: activeStep === s ? T.bg : s.done ? T.accent : T.dim, border: activeStep === s ? 'none' : `1px solid ${s.done ? T.accent + '55' : T.border}`, transition: 'all .2s' }}
                      role="listitem" aria-label={`${s.label}: ${s.done ? 'Complete' : activeStep === s ? 'Current step' : 'Pending'}`}>
                      {s.done ? '\u2713' : doneCount + 1 === i + 1 ? i + 1 : '\u00B7'}
                    </div>
                    <span style={{ fontSize: fs(10), fontWeight: activeStep === s ? 700 : 500, color: activeStep === s ? T.accent : s.done ? T.soft : T.dim }}>{s.label}</span>
                  </div>
                ))}
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: fs(9), color: T.dim }}>{doneCount}/4</span>
              </div>

              {/* ── SCHOOL step ── */}
              {activeStep?.key === 'school' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 3 }}>{'\uD83C\uDF93'} What school are you attending?</div>
                      <div style={{ fontSize: fs(11), color: T.soft, lineHeight: 1.5 }}>This helps AI generate study content tailored to your school{'\u2019'}s exams, grading, and term structure.</div>
                    </div>
                    <Btn small v="ghost" onClick={() => setPage('settings')} style={{ flexShrink: 0 }}>Full Setup {'\u2192'}</Btn>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {UNIVERSITY_PRESETS.filter(p => p.presetId !== 'self-study').map(p => (
                      <button key={p.presetId} onClick={() => { setData(d => ({ ...d, universityProfile: { ...p } })); toast(`School set: ${p.shortName}`, 'success'); }}
                        style={{ padding: '8px 18px', borderRadius: 10, border: `2px solid ${T.accent}44`, background: T.accentD, cursor: 'pointer', fontSize: fs(11), fontWeight: 700, color: T.accent, transition: 'all .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accent + '28'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = T.accent + '44'; e.currentTarget.style.background = T.accentD; e.currentTarget.style.transform = 'none'; }}
                      >{p.shortName}</button>
                    ))}
                    <button onClick={() => setPage('settings')}
                      style={{ padding: '8px 18px', borderRadius: 10, border: `2px dashed ${T.border}`, background: 'transparent', cursor: 'pointer', fontSize: fs(11), fontWeight: 600, color: T.dim }}
                    >Other School...</button>
                  </div>
                </div>
              )}

              {/* ── IMPORT step — full import interface inline ── */}
              {activeStep?.key === 'import' && (
                <div>
                  <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 3 }}>
                    {hasSchool ? `${'\uD83D\uDCDA'} Welcome, ${schoolName} student! Import your courses.` : `${'\uD83D\uDCDA'} Import your courses to get started`}
                  </div>
                  <div style={{ fontSize: fs(11), color: T.soft, marginBottom: 12, lineHeight: 1.5 }}>Upload your degree plan, or add courses manually. You can always add more later.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                    {[
                      { key: 'screenshot', label: 'Screenshot / Image', desc: 'Upload a photo of your degree plan', icon: '\uD83D\uDCF7', color: T.accent, colorD: T.accentD, needsAI: true, onClick: () => { if (!profile) { toast('Connect an AI provider in Settings first', 'warn'); return; } fileRef.current.accept = 'image/*'; fileRef.current.click(); } },
                      { key: 'document', label: 'Document / PDF', desc: 'Upload PDF, DOCX, or text file', icon: '\uD83D\uDCC4', color: T.blue, colorD: T.blueD, needsAI: true, onClick: () => { if (!profile) { toast('Connect an AI provider in Settings first', 'warn'); return; } fileRef.current.accept = '.pdf,.doc,.docx,.txt,.csv'; fileRef.current.click(); } },
                      { key: 'manual', label: 'Add Manually', desc: 'Type course details one at a time', icon: '\u270F\uFE0F', color: T.text, colorD: T.input, needsAI: false, onClick: () => setShowAdd(true) },
                    ].map(opt => {
                      const disabled = bg.loading || (opt.needsAI && !profile);
                      return (
                        <button key={opt.key} onClick={opt.onClick} disabled={bg.loading}
                          className="sf-import-btn"
                          style={{ padding: '16px', borderRadius: 12, border: `1.5px solid ${disabled ? T.border : opt.color + '44'}`, background: disabled ? T.input : opt.colorD, cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: disabled ? 0.5 : 1, transition: 'all .2s ease', transform: 'translateY(0)' }}
                          onMouseEnter={e => { if (disabled) return; e.currentTarget.style.borderColor = opt.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 20px ${opt.color}22`; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = opt.color + '44'; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                          <div style={{ fontSize: fs(18), marginBottom: 6 }}>{opt.icon}</div>
                          <div style={{ fontSize: fs(12), fontWeight: 700, color: disabled ? T.dim : opt.color, marginBottom: 3 }}>{opt.label}</div>
                          <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.4 }}>{opt.desc}</div>
                          {opt.needsAI && !profile && <div style={{ fontSize: fs(9), color: T.orange, marginTop: 6 }}>Requires AI connection</div>}
                          {!opt.needsAI && <div style={{ fontSize: fs(9), color: T.accent, marginTop: 6 }}>No AI needed</div>}
                        </button>
                      );
                    })}
                  </div>
                  {!profile && (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>Screenshot and document import require an AI provider.</span>
                      <Btn small v="ghost" onClick={() => setPage('settings')} style={{ color: T.orange, borderColor: T.orange + '55', flexShrink: 0 }}>Connect AI {'\u2192'}</Btn>
                    </div>
                  )}
                  {profile && !isLikelyVisionCapable(profile) && (
                    <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange }}>
                      Your current model may not support image parsing. For best results, use Claude Sonnet/Opus, GPT-4o, or Gemini Pro.
                    </div>
                  )}
                </div>
              )}

              {/* ── ENRICH step ── */}
              {activeStep?.key === 'enrich' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 3 }}>
                        {'\u2728'} {bg.loading ? 'Building study context...' : hasEnrichErrors && !bg.loading ? 'Some courses had issues' : enrichPartial ? `${enrichedCount}/${courses.length} courses prepared` : `Prepare ${unenriched.length} course${unenriched.length > 1 ? 's' : ''} for studying`}
                      </div>
                      <div style={{ fontSize: fs(11), color: T.soft, lineHeight: 1.5 }}>
                        {!hasProfile
                          ? 'Connect an AI provider in Settings to enable this step.'
                          : hasEnrichErrors && !bg.loading
                          ? 'The AI connection was interrupted or timed out. You can retry the failed courses.'
                          : enrichPartial
                          ? `${unenriched.length} course${unenriched.length > 1 ? 's' : ''} remaining. You can continue or retry.`
                          : 'AI will analyze each course and generate topics, exam tips, difficulty ratings, and study hour estimates.'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                      {!hasProfile ? (
                        <Btn small v="secondary" onClick={() => setPage('settings')}>Connect AI {'\u2192'}</Btn>
                      ) : bg.loading ? (
                        <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, regenId: null, label: '' }); toast('Stopped', 'info'); }}>Stop</Btn>
                      ) : (
                        <Btn small v="ai" onClick={enrichNew} disabled={bg.loading}>{hasEnrichErrors || enrichPartial ? 'Retry / Continue' : 'Prepare All'}</Btn>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── PLAN step ── */}
              {activeStep?.key === 'plan' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: fs(14), fontWeight: 700, color: T.text, marginBottom: 3 }}>{'\uD83D\uDCC5'} Your courses are ready! Build your study plan.</div>
                    <div style={{ fontSize: fs(11), color: T.soft }}>Head to the Study Planner to generate a personalized schedule based on your availability.</div>
                  </div>
                  <Btn small v="ai" onClick={() => setPage('planner')}>Open Planner {'\u2192'}</Btn>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── COURSE LIST ─── */}
      {step1Done && (
        <div>
          {/* Row 1: Title + Add/Import actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h3 style={{ fontSize: fs(14), fontWeight: 700, margin: 0 }}>Courses ({courses.length})</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {coursesWithGaps.length > 0 && unenriched.length === 0 && !bg.loading && (
                <Btn small v="ai" onClick={fillAllGaps} disabled={bg.loading || !profile}>
                  Fill All Gaps ({coursesWithGaps.length})
                </Btn>
              )}
              {enrichDone && !bg.loading && (
                <Badge color={T.accent} bg={T.accentD}>{'\u2713'} All Enriched</Badge>
              )}
              <div style={{ position: 'relative' }}>
                {importMoreOpen && <div onClick={() => setImportMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />}
                <Btn v="secondary" onClick={() => setImportMoreOpen(!importMoreOpen)}>{'\uD83D\uDCC2'} Import More {importMoreOpen ? '\u25B4' : '\u25BE'}</Btn>
                {importMoreOpen && (
                  <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20, padding: '10px', border: `1px solid ${T.border}`, borderRadius: 10, background: T.card, boxShadow: `0 8px 24px rgba(0,0,0,.3)`, minWidth: 240 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <button onClick={() => { if (!profile) { toast('Connect an AI provider first', 'warn'); return; } fileRef.current.accept = 'image/*'; fileRef.current.click(); setImportMoreOpen(false); }} disabled={bg.loading || !profile}
                        className="sf-import-btn" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.accent}44`, background: T.accentD, cursor: !profile || bg.loading ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: profile ? 1 : 0.5, transition: 'all .15s' }}
                        onMouseEnter={e => { if (profile) e.currentTarget.style.borderColor = T.accent; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = T.accent + '44'; }}>
                        <div style={{ fontSize: fs(11), fontWeight: 700, color: T.accent }}>Screenshot / Image</div>
                      </button>
                      <button onClick={() => { if (!profile) { toast('Connect an AI provider first', 'warn'); return; } fileRef.current.accept = '.pdf,.doc,.docx,.txt,.csv'; fileRef.current.click(); setImportMoreOpen(false); }} disabled={bg.loading || !profile}
                        className="sf-import-btn" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.blue}44`, background: T.blueD, cursor: !profile || bg.loading ? 'not-allowed' : 'pointer', textAlign: 'left', opacity: profile ? 1 : 0.5, transition: 'all .15s' }}
                        onMouseEnter={e => { if (profile) e.currentTarget.style.borderColor = T.blue; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = T.blue + '44'; }}>
                        <div style={{ fontSize: fs(11), fontWeight: 700, color: T.blue }}>Document / PDF</div>
                      </button>
                      <button onClick={() => { setShowAdd(true); setImportMoreOpen(false); }}
                        className="sf-import-btn" style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.input, cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = T.soft; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}>
                        <div style={{ fontSize: fs(11), fontWeight: 700, color: T.text }}>Add Manually</div>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          {/* Row 2: Secondary controls + regen hint */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <Btn small v="ghost" onClick={() => setExpanded(courses.reduce((a, c) => ({ ...a, [c.id]: true }), {}))}>Expand All</Btn>
              <Btn small v="ghost" onClick={() => setExpanded({})}>Collapse All</Btn>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {coursesNeedingRegen.length > 0 && !bg.loading && (
                <span style={{ fontSize: fs(10), color: T.orange, fontWeight: 500 }}>
                  {coursesNeedingRegen.length} course{coursesNeedingRegen.length > 1 ? 's' : ''} may benefit from regeneration
                </span>
              )}
              {enrichedCount > 0 && (
                <Btn small v="ghost" onClick={regenAll} disabled={bg.loading || !profile || activeCourses.length === 0}>
                  Regenerate{enrichedCount < activeCourses.length ? ` (${enrichedCount})` : ' All'}
                </Btn>
              )}
            </div>
          </div>

          {/* Provider warnings */}
          {profile && getProviderQuirks(profile).noToolSupport && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: T.redD, border: `1px solid ${T.red}33`, fontSize: fs(11), color: T.red, marginBottom: 10 }}>
              {profile.name} does not support tool calling. Enrichment requires a provider with function calling support (e.g., OpenAI, Anthropic, DeepSeek, Groq).
            </div>
          )}

          {/* Course cards */}
          {courses.length === 0 ? <div style={{ padding: '20px 0', textAlign: 'center', color: T.dim, fontSize: fs(13) }}>No courses yet. Import a degree plan or add manually.</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {courses.map((c, i) => {
                const health = dataHealth(c);
                const healthColor = health ? (health.color === 'red' ? T.red : T.orange) : null;
                return (
                <div key={c.id} draggable onDragStart={e => handleDragStart(e, i)} onDragOver={e => handleDragOver(e, i)} onDragLeave={handleDragLeave} onDrop={e => handleDrop(e, i)} onDragEnd={handleDragEnd} className="fade sf-card"
                  style={{ background: dragOverIdx === i ? T.purpleD : dragIdx === i ? T.input : T.card, border: `1px solid ${dragOverIdx === i ? T.purple : T.border}`, borderRadius: 12, padding: '10px 14px', opacity: dragIdx === i ? 0.5 : 1, cursor: 'grab' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <input type="number" min="1" max={courses.length} value={i + 1} onChange={e => setPriority(c.id, e.target.value)} onClick={e => e.stopPropagation()} style={{ width: 36, padding: '4px 2px', textAlign: 'center', fontSize: fs(13), fontWeight: 700, color: c.status === 'completed' ? T.dim : T.accent, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, cursor: 'text', fontFamily: "'Outfit',sans-serif" }} />
                    <div style={{ width: 5, height: 40, borderRadius: 3, background: STATUS_C[c.status] || T.dim, flexShrink: 0 }} />
                    <div style={{ flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => setExpanded(e => ({ ...e, [c.id]: !e[c.id] }))}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: fs(13), fontWeight: 600 }}>{c.name}</span>
                        <Badge color={STATUS_C[c.status] || T.dim} bg={(STATUS_C[c.status] || T.dim) + '22'}>{STATUS_L[c.status] || c.status}</Badge>
                        {c.assessmentType && <Badge color={T.blue} bg={T.blueD}>{c.assessmentType}</Badge>}
                        {hasCtx(c) ? (() => {
                          const comp = courseCompleteness(c);
                          const age = enrichmentAge(c);
                          const ageLabel = enrichmentAgeLabel(age);
                          const compColor = comp.pct >= 75 ? T.accent : comp.pct >= 50 ? T.yellow : T.orange;
                          return <>
                            <Badge color={compColor} bg={compColor + '22'}>{comp.filled}/{comp.total}</Badge>
                            {ageLabel && <span style={{ fontSize: fs(9), color: age > 30 ? T.orange : T.dim }}>{ageLabel}</span>}
                            {/* Fix 4: Data health indicator */}
                            {health && c.status !== 'completed' && (
                              <span
                                onClick={e => { e.stopPropagation(); regenCourse(c); }}
                                style={{
                                  fontSize: fs(9), color: healthColor, fontWeight: 600,
                                  cursor: profile && !bg.loading ? 'pointer' : 'default',
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  padding: '2px 8px', borderRadius: 999,
                                  background: healthColor + '15',
                                  border: `1px solid ${healthColor}33`,
                                  transition: 'all .15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = healthColor + '25'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = healthColor + '15'; }}
                                title={health.level === 'poor' ? 'Less than half of enrichment fields populated' : health.level === 'stale' ? `Last enriched ${ageLabel}` : 'Some enrichment fields missing'}
                              >
                                <span style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: healthColor,
                                  animation: health.level === 'poor' ? 'dotPulse 2s infinite' : 'none',
                                  flexShrink: 0,
                                }} />
                                {health.label}
                              </span>
                            )}
                          </>;
                        })() : c.status !== 'completed' && <Badge color={T.orange} bg={T.orangeD}>NEEDS ENRICHMENT</Badge>}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: fs(11), color: T.dim, flexWrap: 'wrap' }}>
                        <span>{c.credits || 0} CU</span>
                        <span>{'\u2605'.repeat(c.difficulty || 0)}{'\u2606'.repeat(5 - (c.difficulty || 0))}</span>
                        {c.averageStudyHours > 0 && <span>~{c.averageStudyHours}h</span>}
                        <CtxBadge label="Topics" count={safeArr(c.topicBreakdown).length} color={T.purple} />
                        <CtxBadge label="Terms" count={safeArr(c.keyTermsAndConcepts).length} color={T.blue} />
                        <CtxBadge label="Tips" count={safeArr(c.examTips).length} color={T.yellow} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 3, flexShrink: 0, alignItems: 'center' }}>
                      <button className="sf-icon-btn" onClick={e => { e.stopPropagation(); if (i > 0) moveCourse(i, i - 1); }} disabled={i === 0} style={{ background: 'none', border: 'none', color: i > 0 ? T.soft : T.faint, cursor: i > 0 ? 'pointer' : 'default', padding: 2, fontSize: fs(16), lineHeight: 1 }}>{'\u2191'}</button>
                      <button className="sf-icon-btn" onClick={e => { e.stopPropagation(); if (i < courses.length - 1) moveCourse(i, i + 1); }} disabled={i === courses.length - 1} style={{ background: 'none', border: 'none', color: i < courses.length - 1 ? T.soft : T.faint, cursor: i < courses.length - 1 ? 'pointer' : 'default', padding: 2, fontSize: fs(16), lineHeight: 1 }}>{'\u2193'}</button>
                      {c.status !== 'completed' && !hasCtx(c) ? (
                        <Btn small v="ai" onClick={() => regenCourse(c)} disabled={!profile || bg.loading}>
                          {bg.regenId === c.id ? <Ic.Spin s={12} /> : 'Enrich'}
                        </Btn>
                      ) : (
                        <Btn small v={bg.regenId === c.id ? 'ai' : 'ghost'} onClick={() => regenCourse(c)} disabled={!profile || bg.loading}>
                          {bg.regenId === c.id ? <Ic.Spin s={12} /> : '\uD83D\uDD04'}
                        </Btn>
                      )}
                      <button className="sf-icon-btn" onClick={() => openEdit(c)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 4 }}><Ic.Edit /></button>
                      <button className="sf-icon-btn" onClick={() => deleteCourse(c.id)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 4 }}><Ic.Trash /></button>
                    </div>
                  </div>
                  {expanded[c.id] && (
                    <ErrorBoundary key={c.id + 'detail'}>
                      <CourseDetail c={c} onGenerate={(sectionIds) => regenSections(c, sectionIds)} />
                    </ErrorBoundary>
                  )}
                </div>
              );
              })}
            </div>
          )}

          {/* ─── CTA: Ready to plan? ─── */}
          {enrichDone && courses.length > 0 ? (
            <div className="slide-up" style={{ marginTop: 12, padding: '20px 24px', borderRadius: 14, background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1px solid ${T.accent}33`, textAlign: 'center' }}>
              <div style={{ fontSize: fs(12), color: T.accent, fontWeight: 700, marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {bg.loading && bg.regenId ? 'Updating...' : 'Enrichment Complete'}
              </div>
              <div style={{ fontSize: fs(13), color: T.soft, marginBottom: 16 }}>{activeCourses.length} course{activeCourses.length > 1 ? 's' : ''} ready {'\u2014'} your AI study plan is waiting</div>
              <Btn v="ai" onClick={() => setPage('planner')} style={{ width: '100%', justifyContent: 'center', padding: '14px 24px', fontSize: fs(15) }}>Go to Study Planner {'\u2192'}</Btn>
            </div>
          ) : enrichedCount > 0 && courses.length > 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: fs(11), color: T.orange, marginBottom: 8 }}>
                {enrichedCount}/{activeCourses.length} courses enriched {'\u2014'} your study plan will be less accurate for {activeCourses.length - enrichedCount} unenriched course{activeCourses.length - enrichedCount > 1 ? 's' : ''}
              </div>
              <Btn v="secondary" onClick={() => setPage('planner')} style={{ opacity: 0.7 }}>
                Continue Anyway {'\u2192'}
              </Btn>
            </div>
          ) : null}
        </div>
      )}

      {/* Import More — dropdown inline, rendered inside course list header below */}

      {/* Empty state — only shows if setup guide is somehow not visible */}
      {!step1Done && !courses.length && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: T.dim }}>
          <div style={{ fontSize: fs(15), marginBottom: 8 }}>No courses yet</div>
          <div style={{ fontSize: fs(12), marginBottom: 16 }}>Use the setup guide above to import courses.</div>
        </div>
      )}

      {/* Course Add/Edit Modal */}
      {showAdd && <Modal title={editId ? 'Edit Course' : 'Add Course'} onClose={() => setShowAdd(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><Label>Course Name</Label><input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. C779 - Web Development" /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            <div><Label>Code</Label><input value={form.courseCode} onChange={e => setForm({ ...form, courseCode: e.target.value })} placeholder="C779" /></div>
            <div><Label>Credits</Label><input type="number" min="1" max="12" value={form.credits} onChange={e => setForm({ ...form, credits: e.target.value })} /></div>
            <div><Label>Difficulty</Label><input type="number" min="1" max="5" value={form.difficulty} onChange={e => setForm({ ...form, difficulty: e.target.value })} /></div>
            <div><Label>Assessment</Label><select value={form.assessmentType} onChange={e => setForm({ ...form, assessmentType: e.target.value })}><option value="">{'—'}</option><option value="OA">OA (Objective)</option><option value="PA">PA (Performance)</option><option value="OA+PA">OA+PA</option><option value="Exam">Exam</option><option value="Project">Project</option><option value="Essay">Essay</option><option value="Lab">Lab</option><option value="Presentation">Presentation</option><option value="Mixed">Mixed</option></select></div>
          </div>
          <div><Label>Status</Label><div style={{ display: 'flex', gap: 4 }}>{['not_started', 'in_progress', 'completed'].map(s => <button key={s} onClick={() => setForm({ ...form, status: s })} style={{ flex: 1, padding: '8px 0', borderRadius: 8, cursor: 'pointer', fontSize: fs(11), fontWeight: 600, border: `1.5px solid ${form.status === s ? (STATUS_C[s] || T.dim) : T.border}`, background: form.status === s ? (STATUS_C[s] || T.dim) + '22' : T.input, color: form.status === s ? (STATUS_C[s] || T.dim) : T.dim }}>{STATUS_L[s]}</button>)}</div></div>
          <div><Label>Topics</Label><input value={form.topics || ''} onChange={e => setForm({ ...form, topics: e.target.value })} placeholder="HTML, CSS..." /></div>
          <div><Label>Notes</Label><input value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Tips..." /></div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}><Btn v="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn><Btn onClick={saveCourse} disabled={!form.name.trim()}>{editId ? 'Update' : 'Add'}</Btn></div>
        </div>
      </Modal>}

      {/* Course Completion Celebration */}
      <CelebrationModal show={!!celebration} onClose={() => setCelebration(null)} {...(celebration || {})} />
    </div>
  );
};

export { MyCoursesPage };
export default MyCoursesPage;
