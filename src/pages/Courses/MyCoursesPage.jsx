import { useState, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, uid, fileToBase64 } from '../../utils/helpers.js';
import { getSTATUS_C, STATUS_L } from '../../constants/categories.js';
import { EMPTY_DEEP, TOOLS, getProviderQuirks, isLikelyVisionCapable } from '../../constants/tools.js';
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

  // Timer state — Fix 2 + Fix 3
  const [enrichElapsed, setEnrichElapsed] = useState(0);
  const [batchElapsed, setBatchElapsed] = useState(0);
  const enrichTimesRef = useRef({});     // { courseId: elapsed seconds }
  const batchStartRef = useRef(null);
  const batchTimerRef = useRef(null);
  const prevRegenIdRef = useRef(null);

  // Import zone + post-import prompt
  const [importOpen, setImportOpen] = useState(() => (data.courses || []).length === 0);
  const [showEnrichPrompt, setShowEnrichPrompt] = useState(false);

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

  // Fix 3: Per-course timer — capture intervalId in closure for guaranteed cleanup
  useEffect(() => {
    if (bg.loading && bg.regenId) {
      // Save previous course's elapsed time
      if (prevRegenIdRef.current && prevRegenIdRef.current !== bg.regenId) {
        enrichTimesRef.current[prevRegenIdRef.current] = enrichElapsed;
      }
      prevRegenIdRef.current = bg.regenId;

      // Start batch timer on first course
      if (!batchStartRef.current) {
        batchStartRef.current = Date.now();
        enrichTimesRef.current = {};
        const batchId = setInterval(() => {
          setBatchElapsed(Math.floor((Date.now() - batchStartRef.current) / 1000));
        }, 1000);
        batchTimerRef.current = batchId;
      }

      // Per-course timer — intervalId captured in closure
      setEnrichElapsed(0);
      const start = Date.now();
      const intervalId = setInterval(() => {
        setEnrichElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
      return () => clearInterval(intervalId);
    } else {
      // Save final course's elapsed time
      if (prevRegenIdRef.current) {
        enrichTimesRef.current[prevRegenIdRef.current] = enrichElapsed;
        prevRegenIdRef.current = null;
      }
      setEnrichElapsed(0);

      // Stop batch timer
      if (batchStartRef.current) {
        clearInterval(batchTimerRef.current);
        batchStartRef.current = null;
      }
    }
  }, [bg.loading, bg.regenId]);

  // Fix 3: Detect enrichment completion → show "Complete" state for 5 seconds
  useEffect(() => {
    if (prevLoadingRef.current && !bg.loading && bg.logs.length > 0) {
      setEnrichDoneAt(Date.now());
      const timeout = setTimeout(() => setEnrichDoneAt(null), 5000);
      return () => clearTimeout(timeout);
    }
    prevLoadingRef.current = bg.loading;
  }, [bg.loading]);

  // Course CRUD
  const openAdd = () => { setForm({ name: '', credits: 3, difficulty: 3, status: 'not_started', topics: '', notes: '', assessmentType: '', courseCode: '' }); setEditId(null); setShowAdd(true); };
  const openEdit = c => { setForm({ name: c.name, credits: c.credits, difficulty: c.difficulty, status: c.status, topics: c.topics || '', notes: c.notes || '', assessmentType: c.assessmentType || '', courseCode: c.courseCode || '' }); setEditId(c.id); setShowAdd(true); };
  const saveCourse = () => {
    if (!form.name.trim()) return;
    if (editId) {
      setData(d => ({ ...d, courses: d.courses.map(c => c.id === editId ? { ...c, ...form, credits: Number(form.credits), difficulty: Number(form.difficulty), lastUpdated: new Date().toISOString() } : c) }));
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
        setImportOpen(false);
        setShowEnrichPrompt(true);
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
    if (!profile) return;
    bgSet({ loading: true, regenId: course.id, logs: [{ type: 'user', content: `\uD83D\uDD04 Enriching: ${course.name}` }], label: `Enriching ${course.name}...` });
    dlog('info', 'api', `Regen: ${course.name}`);
    const sys = buildSystemPrompt(data, `Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
    const { logs } = await runAILoop(profile, sys, [{ role: 'user', content: `Tell me everything I truly need to know to pass ${course.name}. Fill in all context.` }], data, setData, executeTools);
    for (const l of logs) bgLog(l);
    bgSet({ loading: false, regenId: null, label: '' });
  };

  // Selective section regeneration — only specific sections
  const regenSections = async (course, sectionIds) => {
    if (!profile || !sectionIds.length) return;
    const sectionLabels = sectionIds.map(id => SECTIONS.find(s => s.id === id)?.label).filter(Boolean);
    const fieldsList = sectionIds.flatMap(id => SECTION_FIELDS[id] || []);
    bgSet({ loading: true, regenId: course.id, logs: [{ type: 'user', content: `\u2728 Generating ${sectionLabels.join(', ')} for ${course.name}` }], label: `Generating sections for ${course.name}...` });
    dlog('info', 'api', `Selective regen: ${course.name} — sections: ${sectionIds.join(', ')}`);

    const existingContext = [];
    if (safeArr(course.topicBreakdown).length > 0) existingContext.push(`${safeArr(course.topicBreakdown).length} topics: ${safeArr(course.topicBreakdown).map(t => t.topic).join(', ')}`);
    if (safeArr(course.examTips).length > 0) existingContext.push(`${safeArr(course.examTips).length} exam tips`);
    if (course.assessmentType) existingContext.push(`Assessment: ${course.assessmentType}`);

    const sys = buildSystemPrompt(data, `Generate ONLY the following sections for "${course.name}" using enrich_course_context: ${sectionLabels.join(', ')}.\n\nDo NOT include other fields — they already exist.\n${existingContext.length > 0 ? `\nExisting context: ${existingContext.join('; ')}` : ''}`);
    const { logs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate the following missing data for ${course.name}: ${sectionLabels.join(', ')}. Only fill in these specific fields: ${fieldsList.join(', ')}.` }], data, setData, executeTools);
    for (const l of logs) bgLog(l);
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const regenAll = async () => {
    if (!profile) return;
    const active = courses.filter(c => c.status !== 'completed');
    if (!active.length) return;
    bgSet({ loading: true, logs: [{ type: 'user', content: `\uD83D\uDD04 Regenerating ${active.length} courses individually` }], label: `Regenerating 1/${active.length}...` });
    dlog('info', 'api', `Regen all (sequential): ${active.length} courses`);
    let completed = 0;
    for (const course of active) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({ type: 'error', content: `Stopped after ${completed}/${active.length}` }); break; }
      completed++;
      bgSet({ label: `Regenerating ${completed}/${active.length}: ${course.name}...`, regenId: course.id });
      bgLog({ type: 'user', content: `\uD83D\uDD04 ${completed}/${active.length}: ${course.name}` });
      const sys = buildSystemPrompt(data, `Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
      const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Tell me everything I truly need to know to pass ${course.name}. Fill in all context \u2014 competencies, topics with weights, exam tips, key terms, focus areas, resources, common mistakes.` }], data, setData, executeTools);
      for (const l of cLogs) bgLog(l);
    }
    toast(`Regeneration complete: ${completed}/${active.length}`, 'success');
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const enrichNew = async () => {
    if (!profile) return;
    const toEnrich = courses.filter(c => c.status !== 'completed' && !hasCtx(c));
    if (!toEnrich.length) { toast('All courses already enriched!', 'info'); return; }

    setShowEnrichPrompt(false);
    bgSet({ loading: true, regenId: null, logs: [{ type: 'user', content: `\u2728 Enriching ${toEnrich.length} course${toEnrich.length > 1 ? 's' : ''} individually` }], label: `Enriching 1/${toEnrich.length}...` });
    dlog('info', 'api', `Enrich new (sequential): ${toEnrich.length} courses`);

    let completed = 0;
    for (const course of toEnrich) {
      if (getBgState().abortCtrl?.signal?.aborted) {
        bgLog({ type: 'error', content: `Stopped after ${completed}/${toEnrich.length} courses` });
        break;
      }
      completed++;
      bgSet({ label: `Enriching ${completed}/${toEnrich.length}: ${course.name}...`, regenId: course.id });
      bgLog({ type: 'user', content: `\uD83D\uDD04 ${completed}/${toEnrich.length}: ${course.name}` });

      const sys = buildSystemPrompt(data, `Generate deep context for "${course.name}" (${course.courseCode || 'no code'}) using enrich_course_context. Include ALL fields: competencies with codes, topicBreakdown with percentage weights, examTips, keyTerms, focusAreas, resources, commonMistakes, assessmentType details, averageStudyHours (realistic total hours to pass), and difficulty (1-5). Be thorough \u2014 this is the ONLY call for this course.`);
      const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate comprehensive study context for ${course.name}${course.courseCode ? ` (${course.courseCode})` : ''}.${course.credits ? ` ${course.credits} CU.` : ''} Include everything a student needs to pass: assessment format, all competencies, topic breakdown with weights, exam tips, key terms, focus areas, resources, common mistakes, and estimated total study hours (averageStudyHours).` }], data, setData, executeTools);

      for (const l of cLogs) bgLog(l);
      dlog('info', 'api', `Enriched ${completed}/${toEnrich.length}: ${course.name}`);
    }

    toast(`Enrichment complete: ${completed}/${toEnrich.length} courses processed`, 'success');
    bgSet({ loading: false, regenId: null, label: '' });
  };

  // Fill All Gaps — selective regen for all courses with missing sections
  const fillAllGaps = async () => {
    if (!profile) return;
    const coursesWithGaps = activeCourses.filter(c => hasCtx(c) && missingSections(c).length > 0);
    if (!coursesWithGaps.length) { toast('All sections populated!', 'info'); return; }

    bgSet({ loading: true, logs: [{ type: 'user', content: `\u2728 Filling gaps in ${coursesWithGaps.length} course${coursesWithGaps.length > 1 ? 's' : ''}` }], label: `Filling gaps 1/${coursesWithGaps.length}...` });
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

      const sys = buildSystemPrompt(data, `Generate ONLY the following sections for "${course.name}" using enrich_course_context: ${sectionLabels.join(', ')}.\n\nDo NOT include other fields — they already exist.\n${existingContext.length > 0 ? `\nExisting context: ${existingContext.join('; ')}` : ''}`);
      const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate the following missing data for ${course.name}: ${sectionLabels.join(', ')}. Only fill in these specific fields: ${fieldsList.join(', ')}.` }], data, setData, executeTools);
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
        <Btn v="secondary" onClick={openAdd}><Ic.Plus s={12} /> Add Course</Btn>
      </div>

      {/* ─── IMPORT ZONE (collapsible) ─── */}
      <div style={{ marginBottom: 16 }}>
        <button onClick={() => setImportOpen(!importOpen)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: importOpen ? '10px 10px 0 0' : 10,
            border: `1px solid ${T.border}`, background: T.panel,
            cursor: 'pointer', color: T.text, fontSize: fs(13), fontWeight: 600,
            transition: 'border-radius .15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: fs(14) }}>{'\uD83D\uDCC2'}</span>
            <span>Import Courses</span>
            {step1Done && <Badge color={T.accent} bg={T.accentD}>{'\u2713'} {courses.length} imported</Badge>}
          </div>
          <span style={{ fontSize: fs(11), color: T.dim, transition: 'transform .2s', transform: importOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>{'\u25BC'}</span>
        </button>
        {importOpen && (
          <div style={{ padding: '14px 16px', border: `1px solid ${T.border}`, borderTop: 'none', borderRadius: '0 0 10px 10px', background: T.panel }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <button className="sf-import-btn sf-import-accent" onClick={() => { fileRef.current.accept = 'image/*'; fileRef.current.click(); }} disabled={bg.loading} style={{ padding: '16px', borderRadius: 10, border: `1.5px solid ${T.accent}44`, background: T.accentD, cursor: bg.loading ? 'wait' : 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: fs(13), fontWeight: 700, color: T.accent, marginBottom: 3 }}>Screenshot / Image</div>
                <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.4 }}>Upload a screenshot of your degree plan page</div>
              </button>
              <button className="sf-import-btn sf-import-blue" onClick={() => { fileRef.current.accept = '.pdf,.doc,.docx,.txt,.csv,image/*'; fileRef.current.click(); }} disabled={bg.loading} style={{ padding: '16px', borderRadius: 10, border: `1.5px solid ${T.blue}44`, background: T.blueD, cursor: bg.loading ? 'wait' : 'pointer', textAlign: 'left' }}>
                <div style={{ fontSize: fs(13), fontWeight: 700, color: T.blue, marginBottom: 3 }}>Document / PDF</div>
                <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.4 }}>Upload PDF, DOCX, or text file of your degree plan</div>
              </button>
            </div>
            {!profile && <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange }}>Connect an AI profile in Settings first {'\u2014'} parsing requires a vision-capable model.</div>}
            {profile && !isLikelyVisionCapable(profile) && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange }}>
                {profile.name}{profile.model ? ` (${profile.model})` : ''} may not support image parsing. For best results, switch to a vision-capable model such as Claude Sonnet/Opus, GPT-4o, or Gemini Pro.
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: fs(10), color: T.dim, lineHeight: 1.5 }}>Image and document parsing requires a vision-capable AI model such as Claude Sonnet/Opus, GPT-4o, or Gemini Pro.</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />
            {imgPreview && <div style={{ marginTop: 12, padding: 12, background: T.bg2, borderRadius: 10, border: `1px solid ${T.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: fs(12), fontWeight: 700 }}>Degree Plan Image</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Btn small v="ghost" onClick={() => { setImgFile(null); setImgPreview(null); }}>Remove</Btn>
                  <Btn small v="ai" onClick={parseImage} disabled={bg.loading}>
                    {bg.loading ? <><Ic.Spin s={14} /> Parsing...</> : <><Ic.AI s={14} /> Extract Courses</>}
                  </Btn>
                </div>
              </div>
              <img src={imgPreview} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, border: `1px solid ${T.border}` }} alt="plan" />
            </div>}
          </div>
        )}
      </div>

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
              {!bg.loading && bg.logs.length > 0 && <Btn small v="ghost" onClick={() => { bgSet({ logs: [] }); enrichTimesRef.current = {}; setBatchElapsed(0); setEnrichDoneAt(null); }}>Clear</Btn>}
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

      {/* ─── SCHOOL PROFILE NUDGE ─── */}
      {!data.universityProfile?.name && unenriched.length > 0 && !enrichDone && step1Done && (
        <div style={{ padding: '12px 16px', borderRadius: 10, background: `linear-gradient(135deg, ${T.purpleD}, ${T.blueD})`, border: `1px solid ${T.purple}33`, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: fs(12), fontWeight: 700, color: T.text, marginBottom: 4 }}>Set your school for better enrichment</div>
              <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.5 }}>Enrichment uses your school's grading system, assessment model, and community resources to generate more accurate study context.</div>
            </div>
            <Btn small v="ghost" onClick={() => setPage('settings')} style={{ flexShrink: 0 }}>Full Setup {'\u2192'}</Btn>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {UNIVERSITY_PRESETS.filter(p => p.presetId !== 'self-study').map(p => (
              <button key={p.presetId} onClick={() => { setData(d => ({ ...d, universityProfile: { ...p } })); toast(`School set: ${p.shortName}`, 'success'); }}
                style={{ padding: '6px 14px', borderRadius: 8, border: `1px solid ${T.accent}44`, background: T.accentD, cursor: 'pointer', fontSize: fs(10), fontWeight: 600, color: T.accent, transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = T.accent; e.currentTarget.style.background = T.accent + '28'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = T.accent + '44'; e.currentTarget.style.background = T.accentD; }}
              >{p.shortName}</button>
            ))}
            <button onClick={() => setPage('settings')}
              style={{ padding: '6px 14px', borderRadius: 8, border: `1px dashed ${T.border}`, background: 'transparent', cursor: 'pointer', fontSize: fs(10), fontWeight: 600, color: T.dim }}
            >Other School...</button>
          </div>
        </div>
      )}

      {/* ─── POST-IMPORT ENRICHMENT PROMPT ─── */}
      {showEnrichPrompt && unenriched.length > 0 && !bg.loading && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 16,
          background: `linear-gradient(135deg, ${T.purpleD}, ${T.accentD})`,
          border: `1px solid ${T.purple}44`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: fs(16) }}>{'\u2728'}</span>
            <span style={{ fontSize: fs(12), color: T.text, fontWeight: 600 }}>{unenriched.length} course{unenriched.length > 1 ? 's' : ''} need AI enrichment for study context</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn small v="ghost" onClick={() => setShowEnrichPrompt(false)}>Later</Btn>
            <Btn small v="ai" onClick={enrichNew} disabled={!profile}>Enrich All Now</Btn>
          </div>
        </div>
      )}

      {/* ─── COURSE LIST ─── */}
      {step1Done && (
        <div>
          {/* Row 1: Title + primary enrichment action */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h3 style={{ fontSize: fs(14), fontWeight: 700, margin: 0 }}>Courses ({courses.length})</h3>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {unenriched.length > 0 && !bg.loading && (
                <Btn small v="ai" onClick={enrichNew} disabled={bg.loading || !profile}>
                  Enrich All New ({unenriched.length})
                </Btn>
              )}
              {coursesWithGaps.length > 0 && unenriched.length === 0 && !bg.loading && (
                <Btn small v="ai" onClick={fillAllGaps} disabled={bg.loading || !profile}>
                  Fill All Gaps ({coursesWithGaps.length})
                </Btn>
              )}
              {enrichDone && !bg.loading && (
                <Badge color={T.accent} bg={T.accentD}>{'\u2713'} All Enriched</Badge>
              )}
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

      {/* Empty state */}
      {!step1Done && !importOpen && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: T.dim }}>
          <div style={{ fontSize: fs(15), marginBottom: 8 }}>No courses yet</div>
          <div style={{ fontSize: fs(12), marginBottom: 16 }}>Import a degree plan or add courses manually to get started.</div>
          <Btn v="secondary" onClick={() => setImportOpen(true)}>Open Import</Btn>
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
    </div>
  );
};

export { MyCoursesPage };
export default MyCoursesPage;
