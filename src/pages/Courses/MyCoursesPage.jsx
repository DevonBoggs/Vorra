import { useState, useCallback, useRef, useEffect } from 'react';
import { useTheme, fs } from '../../styles/tokens.js';
import Ic from '../../components/icons/index.jsx';
import { todayStr, uid, fileToBase64 } from '../../utils/helpers.js';
import { getSTATUS_C, STATUS_L } from '../../constants/categories.js';
import { EMPTY_DEEP, TOOLS, getProviderQuirks } from '../../constants/tools.js';
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
import { hasCtx } from '../../utils/courseHelpers.js';

const MyCoursesPage = ({ data, setData, profile, setPage, setDate }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const _bgState = getBgState();
  const bp = useBreakpoint();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', credits: 3, difficulty: 3, status: 'not_started', topics: '', notes: '', assessmentType: '', courseCode: '' });
  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [manualStepOpen, setManualStepOpen] = useState({});
  const fileRef = useRef(null);
  const [enrichElapsed, setEnrichElapsed] = useState(0);
  const enrichTimerRef = useRef(null);

  // Global background task state — survives page navigation
  const bg = useBgTask();

  const courses = data.courses || [];
  const totalCU = courses.reduce((s, c) => s + (c.credits || 0), 0);
  const doneCU = courses.filter(c => c.status === 'completed').reduce((s, c) => s + (c.credits || 0), 0);
  const activeCourses = courses.filter(c => c.status !== 'completed');

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

  // Step completion tracking
  const step1Done = courses.length > 0;
  const enrichDone = activeCourses.length > 0 && activeCourses.every(c => hasCtx(c));
  const enrichedCount = activeCourses.filter(c => hasCtx(c)).length;

  // Step open/close
  const isStepOpen = (n) => {
    if (manualStepOpen[n] !== undefined) return manualStepOpen[n];
    return n === 1 ? !step1Done : !enrichDone;
  };
  const toggleStep = (n) => setManualStepOpen(p => ({ ...p, [n]: !isStepOpen(n) }));

  // Per-course elapsed time during enrichment
  useEffect(() => {
    if (bg.loading && bg.regenId) {
      setEnrichElapsed(0);
      const start = Date.now();
      enrichTimerRef.current = setInterval(() => {
        setEnrichElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
      return () => clearInterval(enrichTimerRef.current);
    } else {
      clearInterval(enrichTimerRef.current);
    }
  }, [bg.loading, bg.regenId]);

  const StepHead = ({ n, title, done, disabled, subtitle, children }) => (
    <div style={{ background: T.card, border: `1px solid ${done ? T.accent + '33' : T.border}`, borderRadius: 12, marginBottom: 16, overflow: 'hidden', opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto', transition: 'opacity .2s' }}>
      <button onClick={() => toggleStep(n)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', background: 'none', border: 'none', cursor: disabled ? 'default' : 'pointer', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: done ? T.accent : T.input, border: `2px solid ${done ? T.accent : T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(11), fontWeight: 800, color: done ? '#fff' : T.dim, flexShrink: 0 }}>
            {done ? '\u2713' : n}
          </div>
          <div>
            <div style={{ fontSize: fs(14), fontWeight: 700, color: disabled ? T.dim : done ? T.soft : T.text }}>{title}</div>
            {subtitle && !isStepOpen(n) && <div style={{ fontSize: fs(10), color: T.dim, marginTop: 1 }}>{subtitle}</div>}
            {disabled && <div style={{ fontSize: fs(10), color: T.dim, marginTop: 1 }}>Complete previous steps first</div>}
          </div>
        </div>
        {!disabled && <span style={{ fontSize: fs(10), color: T.dim, transition: 'transform .2s', transform: isStepOpen(n) ? 'rotate(180deg)' : 'rotate(0)' }}>{isStepOpen(n) ? '\u25B2' : '\u25BC'}</span>}
      </button>
      {isStepOpen(n) && !disabled && <div style={{ padding: '0 18px 16px' }}>{children}</div>}
    </div>
  );

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
    bgSet({ loading: true, logs: [{ type: 'user', content: `\ud83d\udcf7 Parsing: ${imgFile.name}` }], label: 'Parsing degree plan...' });
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
        toast(`${totalCourses} courses imported! Next: click 'Enrich All' to generate study context.`, 'success');
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

  // AI enrichment
  const regenCourse = async (course) => {
    if (!profile) return;
    bgSet({ loading: true, regenId: course.id, logs: [{ type: 'user', content: `\ud83d\udd04 Enriching: ${course.name}` }], label: `Enriching ${course.name}...` });
    dlog('info', 'api', `Regen: ${course.name}`);
    const sys = buildSystemPrompt(data, `Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
    const { logs } = await runAILoop(profile, sys, [{ role: 'user', content: `Tell me everything I truly need to know to pass ${course.name}. Fill in all context.` }], data, setData, executeTools);
    for (const l of logs) bgLog(l);
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const regenAll = async () => {
    if (!profile) return;
    const active = courses.filter(c => c.status !== 'completed');
    if (!active.length) return;
    bgSet({ loading: true, logs: [{ type: 'user', content: `\ud83d\udd04 Regenerating ${active.length} courses individually` }], label: `Regenerating 1/${active.length}...` });
    dlog('info', 'api', `Regen all (sequential): ${active.length} courses`);
    let completed = 0;
    for (const course of active) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({ type: 'error', content: `Stopped after ${completed}/${active.length}` }); break; }
      completed++;
      bgSet({ label: `Regenerating ${completed}/${active.length}: ${course.name}...`, regenId: course.id });
      bgLog({ type: 'user', content: `\ud83d\udd04 ${completed}/${active.length}: ${course.name}` });
      const sys = buildSystemPrompt(data, `Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
      const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Tell me everything I truly need to know to pass ${course.name}. Fill in all context \u2014 competencies, topics with weights, exam tips, key terms, focus areas, resources, common mistakes.` }], data, setData, executeTools);
      for (const l of cLogs) bgLog(l);
    }
    toast(`Regeneration complete: ${completed}/${active.length}`, 'success');
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const enrichNew = async () => {
    if (!profile) return;
    const unenriched = courses.filter(c => c.status !== 'completed' && !hasCtx(c));
    if (!unenriched.length) { toast('All courses already enriched!', 'info'); return; }

    bgSet({ loading: true, regenId: null, logs: [{ type: 'user', content: `\u2728 Enriching ${unenriched.length} course${unenriched.length > 1 ? 's' : ''} individually` }], label: `Enriching 1/${unenriched.length}...` });
    dlog('info', 'api', `Enrich new (sequential): ${unenriched.length} courses`);

    let completed = 0;
    for (const course of unenriched) {
      if (getBgState().abortCtrl?.signal?.aborted) {
        bgLog({ type: 'error', content: `Stopped after ${completed}/${unenriched.length} courses` });
        break;
      }
      completed++;
      bgSet({ label: `Enriching ${completed}/${unenriched.length}: ${course.name}...`, regenId: course.id });
      bgLog({ type: 'user', content: `\ud83d\udd04 ${completed}/${unenriched.length}: ${course.name}` });

      const sys = buildSystemPrompt(data, `Generate deep context for "${course.name}" (${course.courseCode || 'no code'}) using enrich_course_context. Include ALL fields: competencies with codes, topicBreakdown with percentage weights, examTips, keyTerms, focusAreas, resources, commonMistakes, assessmentType details, averageStudyHours (realistic total hours to pass), and difficulty (1-5). Be thorough \u2014 this is the ONLY call for this course.`);
      const { logs: cLogs } = await runAILoop(profile, sys, [{ role: 'user', content: `Generate comprehensive study context for ${course.name}${course.courseCode ? ` (${course.courseCode})` : ''}.${course.credits ? ` ${course.credits} CU.` : ''} Include everything a student needs to pass: assessment format, all competencies, topic breakdown with weights, exam tips, key terms, focus areas, resources, common mistakes, and estimated total study hours (averageStudyHours).` }], data, setData, executeTools);

      for (const l of cLogs) bgLog(l);
      dlog('info', 'api', `Enriched ${completed}/${unenriched.length}: ${course.name}`);
    }

    toast(`Enrichment complete: ${completed}/${unenriched.length} courses processed`, 'success');
    bgSet({ loading: false, regenId: null, label: '' });
  };

  const AIActivity = () => (bg.loading || bg.logs.length > 0) ? (
    <div style={{ background: T.panel, border: `1px solid ${T.purple}33`, borderRadius: 10, padding: 14, marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: bg.streamText || bg.logs.length > 0 ? 8 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {bg.loading && <Ic.Spin s={14} />}
          <span style={{ fontSize: fs(12), fontWeight: 700, color: bg.loading ? T.purple : T.soft }}>{bg.loading ? (bg.label || 'AI working...') : 'AI Activity'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {bg.loading && getBgState().abortCtrl && <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, label: '' }); toast('Cancelled', 'info'); }}>Cancel</Btn>}
          {!bg.loading && bg.logs.length > 0 && <Btn small v="ghost" onClick={() => bgSet({ logs: [] })}>Clear</Btn>}
        </div>
      </div>
      {bg.streamText && <div style={{ padding: '6px 10px', borderRadius: 7, background: T.purpleD, border: `1px solid ${T.purple}33`, fontSize: fs(11), color: T.purple, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'auto', marginBottom: 4 }}>{bg.streamText}</div>}
      {bg.logs.length > 0 && <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>{bg.logs.map((l, i) => <LogLine key={i} l={l} />)}</div>}
    </div>
  ) : null;

  return (
    <div className="fade">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="sf-nav" onClick={() => setPage('dashboard')} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: T.soft, fontSize: fs(12), fontWeight: 600 }}>{'\u2190'} Dashboard</button>
          <div><h1 style={{ fontSize: fs(24), fontWeight: 800, marginBottom: 2 }}>My Courses</h1><p style={{ color: T.dim, fontSize: fs(13) }}>{courses.length} courses {'\u00B7'} {doneCU}/{totalCU} CU</p></div>
        </div>
      </div>

      {/* STEP 1: Import Courses */}
      <StepHead n={1} title="Import Courses" done={step1Done} subtitle={step1Done ? `${courses.length} courses imported` : ''}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <Btn small v="secondary" onClick={openAdd}><Ic.Plus s={12} /> Add Manually</Btn>
        </div>
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
        <div style={{ marginTop: 10, fontSize: fs(10), color: T.dim, lineHeight: 1.5 }}>Image and document parsing requires a vision-capable AI model such as Claude Sonnet/Opus, GPT-4o, or Gemini Pro.</div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleImg} />
        {imgPreview && <div style={{ marginTop: 12, padding: 12, background: T.panel, borderRadius: 10, border: `1px solid ${T.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: fs(12), fontWeight: 700 }}>Degree Plan Image</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn small v="ghost" onClick={() => { setImgFile(null); setImgPreview(null); }}>Remove</Btn>
              <Btn small v="ai" onClick={parseImage} disabled={bg.loading}>{bg.loading ? <><Ic.Spin s={14} /> Parsing...</> : <><Ic.AI s={14} /> Extract Courses</>}</Btn>
            </div>
          </div>
          <img src={imgPreview} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 10, border: `1px solid ${T.border}` }} alt="plan" />
        </div>}
        <AIActivity />
      </StepHead>

      {/* STEP 3: Enrich Courses */}
      {(() => {
        const unenriched = courses.filter(c => c.status !== 'completed' && !hasCtx(c));
        const isEnriching = bg.loading && (bg.label || '').toLowerCase().includes('enrich');
        return (
          <StepHead n={2} title="Enrich Courses" done={enrichDone} disabled={!step1Done} subtitle={enrichDone ? `All ${activeCourses.length} courses enriched` : unenriched.length > 0 ? `${enrichedCount}/${activeCourses.length} courses enriched` : ''}>
            {!profile && <div style={{ padding: '8px 12px', borderRadius: 8, background: T.orangeD, border: `1px solid ${T.orange}33`, fontSize: fs(11), color: T.orange, marginBottom: 10 }}>Connect an AI profile in Settings first.</div>}
            {profile && getProviderQuirks(profile).noToolSupport && (
              <div style={{ padding: '8px 12px', borderRadius: 8, background: T.redD, border: `1px solid ${T.red}33`, fontSize: fs(11), color: T.red, marginBottom: 10 }}>
                {profile.name} does not support tool calling. Enrichment requires a provider with function calling support (e.g., OpenAI, Anthropic, DeepSeek, Groq).
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: fs(11), color: T.soft }}>{enrichDone ? 'All courses have exam intelligence' : unenriched.length > 0 ? 'Processing time depends on your AI provider and the number of courses. This may take several minutes \u2014 the app will continue working in the background.' : 'Sequential individual enrichment for reliable, thorough results'}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {isEnriching && getBgState().abortCtrl && (
                  <Btn small v="ghost" onClick={() => { getBgState().abortCtrl?.abort(); bgSet({ loading: false, regenId: null, label: '' }); toast('Enrichment stopped', 'info'); }} style={{ color: T.red, borderColor: T.red }}>Stop</Btn>
                )}
                <Btn v={enrichDone ? 'secondary' : 'ai'} onClick={enrichNew} disabled={bg.loading || !profile || unenriched.length === 0}>
                  {isEnriching ? <><Ic.Spin s={14} /> Working...</> : enrichDone ? 'All Enriched \u2713' : 'Enrich All New'}
                </Btn>
              </div>
            </div>

            {/* Progress bar during enrichment */}
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

            {/* Currently processing label */}
            {isEnriching && bg.label && (
              <div style={{ fontSize: fs(11), color: T.purple, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                <Ic.Spin s={11} />
                <span>{bg.label}</span>
                <span style={{ color: T.dim, fontFamily: "'JetBrains Mono',monospace", fontSize: fs(10) }}>
                  ({Math.floor(enrichElapsed / 60)}:{String(enrichElapsed % 60).padStart(2, '0')})
                </span>
              </div>
            )}

            {(isEnriching || unenriched.length > 0) && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {courses.filter(c => c.status !== 'completed').map(c => {
                  const enriched = hasCtx(c);
                  const active = bg.regenId === c.id;
                  return (
                    <span key={c.id} style={{ fontSize: fs(9), padding: '3px 8px', borderRadius: 5, fontWeight: 600,
                      background: active ? T.purpleD : enriched ? T.accentD : T.input,
                      color: active ? T.purple : enriched ? T.accent : T.dim,
                      border: isEnriching && !enriched && !active ? `1px dashed ${T.border}` : '1px solid transparent',
                    }}>{active ? '\u23F3 ' : ''}{c.courseCode || c.name.slice(0, 15)}{enriched ? ' \u2713' : ''}</span>
                  );
                })}
              </div>
            )}
            <AIActivity />
          </StepHead>
        );
      })()}

      {/* Course List */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontSize: fs(14), fontWeight: 700 }}>Courses ({courses.length})</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {enrichedCount > 0 && <Btn small v="ai" onClick={regenAll} disabled={bg.loading || !profile || activeCourses.length === 0}>Regenerate{enrichedCount < activeCourses.length ? ` (${enrichedCount})` : ' All'}</Btn>}
          <Btn small v="ghost" onClick={() => setExpanded(courses.reduce((a, c) => ({ ...a, [c.id]: true }), {}))}>Expand</Btn>
          <Btn small v="ghost" onClick={() => setExpanded({})}>Collapse</Btn>
        </div>
      </div>

      {courses.length === 0 ? <div style={{ padding: '30px 0', textAlign: 'center', color: T.dim, fontSize: fs(13) }}>No courses yet. Import a degree plan or add manually.</div> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 16 }}>
          {courses.map((c, i) => (
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
                    {hasCtx(c) ? <Badge color={T.accent} bg={T.accentD}>ENRICHED</Badge> : c.status !== 'completed' && <Badge color={T.orange} bg={T.orangeD}>NEEDS ENRICHMENT</Badge>}
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
                  <Btn small v={bg.regenId === c.id ? 'ai' : 'ghost'} onClick={() => regenCourse(c)} disabled={!profile || bg.regenId === c.id || bg.loading}>{bg.regenId === c.id ? <Ic.Spin s={12} /> : bg.loading ? '\u2014' : '\ud83d\udd04'}</Btn>
                  <button className="sf-icon-btn" onClick={() => openEdit(c)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 4 }}><Ic.Edit /></button>
                  <button className="sf-icon-btn" onClick={() => deleteCourse(c.id)} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer', padding: 4 }}><Ic.Trash /></button>
                </div>
              </div>
              {expanded[c.id] && <ErrorBoundary key={c.id + 'detail'}><CourseDetail c={c} /></ErrorBoundary>}
            </div>
          ))}
        </div>
      )}

      {/* CTA: Ready to plan? */}
      {enrichDone && courses.length > 0 ? (
        <div className="slide-up" style={{ margin: '8px 0 16px', padding: '20px 24px', borderRadius: 14, background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1px solid ${T.accent}33`, textAlign: 'center' }}>
          <div style={{ fontSize: fs(12), color: T.accent, fontWeight: 700, marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Enrichment Complete</div>
          <div style={{ fontSize: fs(13), color: T.soft, marginBottom: 16 }}>{activeCourses.length} course{activeCourses.length > 1 ? 's' : ''} ready {'\u2014'} your AI study plan is waiting</div>
          <Btn v="ai" onClick={() => setPage('planner')} style={{ width: '100%', justifyContent: 'center', padding: '14px 24px', fontSize: fs(15) }}>Go to Study Planner {'\u2192'}</Btn>
        </div>
      ) : enrichedCount > 0 && courses.length > 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', marginBottom: 16 }}>
          <div style={{ fontSize: fs(11), color: T.orange, marginBottom: 8 }}>
            {enrichedCount}/{activeCourses.length} courses enriched {'\u2014'} your study plan will be less accurate for {activeCourses.length - enrichedCount} unenriched course{activeCourses.length - enrichedCount > 1 ? 's' : ''}
          </div>
          <Btn v="secondary" onClick={() => setPage('planner')} style={{ opacity: 0.7 }}>
            Continue Anyway {'\u2192'}
          </Btn>
        </div>
      ) : null}

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
