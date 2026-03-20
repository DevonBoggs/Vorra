import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, pad, uid, fmtDateLong, diffDays, minsToStr, fileToBase64, parseTime } from "../../utils/helpers.js";
import { getCAT, getSTATUS_C, STATUS_L, AI_CATS } from "../../constants/categories.js";
import { EMPTY_DEEP, TOOLS } from "../../constants/tools.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { buildSystemPrompt, runAILoop, setApiStatus, isAnthProvider, getAuthHeaders, APP_VERSION } from "../../systems/api.js";
import { useBgTask, bgSet, bgClear, bgAbort, bgLog, bgStream, bgNewAbort, getBgState } from "../../systems/background.js";
import { executeTools, safeArr, deepMergeCourse, findCourse } from "../../utils/toolExecution.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { Label } from "../../components/ui/Label.jsx";
import { BufferedInput } from "../../components/ui/BufferedInput.jsx";
import { ProgressBar } from "../../components/ui/ProgressBar.jsx";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary.jsx";

// These sub-components are defined in App.jsx — they must be passed as props or extracted separately.
// For now, we import them from a shared location that App.jsx re-exports.
// TODO: Extract Btn, LogLine, CtxBadge, CourseDetail into their own files.

const CoursePlanner = ({ data, setData, profile, setPage, Btn, LogLine, CtxBadge, CourseDetail }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C();
  const _bgState = getBgState();
  const bp = useBreakpoint();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name:"",credits:3,difficulty:3,status:"not_started",topics:"",notes:"",assessmentType:"",courseCode:"" });
  const [imgFile, setImgFile] = useState(null);
  const [imgPreview, setImgPreview] = useState(null);
  const [showParseOpts, setShowParseOpts] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [pendingPlan, setPendingPlan] = useState(null); // plan preview: tasks array + summary string
  const [planPrompt, setPlanPrompt] = useState("");
  const [manualStepOpen, setManualStepOpen] = useState({});
  const fileRef = useRef(null);

  // Global background task state — survives page navigation
  const bg = useBgTask();

  const courses = data.courses || [];
  const totalCU = courses.reduce((s,c) => s + (c.credits||0), 0);
  const doneCU = courses.filter(c => c.status === "completed").reduce((s,c) => s + (c.credits||0), 0);
  const remainCU = totalCU - doneCU;
  const daysLeft = data.targetDate ? Math.max(0, diffDays(todayStr(), data.targetDate)) : null;
  const [newExDate, setNewExDate] = useState("");

  //  Planning Intelligence
  const activeCourses = courses.filter(c => c.status !== "completed");
  const totalEstHours = activeCourses.reduce((s, c) => {
    if (c.averageStudyHours > 0) return s + c.averageStudyHours;
    // Estimate from difficulty: diff 1=20h, 2=35h, 3=50h, 4=70h, 5=100h per CU-adjusted
    const base = [0, 20, 35, 50, 70, 100][c.difficulty || 3] || 50;
    return s + base;
  }, 0);

  const hrsPerDay = data.studyHoursPerDay || 4;
  const exceptionDates = safeArr(data.exceptionDates);
  const startDate = data.studyStartDate || todayStr();
  const startTime = data.studyStartTime || "08:00";
  const earlyFinishWeeks = 0; // legacy compat

  // Two-date system: goalDate = target completion, targetDate = term end
  const goalDate = data.targetCompletionDate || data.targetDate || null;
  const effectiveTarget = goalDate;
  const effectiveDaysLeft = effectiveTarget ? Math.max(0, diffDays(todayStr(), effectiveTarget)) : null;

  // Hours available on first day (from start time to ~10 PM)
  const startTimeParts = startTime.split(":").map(Number);
  const firstDayHours = Math.max(0, Math.min(hrsPerDay, 22 - (startTimeParts[0]||8) - (startTimeParts[1]||0)/60));

  // Calculate available study days (excluding exception dates)
  const calcStudyDays = (fromDate, toDate) => {
    if (!fromDate || !toDate) return 0;
    let count = 0;
    const d = new Date(fromDate + "T12:00:00");
    const end = new Date(toDate + "T12:00:00");
    let safety = 0;
    while (d <= end && safety < 1000) {
      const ds = d.toISOString().split("T")[0];
      if (!exceptionDates.includes(ds)) count++;
      d.setDate(d.getDate() + 1);
      safety++;
    }
    return count;
  };

  // Adjust total hours: first day is partial if start time is set
  const adjustedHours = firstDayHours < hrsPerDay ? totalEstHours - firstDayHours + hrsPerDay : totalEstHours;
  const rawDaysNeeded = Math.ceil(adjustedHours / hrsPerDay);

  // Estimate completion date from start (pure study days, no buffer)
  const estCompletionDate = (() => {
    if (!startDate) return null;
    let remaining = rawDaysNeeded;
    const d = new Date(startDate + "T12:00:00");
    let safety = 0;
    while (remaining > 0 && safety < 1000) {
      const ds = d.toISOString().split("T")[0];
      if (!exceptionDates.includes(ds)) remaining--;
      d.setDate(d.getDate() + 1);
      safety++;
    }
    return d.toISOString().split("T")[0];
  })();

  // Calculate min hours/day to hit target completion
  const minHrsPerDay = (() => {
    if (!effectiveTarget || !startDate) return null;
    const availDays = calcStudyDays(startDate, effectiveTarget);
    if (availDays <= 0) return null;
    return Math.ceil((totalEstHours / availDays) * 10) / 10;
  })();

  // Feasibility calculator: what would min hrs/day be with extra exception dates?
  const MAX_STUDY_HRS = 18;
  const calcMinHrsWithDates = (extraDates) => {
    if (!effectiveTarget || !startDate) return null;
    const allEx = [...exceptionDates, ...extraDates];
    let count = 0;
    const d = new Date(startDate + "T12:00:00");
    const end = new Date(effectiveTarget + "T12:00:00");
    let safety = 0;
    while (d <= end && safety < 1000) {
      const ds = d.toISOString().split("T")[0];
      if (!allEx.includes(ds)) count++;
      d.setDate(d.getDate() + 1);
      safety++;
    }
    return count > 0 ? Math.ceil((totalEstHours / count) * 10) / 10 : 999;
  };

  const addExDate = () => {
    if (!newExDate || exceptionDates.includes(newExDate)) return;
    if (!data.overrideSafeguards) {
      const projected = calcMinHrsWithDates([newExDate]);
      if (projected !== null && projected > MAX_STUDY_HRS) {
        toast(`Can't add — would require ${projected}h/day (max ${MAX_STUDY_HRS}h). Enable override in settings to bypass.`, "error");
        return;
      }
    }
    setData(d => ({...d, exceptionDates: [...safeArr(d.exceptionDates), newExDate].sort()}));
    setNewExDate("");
  };
  const removeExDate = (dt) => setData(d => ({...d, exceptionDates: safeArr(d.exceptionDates).filter(x => x !== dt)}));

  // Add all occurrences of a day-of-week between start and end dates
  const addRecurringDayOff = (dayIndices) => {
    const start = data.studyStartDate || todayStr();
    const end = data.targetCompletionDate || data.targetDate;
    if (!end) { toast("Set a target completion or term end date first", "warn"); return; }
    const newDates = [];
    const d = new Date(start + "T12:00:00");
    const endD = new Date(end + "T12:00:00");
    while (d <= endD) {
      if (dayIndices.includes(d.getDay())) {
        const ds = d.toISOString().split("T")[0];
        if (!exceptionDates.includes(ds)) newDates.push(ds);
      }
      d.setDate(d.getDate() + 1);
    }
    if (newDates.length === 0) { toast("No new dates to add", "info"); return; }
    // Check feasibility before adding (unless override enabled)
    if (!data.overrideSafeguards) {
      const projected = calcMinHrsWithDates(newDates);
      if (projected !== null && projected > MAX_STUDY_HRS) {
        toast(`Can't add ${newDates.length} days off — would require ${projected}h/day (max ${MAX_STUDY_HRS}h). Enable override to bypass.`, "error");
        return;
      }
    }
    setData(dd => ({...dd, exceptionDates: [...safeArr(dd.exceptionDates), ...newDates].sort()}));
    const projected = calcMinHrsWithDates(newDates);
    const projLabel = projected !== null ? ` (→ ${projected}h/day needed)` : "";
    toast(`Added ${newDates.length} day${newDates.length>1?"s":""} off${projLabel}`, "success");
  };
  const clearRecurringDayOff = (dayIndices) => {
    setData(dd => ({...dd, exceptionDates: safeArr(dd.exceptionDates).filter(dt => !dayIndices.includes(new Date(dt+"T12:00:00").getDay()))}));
    toast("Removed recurring days off", "info");
  };

  const openAdd = () => { setForm({name:"",credits:3,difficulty:3,status:"not_started",topics:"",notes:"",assessmentType:"",courseCode:""}); setEditId(null); setShowAdd(true); };
  const openEdit = c => { setForm({name:c.name,credits:c.credits,difficulty:c.difficulty,status:c.status,topics:c.topics||"",notes:c.notes||"",assessmentType:c.assessmentType||"",courseCode:c.courseCode||""}); setEditId(c.id); setShowAdd(true); };
  const saveCourse = () => { if(!form.name.trim()) return; if(editId) { setData(d=>({...d,courses:d.courses.map(c=>c.id===editId?{...c,...form,credits:Number(form.credits),difficulty:Number(form.difficulty),lastUpdated:new Date().toISOString()}:c)})); toast("Course updated","success"); } else { setData(d=>({...d,courses:[...d.courses,{...EMPTY_DEEP,...form,id:uid(),credits:Number(form.credits),difficulty:Number(form.difficulty),lastUpdated:new Date().toISOString()}]})); toast(`Added: ${form.name}`,"success"); } setShowAdd(false); };
  const deleteCourse = id => { const name = (data.courses||[]).find(c=>c.id===id)?.name||""; setData(d=>({...d,courses:d.courses.filter(c=>c.id!==id)})); toast(`Removed: ${name}`,"warn"); };
  const handleImg = e => { const f=e.target.files?.[0]; if(!f)return; setImgFile(f); const r=new FileReader(); r.onload=()=>setImgPreview(r.result); r.readAsDataURL(f); e.target.value=''; };

  // Step 2: AI-powered study hour estimation (text-only, no vision needed)
  const estimateHours = async () => {
    if (!profile) return;
    const needsEstimate = courses.filter(c => c.status !== "completed" && (!c.averageStudyHours || c.averageStudyHours <= 0));
    if (!needsEstimate.length) { toast("All courses already have hour estimates!", "info"); return; }

    bgSet({loading:true, regenId:null, logs:[{type:"user",content:`⏱ Estimating study hours for ${needsEstimate.length} course${needsEstimate.length>1?"s":""}`}], label:`Estimating hours 1/${needsEstimate.length}...`});

    let completed = 0;
    for (const course of needsEstimate) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({type:"error",content:`Stopped after ${completed}/${needsEstimate.length}`}); break; }
      completed++;
      bgSet({label:`Estimating hours ${completed}/${needsEstimate.length}: ${course.courseCode||course.name}...`, regenId:course.id});
      bgLog({type:"user",content:`⏱ ${completed}/${needsEstimate.length}: ${course.name}`});

      const sys = `You are a WGU course duration researcher. Your job is to estimate realistic study hours for a WGU course.
Research the course thoroughly. Consider: credit units, assessment type (OA vs PA), typical student reports, course difficulty, and content scope.
Use the update_courses tool to set the averageStudyHours and difficulty fields.
Be realistic — base estimates on actual student experiences, not just credit hours.
Guidelines: 1 CU ≈ 15-25 study hours typically, but varies widely. Easy courses may take 10-20h total. Hard 4-CU courses may take 80-120h.`;

      const msg = `Estimate the total study hours needed to pass "${course.name}"${course.courseCode?` (${course.courseCode})`:""}.${course.credits?` It is ${course.credits} credit units.`:""} ${course.assessmentType?`Assessment type: ${course.assessmentType}.`:""} Set averageStudyHours and difficulty (1-5) using update_courses.`;

      try {
        const {logs:cLogs} = await runAILoop(profile, sys, [{role:"user",content:msg}], data, setData);
        for(const l of cLogs) bgLog(l);
      } catch(e) {
        bgLog({type:"error",content:`Failed for ${course.name}: ${e.message}`});
      }
    }

    toast(`Hour estimates complete: ${completed}/${needsEstimate.length} courses`, "success");
    bgSet({loading:false, regenId:null, label:""});
  };

  //  Drag-drop + priority reordering
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOverIdx, setDragOverIdx] = useState(null);

  const moveCourse = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    dlog('debug','state',`Move course ${fromIdx} → ${toIdx}`);
    setData(d => {
      const arr = [...d.courses];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return {...d, courses: arr};
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
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", idx);
  };
  const handleDragOver = (e, idx) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(idx); };
  const handleDragLeave = () => setDragOverIdx(null);
  const handleDrop = (e, toIdx) => { e.preventDefault(); const fromIdx = dragIdx; setDragIdx(null); setDragOverIdx(null); if (fromIdx !== null) moveCourse(fromIdx, toIdx); };
  const handleDragEnd = () => { setDragIdx(null); setDragOverIdx(null); };

  const parseImage = async () => {
    if(!profile||!imgFile)return;
    bgSet({loading:true, logs:[{type:"user",content:`📷 Parsing: ${imgFile.name}`}], label:"Parsing degree plan..."});
    bgNewAbort();
    const signal = getBgState().abortCtrl?.signal;
    const b64=await fileToBase64(imgFile);
    const isAnth = isAnthProvider(profile);
    const headers = getAuthHeaders(profile);

    // Use a MINIMAL focused prompt — only extract name, code, credits. Enrichment handles the rest.
    const simpleSystem = `You are a WGU degree plan parser. Extract the MINIMUM info for each course visible in the image.
For each course, ONLY extract:
- name: The full course name including code (e.g. "Software Defined Networking – D415")
- courseCode: Just the code (e.g. "D415")
- credits: Credit units (number)
- status: completed, in_progress, or not_started (based on visual indicators)

Do NOT estimate difficulty, do NOT add topics, do NOT add notes. Keep it minimal — enrichment will fill in details later.
Call add_courses with ALL courses you can see. Do NOT return an empty array.`;

    // Only send add_courses tool to keep it focused
    const addCourseTool = TOOLS.find(t => t.name === "add_courses");
    const toolsForParse = [addCourseTool];
    const toolsOAI = toolsForParse.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.input_schema}}));

    const imgContent = isAnth
      ? [{ type:"image", source:{ type:"base64", media_type:imgFile.type, data:b64 } }, { type:"text", text:"Parse this degree plan. Extract ONLY course name, code, credits, and status for each course. Keep data minimal." }]
      : [{ type:"image_url", image_url:{ url:`data:${imgFile.type};base64,${b64}` } }, { type:"text", text:"Parse this degree plan. Extract ONLY course name, code, credits, and status for each course. Keep data minimal." }];

    const body = isAnth
      ? { model:profile.model, max_tokens:16384, stream:true, system:simpleSystem, messages:[{role:"user",content:imgContent}], tools:toolsForParse }
      : { model:profile.model, max_tokens:16384, stream:true, messages:[{role:"system",content:simpleSystem},{role:"user",content:imgContent}], tools:toolsOAI };

    dlog('info','api',`Image parse: direct call with focused prompt (${simpleSystem.length} chars sys)`);

    let res;
    try {
      res = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body), signal });
      dlog('api','api',`Image parse response: HTTP ${res.status}`); setApiStatus(res.ok, res.status);
    } catch(e) {
      setApiStatus(false, 0, e.message);
      if (e.name === 'AbortError') { bgLog({type:"error",content:"Cancelled"}); bgSet({loading:false,label:""}); return; }
      bgLog({type:"error",content:`Network error: ${e.message}`});
      bgSet({loading:false,label:""}); setImgFile(null); setImgPreview(null); return;
    }

    if (!res.ok) {
      dlog('warn','api',`Image parse stream failed (${res.status}), trying non-stream`);
      try {
        const body2 = isAnth
          ? { model:profile.model, max_tokens:16384, system:simpleSystem, messages:[{role:"user",content:imgContent}], tools:toolsForParse }
          : { model:profile.model, max_tokens:16384, messages:[{role:"system",content:simpleSystem},{role:"user",content:imgContent}], tools:toolsOAI };
        const res2 = await fetch(profile.baseUrl, { method:"POST", headers, body:JSON.stringify(body2), signal });
        setApiStatus(res2.ok, res2.status);
        if (!res2.ok) { const t = await res2.text(); bgLog({type:"error",content:`API ${res2.status}: ${t.slice(0,200)}`}); bgSet({loading:false,label:""}); return; }
        const rawText = await res2.text();
        let data2; try { data2 = JSON.parse(rawText); } catch(e) { bgLog({type:"error",content:`JSON error: ${rawText.slice(0,200)}`}); bgSet({loading:false,label:""}); return; }
        // Extract tool calls from non-streaming response
        const msg = isAnth ? null : data2.choices?.[0]?.message;
        const tcs = isAnth ? safeArr(data2.content).filter(b=>b.type==="tool_use") : safeArr(msg?.tool_calls);
        if (tcs.length > 0) {
          const parsed = tcs.map(tc => {
            const inp = isAnth ? tc.input : (typeof tc.function?.arguments==='string' ? JSON.parse(tc.function.arguments) : tc.function?.arguments || {});
            return { id: tc.id, name: isAnth?tc.name:tc.function?.name, input: inp };
          });
          const results = executeTools(parsed, data, setData);
          for (const r of results) bgLog({type:"tool_result",content:`✅ ${r.result}`});
        } else {
          const txt = isAnth ? safeArr(data2.content).filter(b=>b.type==="text").map(b=>b.text).join("") : (msg?.content||"");
          bgLog({type:"text",content:txt||"Model didn't extract any courses"});
        }
      } catch(e) { bgLog({type:"error",content:e.message}); }
      bgSet({loading:false,label:""}); setImgFile(null); setImgPreview(null); return;
    }

    // Parse SSE stream (same as callAIStream but inline so we control everything)
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", toolCallMap = {};
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        for (const line of lines) {
          const tr = line.trim();
          if (!tr || tr === "data: [DONE]" || !tr.startsWith("data: ")) continue;
          let chunk; try { chunk = JSON.parse(tr.slice(6)); } catch(_e) { continue; }
          if (isAnth) {
            if (chunk.type === "content_block_start" && chunk.content_block?.type === "tool_use") {
              toolCallMap[chunk.index||0] = { id:chunk.content_block.id, name:chunk.content_block.name, arguments:"" };
            } else if (chunk.type === "content_block_delta" && chunk.delta?.type === "input_json_delta") {
              if (toolCallMap[chunk.index||0]) toolCallMap[chunk.index||0].arguments += (chunk.delta.partial_json||"");
            }
          } else {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index??0;
                if (!toolCallMap[idx]) toolCallMap[idx] = { id:tc.id||"", name:"", arguments:"" };
                if (tc.id) toolCallMap[idx].id = tc.id;
                if (tc.function?.name) toolCallMap[idx].name = tc.function.name;
                if (tc.function?.arguments) toolCallMap[idx].arguments += tc.function.arguments;
              }
            }
          }
          // Update UI with progress
          const totalArgs = Object.values(toolCallMap).reduce((s,t)=>s+t.arguments.length,0);
          if (totalArgs > 0) bgStream(`📦 Receiving course data... (${totalArgs} chars)`);
        }
      }
    } catch(e) { dlog('error','api',`Image stream error: ${e.message}`); }

    // Parse results
    const toolCalls = Object.values(toolCallMap).map(tc => {
      let input = {};
      try {
        if (tc.arguments) {
          let fixed = tc.arguments;
          const opens = (fixed.match(/\[/g)||[]).length - (fixed.match(/\]/g)||[]).length;
          const braces = (fixed.match(/\{/g)||[]).length - (fixed.match(/\}/g)||[]).length;
          for (let i=0;i<opens;i++) fixed += "]";
          for (let i=0;i<braces;i++) fixed += "}";
          input = JSON.parse(fixed);
        }
      } catch(e) { dlog('warn','api',`Image parse tool args failed`,tc.arguments?.slice(0,500)); }
      return { id:tc.id, name:tc.name, input };
    }).filter(tc=>tc.name);

    dlog('info','api',`Image parse done: ${toolCalls.length} tool calls, args: ${JSON.stringify(toolCalls.map(t=>({name:t.name,coursesCount:safeArr(t.input.courses).length}))).slice(0,300)}`);

    if (toolCalls.length > 0) {
      const totalCourses = toolCalls.reduce((sum, tc) => sum + safeArr(tc.input.courses).length, 0);
      for (const tc of toolCalls) bgLog({type:"tool_call",content:`Tool: ${tc.name}: ${safeArr(tc.input.courses).length} courses`});
      const results = executeTools(toolCalls, data, setData);
      for (const r of results) bgLog({type:"tool_result",content:`Done: ${r.result}`});
      if (totalCourses > 0) {
        toast(`${totalCourses} courses imported! Next: click 'Enrich All' to generate study context.`, "success");
      } else {
        toast(`Model responded but found 0 courses. Try a clearer image or a vision model (Claude Sonnet, GPT-4o).`, "warn");
      }
    } else {
      bgLog({type:"error",content:"Model didn't return tool calls. The image may not be clear or the model may not support vision."});
      toast(`Parse failed with ${profile?.name || "current model"}. Try a vision-capable model (Claude Sonnet/Opus, GPT-4o, Gemini Pro).`, "warn");
    }

    bgStream(""); bgSet({loading:false,label:""}); setImgFile(null); setImgPreview(null);
  };

  const genPlan = async () => {
    if(!profile)return; const active=courses.filter(c=>c.status!=="completed"); if(!active.length)return;
    // Pre-flight validation
    if (!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS) { toast("Schedule is infeasible — adjust dates or enable override", "error"); return; }
    if (!data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) { toast("Estimated finish exceeds term end date — increase hours, remove days off, or enable override", "error"); return; }
    if (!data.studyStartDate) { toast("Set a start date in Study Settings first", "warn"); return; }
    if (!data.targetCompletionDate && !data.targetDate) { toast("Set a target completion or term end date first", "warn"); return; }
    if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) { toast("Target completion is after term end — fix your dates first", "error"); return; }
    if (hrsPerDay < 1) { toast("Hours/day must be at least 1", "warn"); return; }
    bgSet({loading:true, logs:[{type:"user",content:"Generating study plan in weekly chunks..."}], label:"Generating study plan..."});

    const capturedTasks = [];
    const previewSetData = (fn) => {
      setData(d => {
        const next = typeof fn === "function" ? fn(d) : fn;
        if (next.tasks) {
          for (const [dt, dayTasks] of Object.entries(next.tasks)) {
            const oldTasks = d.tasks?.[dt] || [];
            const newOnes = safeArr(dayTasks).filter(t => !oldTasks.some(o => o.id === t.id));
            newOnes.forEach(t => capturedTasks.push({...t, date: dt}));
          }
        }
        return next;
      });
    };

    const courseDetails = active.map((c, i) => {
      const hrs = c.averageStudyHours > 0 ? c.averageStudyHours : ([0,20,35,50,70,100][c.difficulty||3]||50);
      return `${i+1}. ${c.name}${c.courseCode?` (${c.courseCode})`:""} — ${hrs}h est, ${c.credits||"?"}CU, ${c.assessmentType||"?"}, diff ${c.difficulty||3}/5`;
    }).join("\n");

    const startDt = data.studyStartDate || todayStr();
    const targetDt = goalDate || data.targetDate || "";
    const gradDt = data.targetDate || "";
    const hpd = data.studyHoursPerDay || 4;
    const exDts = safeArr(data.exceptionDates);
    const userCtx = planPrompt.trim() ? `\nStudent preferences: ${planPrompt.trim()}` : "";

    // Calculate total weeks needed
    const endDt = targetDt || gradDt;
    const totalDays = endDt ? diffDays(startDt, endDt) : (Math.ceil(totalEstHours / hpd) + 7);
    const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));

    // Track cumulative hours assigned so we can tell the AI what's left
    let hoursAssigned = 0;

    for (let week = 0; week < totalWeeks; week++) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({type:"error",content:`Stopped after week ${week}`}); break; }

      const weekStart = new Date(startDt + "T12:00:00");
      weekStart.setDate(weekStart.getDate() + week * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);
      const ws = weekStart.toISOString().split("T")[0];
      const we = weekEnd.toISOString().split("T")[0];

      // Skip weeks entirely past the end date
      if (endDt && ws > endDt) break;

      bgSet({label:`Generating week ${week+1}/${totalWeeks}: ${ws} — ${we}...`});
      bgLog({type:"user",content:`📅 Week ${week+1}/${totalWeeks}: ${ws} → ${we}`});

      const weekExDts = exDts.filter(d => d >= ws && d <= we);
      const hoursRemaining = totalEstHours - hoursAssigned;
      if (hoursRemaining <= 0) { bgLog({type:"text",content:"All course hours assigned — done!"}); break; }

      const sys = buildSystemPrompt(data, `Use generate_study_plan to create tasks for ONLY ${ws} through ${we} (7 days). Do NOT use add_tasks. Do NOT plan outside this date range.`);

      const weekMsg = `Generate study tasks for WEEK ${week+1} ONLY: ${ws} to ${we}.

COURSES (STRICT PRIORITY ORDER — complete #1 before starting #2, etc.):
${courseDetails}

PROGRESS: ~${Math.round(hoursAssigned)}h already scheduled of ~${totalEstHours}h total. ~${Math.round(hoursRemaining)}h remaining.
Hours/day: ${hpd}h | ${weekExDts.length > 0 ? `Days off this week: ${weekExDts.join(", ")}` : "No days off this week"}
${week === 0 && data.studyStartTime ? `First day starts at ${data.studyStartTime}` : ""}

SEQUENTIAL RULE (CRITICAL):
- Study ONE course at a time. Do NOT mix courses on the same day.
- Fully schedule all hours for course #1 first. Only move to course #2 after course #1's hours are exhausted.
- Exception: the transition day where course #1 finishes can have course #2 start after.
- Based on ${Math.round(hoursAssigned)}h already assigned, calculate which course we're currently on and continue from there.

CATEGORY TAGS (use these exactly):
- "study" = Learning new material, reading, watching lectures
- "review" = Revisiting/revising previously learned material
- "exam-prep" = Practice exams, mock tests, focused test preparation
- "exam-day" = The ACTUAL assessment day (OA exam or PA submission)
- "project" = Performance Assessment (PA) writing, research, drafting
- "class" = Live cohort sessions, instructor webinars
- "break" = Short rest between study blocks, meals

TASK STRUCTURE RULES:
- ONLY create tasks between ${ws} and ${we}. No dates outside this range.
- Study blocks: 1–2.5h max. Include 10–15 min breaks between blocks.
- Include a 30–60 min meal/rest break if 4+ hours in one day.
- Title format: "CourseCode — Specific Topic" (e.g., "D415 — SDN Architecture: Three Layers").
- When a course is nearly complete (~last 10-15% of hours), switch to "review" and "exam-prep" categories.
- Schedule an "exam-day" task on the LAST day of each course (1-2h block, title: "CourseCode — 🎯 OA Exam" or "CourseCode — 🎯 Submit PA").
- For PA courses, schedule "project" category tasks for writing/research.
- Each task needs date (YYYY-MM-DD), time, endTime (24h format).
- ~${Math.min(hpd * 7, hoursRemaining)}h this week.
${userCtx}`;

      try {
        const {logs:wLogs} = await runAILoop(profile, sys, [{role:"user",content:weekMsg}], data, previewSetData);
        for (const l of wLogs) bgLog(l);
        // Count hours added this week
        const weekTasks = capturedTasks.filter(t => t.date >= ws && t.date <= we);
        const weekHrs = weekTasks.reduce((s, t) => {
          const st = parseTime(t.time), et = parseTime(t.endTime);
          return s + (st && et ? Math.max(0, (et.mins - st.mins) / 60) : 0);
        }, 0);
        hoursAssigned += weekHrs;
        bgLog({type:"text",content:`Week ${week+1}: ${weekTasks.length} tasks, ~${Math.round(weekHrs)}h (total: ~${Math.round(hoursAssigned)}h/${totalEstHours}h)`});
      } catch(e) {
        bgLog({type:"error",content:`Week ${week+1} failed: ${e.message}`});
      }
    }

    bgSet({loading:false, regenId:null, label:""});
    if (capturedTasks.length > 0) {
      setPendingPlan({ tasks: capturedTasks, summary: `${capturedTasks.length} tasks across ${[...new Set(capturedTasks.map(t=>t.date))].length} days (~${Math.round(hoursAssigned)}h scheduled)` });
      toast(`Plan generated — review ${capturedTasks.length} tasks before confirming`, "info");
    } else {
      toast("No tasks were generated — try adjusting your prompt or checking your AI connection", "warn");
    }
  };

  const confirmPlan = () => {
    if (!pendingPlan) return;
    // Tasks are already in data from previewSetData — just clear pending
    setPendingPlan(null);
    toast(`Study plan confirmed: ${pendingPlan.tasks.length} tasks added to calendar`, "success");
  };

  const discardPlan = () => {
    if (!pendingPlan) return;
    // Remove the tasks that were added
    setData(d => {
      const tasks = { ...d.tasks };
      for (const t of pendingPlan.tasks) {
        if (tasks[t.date]) {
          tasks[t.date] = tasks[t.date].filter(x => x.id !== t.id);
          if (tasks[t.date].length === 0) delete tasks[t.date];
        }
      }
      return { ...d, tasks };
    });
    setPendingPlan(null);
    toast("Plan discarded", "info");
  };

  const regenCourse = async (course) => {
    if(!profile)return;
    bgSet({loading:true, regenId:course.id, logs:[{type:"user",content:`🔄 Enriching: ${course.name}`}], label:`Enriching ${course.name}...`});
    dlog('info','api',`Regen: ${course.name}`);
    const sys=buildSystemPrompt(data,`Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
    const{logs}=await runAILoop(profile,sys,[{role:"user",content:`Tell me everything I truly need to know to pass ${course.name}. Fill in all context.`}],data,setData);
    for(const l of logs) bgLog(l);
    bgSet({loading:false, regenId:null, label:""});
  };

  const regenAll = async () => {
    if(!profile)return; const active=courses.filter(c=>c.status!=="completed"); if(!active.length)return;
    bgSet({loading:true, logs:[{type:"user",content:`🔄 Regenerating ${active.length} courses individually`}], label:`Regenerating 1/${active.length}...`});
    dlog('info','api',`Regen all (sequential): ${active.length} courses`);
    let completed = 0;
    for (const course of active) {
      if (getBgState().abortCtrl?.signal?.aborted) { bgLog({type:"error",content:`Stopped after ${completed}/${active.length}`}); break; }
      completed++;
      bgSet({label:`Regenerating ${completed}/${active.length}: ${course.name}...`, regenId:course.id});
      bgLog({type:"user",content:`🔄 ${completed}/${active.length}: ${course.name}`});
      const sys=buildSystemPrompt(data,`Regenerate deep context for "${course.name}" using enrich_course_context. Include ALL fields.`);
      const{logs:cLogs}=await runAILoop(profile,sys,[{role:"user",content:`Tell me everything I truly need to know to pass ${course.name}. Fill in all context — competencies, topics with weights, exam tips, key terms, focus areas, resources, common mistakes.`}],data,setData);
      for(const l of cLogs) bgLog(l);
    }
    toast(`Regeneration complete: ${completed}/${active.length}`, "success");
    bgSet({loading:false, regenId:null, label:""});
  };

  const enrichNew = async () => {
    if(!profile)return;
    const unenriched = courses.filter(c => c.status!=="completed" && !hasCtx(c));
    if(!unenriched.length) { toast("All courses already enriched!", "info"); return; }

    // Sequential individual enrichment — one course at a time for reliability
    bgSet({loading:true, regenId:null, logs:[{type:"user",content:`✨ Enriching ${unenriched.length} course${unenriched.length>1?"s":""} individually`}], label:`Enriching 1/${unenriched.length}...`});
    dlog('info','api',`Enrich new (sequential): ${unenriched.length} courses`);

    let completed = 0;
    for (const course of unenriched) {
      // Check if user cancelled
      if (getBgState().abortCtrl?.signal?.aborted) {
        bgLog({type:"error",content:`Stopped after ${completed}/${unenriched.length} courses`});
        break;
      }
      completed++;
      bgSet({label:`Enriching ${completed}/${unenriched.length}: ${course.name}...`, regenId:course.id});
      bgLog({type:"user",content:`🔄 ${completed}/${unenriched.length}: ${course.name}`});

      const sys = buildSystemPrompt(data, `Generate deep context for "${course.name}" (${course.courseCode||"no code"}) using enrich_course_context. Include ALL fields: competencies with codes, topicBreakdown with percentage weights, examTips, keyTerms, focusAreas, resources, commonMistakes, assessmentType details. Be thorough — this is the ONLY call for this course.`);
      const {logs:cLogs} = await runAILoop(profile, sys, [{role:"user",content:`Generate comprehensive study context for ${course.name}${course.courseCode?` (${course.courseCode})`:""}.${course.credits?` ${course.credits} CU.`:""} Include everything a student needs to pass: assessment format, all competencies, topic breakdown with weights, exam tips, key terms, focus areas, resources, and common mistakes.`}], data, setData);

      for(const l of cLogs) bgLog(l);
      dlog('info','api',`Enriched ${completed}/${unenriched.length}: ${course.name}`);
    }

    toast(`Enrichment complete: ${completed}/${unenriched.length} courses processed`, "success");
    bgSet({loading:false, regenId:null, label:""});
  };

  const hasCtx = c => safeArr(c.competencies).length>0||safeArr(c.topicBreakdown).length>0||safeArr(c.examTips).length>0;

  // Step completion tracking (4 steps: Import → Configure → Enrich → Generate)
  const step1Done = courses.length > 0;
  const step2Done = step1Done && courses.filter(c=>c.status!=="completed").every(c=>c.averageStudyHours>0) && !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
  const step3Done = step2Done && courses.filter(c=>c.status!=="completed").every(c=>hasCtx(c));
  const step4Done = step3Done && Object.keys(data.tasks||{}).length > 0;
  const activeStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : 4;

  // When activeStep advances, collapse the completed step and open the new one
  const prevActiveStep = useRef(activeStep);
  useEffect(() => {
    if (activeStep !== prevActiveStep.current) {
      // Only open the new active step — don't force-close anything (prevents date picker destruction)
      setManualStepOpen(p => ({...p, [activeStep]: true}));
      prevActiveStep.current = activeStep;
    }
  }, [activeStep]);

  const isStepOpen = (n) => {
    if (manualStepOpen[n] !== undefined) return manualStepOpen[n];
    return n === activeStep;
  };
  const toggleStep = (n) => setManualStepOpen(p => ({...p, [n]: !isStepOpen(n)}));

  const StepHead = ({n, title, done, disabled, subtitle, children}) => (
    <div style={{background:T.card,border:`1px solid ${done&&n!==activeStep?T.accent+"33":T.border}`,borderRadius:12,marginBottom:16,overflow:"hidden",opacity:disabled?0.4:1,pointerEvents:disabled?"none":"auto",transition:"opacity .2s"}}>
      <button onClick={()=>toggleStep(n)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",background:"none",border:"none",cursor:disabled?"default":"pointer",textAlign:"left"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:26,height:26,borderRadius:"50%",background:done?T.accent:n===activeStep?T.purple:T.input,border:`2px solid ${done?T.accent:n===activeStep?T.purple:T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:fs(11),fontWeight:800,color:done||n===activeStep?"#fff":T.dim,flexShrink:0}}>
            {done ? "✓" : n}
          </div>
          <div>
            <div style={{fontSize:fs(14),fontWeight:700,color:disabled?T.dim:done&&n!==activeStep?T.soft:T.text}}>{title}</div>
            {subtitle&&!isStepOpen(n)&&<div style={{fontSize:fs(10),color:T.dim,marginTop:1}}>{subtitle}</div>}
            {disabled&&<div style={{fontSize:fs(10),color:T.dim,marginTop:1}}>Complete previous steps first</div>}
          </div>
        </div>
        {!disabled&&<span style={{fontSize:fs(10),color:T.dim,transition:"transform .2s",transform:isStepOpen(n)?"rotate(180deg)":"rotate(0)"}}>{isStepOpen(n)?"▲":"▼"}</span>}
      </button>
      {isStepOpen(n) && !disabled && <div style={{padding:"0 18px 16px"}}>{children}</div>}
    </div>
  );

  const AIActivity = () => (bg.loading || bg.logs.length > 0) ? (
    <div style={{background:T.panel,border:`1px solid ${T.purple}33`,borderRadius:10,padding:14,marginTop:12}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:bg.streamText||bg.logs.length>0?8:0}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {bg.loading && <Ic.Spin s={14}/>}
          <span style={{fontSize:fs(12),fontWeight:700,color:bg.loading?T.purple:T.soft}}>{bg.loading ? (bg.label||"AI working...") : "AI Activity"}</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          {bg.loading&&getBgState().abortCtrl&&<Btn small v="ghost" onClick={()=>{getBgState().abortCtrl?.abort();bgSet({loading:false,label:""});toast("Cancelled","info")}}>Cancel</Btn>}
          {!bg.loading&&bg.logs.length>0&&<Btn small v="ghost" onClick={()=>bgSet({logs:[]})}>Clear</Btn>}
        </div>
      </div>
      {bg.streamText&&<div style={{padding:"6px 10px",borderRadius:7,background:T.purpleD,border:`1px solid ${T.purple}33`,fontSize:fs(11),color:T.purple,whiteSpace:"pre-wrap",maxHeight:80,overflow:"auto",marginBottom:4}}>{bg.streamText}</div>}
      {bg.logs.length>0&&<div style={{maxHeight:150,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>{bg.logs.map((l,i)=><LogLine key={i} l={l}/>)}</div>}
    </div>
  ) : null;

  return (
    <div className="fade">
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setPage("dashboard")} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 10px",cursor:"pointer",color:T.soft,fontSize:fs(12),fontWeight:600}}>← Dashboard</button>
          <div><h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Course Planner</h1><p style={{color:T.dim,fontSize:fs(13)}}>{courses.length} courses · {doneCU}/{totalCU} CU</p></div>
        </div>
      </div>

      {/* STEP 1: Import Courses */}
      <StepHead n={1} title="Import Courses" done={step1Done} subtitle={step1Done?`${courses.length} courses imported`:""}>
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
          <Btn small v="secondary" onClick={openAdd}><Ic.Plus s={12}/> Add Manually</Btn>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <button onClick={()=>{fileRef.current.accept="image/*";fileRef.current.click()}} disabled={bg.loading} style={{padding:"16px",borderRadius:10,border:`1.5px solid ${T.accent}44`,background:T.accentD,cursor:bg.loading?"wait":"pointer",textAlign:"left"}}>
            <div style={{fontSize:fs(13),fontWeight:700,color:T.accent,marginBottom:3}}>Screenshot / Image</div>
            <div style={{fontSize:fs(10),color:T.soft,lineHeight:1.4}}>Upload a screenshot of your WGU degree plan page</div>
          </button>
          <button onClick={()=>{fileRef.current.accept=".pdf,.doc,.docx,.txt,.csv,image/*";fileRef.current.click()}} disabled={bg.loading} style={{padding:"16px",borderRadius:10,border:`1.5px solid ${T.blue}44`,background:T.blueD,cursor:bg.loading?"wait":"pointer",textAlign:"left"}}>
            <div style={{fontSize:fs(13),fontWeight:700,color:T.blue,marginBottom:3}}>Document / PDF</div>
            <div style={{fontSize:fs(10),color:T.soft,lineHeight:1.4}}>Upload PDF, DOCX, or text file of your degree plan</div>
          </button>
        </div>
        {!profile && <div style={{marginTop:10,padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange}}>Connect an AI profile in Settings first — parsing requires a vision-capable model.</div>}
        <div style={{marginTop:10,fontSize:fs(10),color:T.dim,lineHeight:1.5}}>Image and document parsing requires a vision-capable AI model such as Claude Sonnet/Opus, GPT-4o, or Gemini Pro.</div>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
        {imgPreview&&<div style={{marginTop:12,padding:12,background:T.panel,borderRadius:10,border:`1px solid ${T.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:fs(12),fontWeight:700}}>Degree Plan Image</span>
            <div style={{display:"flex",gap:8}}>
              <Btn small v="ghost" onClick={()=>{setImgFile(null);setImgPreview(null)}}>Remove</Btn>
              <Btn small v="ai" onClick={parseImage} disabled={bg.loading}>{bg.loading?<><Ic.Spin s={14}/> Parsing...</>:<><Ic.AI s={14}/> Extract Courses</>}</Btn>
            </div>
          </div>
          <img src={imgPreview} style={{maxWidth:"100%",maxHeight:200,borderRadius:10,border:`1px solid ${T.border}`}} alt="plan"/>
        </div>}
        {activeStep===1 && <AIActivity/>}
      </StepHead>

      {/* STEP 2: Configure Study Plan (Hours + Settings combined) */}
      {(() => {
        const needsHours = courses.filter(c => c.status !== "completed" && (!c.averageStudyHours || c.averageStudyHours <= 0));
        const isEstimating = bg.loading && (bg.label||"").toLowerCase().includes("estimat");
        const allHaveHours = needsHours.length === 0 && courses.length > 0;
        const hasSettings = !!(data.studyStartDate && (data.targetCompletionDate || data.targetDate));
        return (
          <StepHead n={2} title="Configure Study Plan" done={step2Done} disabled={!step1Done} subtitle={step2Done?`${activeCourses.length} courses · ${data.studyHoursPerDay}h/day · ${data.targetCompletionDate?new Date(data.targetCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}):""}`:""}>

            {/* Section A: Study Settings — streamlined left to right */}
            <div style={{marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:fs(12),fontWeight:700,color:T.text,display:"flex",alignItems:"center",gap:6}}>
                  📅 Study Settings
                  {hasSettings && <Badge color={T.accent} bg={T.accentD}>✓</Badge>}
                </div>
                <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontSize:fs(10),color:data.overrideSafeguards?T.orange:T.dim}}>
                  <input type="checkbox" checked={!!data.overrideSafeguards} onChange={e=>setData(d=>({...d,overrideSafeguards:e.target.checked}))} style={{width:14,height:14,accentColor:T.orange}}/>
                  Override safeguards
                </label>
              </div>

              {/* Row 1: Dates */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>
                <div>
                  <Label>1. Start Date *</Label>
                  <BufferedInput type="date" value={data.studyStartDate||""} onCommit={v=>setData(d=>({...d,studyStartDate:v}))}/>
                </div>
                <div style={{opacity:data.studyStartDate?1:0.4,pointerEvents:data.studyStartDate?"auto":"none"}}>
                  <Label>2. Target Completion *</Label>
                  <BufferedInput type="date" value={data.targetCompletionDate||""} onCommit={v=>setData(d=>({...d,targetCompletionDate:v}))} title="When you want to finish all courses"/>
                </div>
                <div style={{opacity:data.studyStartDate&&data.targetCompletionDate?1:0.4,pointerEvents:data.studyStartDate&&data.targetCompletionDate?"auto":"none"}}>
                  <Label>3. Term End Date</Label>
                  <BufferedInput type="date" value={data.targetDate||""} onCommit={v=>setData(d=>({...d,targetDate:v}))} title="Official WGU term end (hard deadline)"/>
                </div>
                <div style={{opacity:data.studyStartDate&&(data.targetCompletionDate||data.targetDate)?1:0.4,pointerEvents:data.studyStartDate&&(data.targetCompletionDate||data.targetDate)?"auto":"none"}}>
                  <Label>4. Start Time</Label>
                  <BufferedInput type="time" value={data.studyStartTime||""} onCommit={v=>setData(d=>({...d,studyStartTime:v}))}/>
                </div>
              </div>

              {/* Row 2: Hours/Day — auto-calculated default */}
              {data.studyStartDate && (data.targetCompletionDate || data.targetDate) && (() => {
                const recHrs = minHrsPerDay != null && minHrsPerDay > 0 && minHrsPerDay <= MAX_STUDY_HRS ? Math.ceil(minHrsPerDay) : 4;
                return (
                  <div style={{display:"flex",gap:10,alignItems:"flex-end",marginBottom:14}}>
                    <div style={{width:120}}>
                      <Label>5. Hours/Day</Label>
                      <BufferedInput type="number" min="1" max={data.overrideSafeguards?24:MAX_STUDY_HRS} value={data.studyHoursPerDay||4} onCommit={v=>{
                        const max = data.overrideSafeguards ? 24 : MAX_STUDY_HRS;
                        const n = Math.max(1, Math.min(max, Number(v) || 4));
                        setData(d=>({...d,studyHoursPerDay:n}));
                      }}/>
                    </div>
                    {hrsPerDay < recHrs && (
                      <button onClick={()=>setData(d=>({...d,studyHoursPerDay:recHrs}))} style={{padding:"8px 14px",borderRadius:8,border:`1px solid ${T.accent}44`,background:T.accentD,cursor:"pointer",fontSize:fs(11),fontWeight:600,color:T.accent,marginBottom:1}}>
                        Set to minimum ({recHrs}h/day)
                      </button>
                    )}
                    <div style={{fontSize:fs(10),color:T.dim,marginBottom:6}}>
                      Minimum: {minHrsPerDay ?? "—"}h/day to finish on time
                    </div>
                  </div>
                );
              })()}

              {/* Day Off Section */}
              {data.studyStartDate && (data.targetCompletionDate || data.targetDate) && (
                <div style={{background:T.input,borderRadius:10,padding:14,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:fs(12),fontWeight:700,color:T.text}}>🚫 Days Off & Exceptions</div>
                    <span style={{fontSize:fs(10),color:T.dim}}>{exceptionDates.length} day{exceptionDates.length!==1?"s":""} excluded</span>
                  </div>

                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:10}}>
                    <input type="date" value={newExDate} onChange={e=>setNewExDate(e.target.value)} style={{flex:"0 0 160px"}}/><Btn small onClick={addExDate} disabled={!newExDate}>Add Date</Btn>
                  </div>

                  {/* Recurring buttons */}
                  <div style={{fontSize:fs(10),color:T.dim,marginBottom:6}}>Quick add recurring days off (through {new Date((data.targetCompletionDate||data.targetDate)+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}):</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
                    {(() => {
                      const override = !!data.overrideSafeguards;
                      const wkndDates = [];
                      const s = new Date((data.studyStartDate||todayStr())+"T12:00:00");
                      const e = new Date((data.targetCompletionDate||data.targetDate)+"T12:00:00");
                      while (s <= e) { if ([0,6].includes(s.getDay())) { const ds=s.toISOString().split("T")[0]; if(!exceptionDates.includes(ds)) wkndDates.push(ds); } s.setDate(s.getDate()+1); }
                      const wkndProjected = wkndDates.length > 0 ? calcMinHrsWithDates(wkndDates) : null;
                      const wkndBlocked = !override && wkndProjected !== null && wkndProjected > MAX_STUDY_HRS;
                      return <Btn small v="secondary" onClick={()=>addRecurringDayOff([0,6])} disabled={wkndBlocked} title={wkndBlocked?`Would require ${wkndProjected}h/day`:""}>🗓 Weekends</Btn>;
                    })()}
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,i) => {
                      const override = !!data.overrideSafeguards;
                      const count = exceptionDates.filter(dt => new Date(dt+"T12:00:00").getDay()===i).length;
                      let wouldBlock = false;
                      if (!override && count === 0) {
                        const newDays = [];
                        const s = new Date((data.studyStartDate||todayStr())+"T12:00:00");
                        const e = new Date((data.targetCompletionDate||data.targetDate)+"T12:00:00");
                        while (s <= e) { if(s.getDay()===i){ const ds=s.toISOString().split("T")[0]; if(!exceptionDates.includes(ds)) newDays.push(ds); } s.setDate(s.getDate()+1); }
                        const proj = calcMinHrsWithDates(newDays);
                        wouldBlock = proj !== null && proj > MAX_STUDY_HRS;
                      }
                      return (
                        <button key={i} onClick={()=>count>0?clearRecurringDayOff([i]):addRecurringDayOff([i])} disabled={wouldBlock && count===0}
                          title={wouldBlock ? "Would exceed limit (enable override)" : count>0 ? `Remove all ${day}s` : `Add every ${day} off`}
                          style={{padding:"5px 10px",borderRadius:7,border:`1px solid ${count>0?T.orange:wouldBlock?T.red+"55":T.border}`,background:count>0?T.orangeD:T.input,color:count>0?T.orange:wouldBlock?T.red:T.soft,fontSize:fs(10),fontWeight:600,cursor:wouldBlock&&count===0?"not-allowed":"pointer",opacity:wouldBlock&&count===0?0.5:1,display:"flex",alignItems:"center",gap:4}}>
                          {day}{count>0&&<span style={{fontSize:fs(8),opacity:0.7}}>({count})</span>}
                        </button>
                      );
                    })}
                    {exceptionDates.length > 0 && <Btn small v="ghost" onClick={()=>{if(confirm(`Clear all ${exceptionDates.length} exception dates?`))setData(d=>({...d,exceptionDates:[]}))}}>Clear All</Btn>}
                  </div>

                  {exceptionDates.length > 0 && <div style={{display:"flex",gap:4,flexWrap:"wrap",maxHeight:120,overflowY:"auto"}}>{exceptionDates.map(dt=><div key={dt} style={{display:"flex",alignItems:"center",gap:3,padding:"3px 9px",borderRadius:5,background:T.orangeD,fontSize:fs(10),color:T.orange}}>{new Date(dt+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}<button onClick={()=>removeExDate(dt)} style={{background:"none",border:"none",color:T.orange,cursor:"pointer",fontSize:fs(12),padding:0}}>×</button></div>)}</div>}
                </div>
              )}

              {/* Warnings */}
              {minHrsPerDay != null && minHrsPerDay > 12 && !data.overrideSafeguards && (
                <div style={{padding:"8px 12px",borderRadius:8,background:minHrsPerDay>MAX_STUDY_HRS?T.redD:T.orangeD,border:`1px solid ${minHrsPerDay>MAX_STUDY_HRS?T.red:T.orange}33`,fontSize:fs(11),color:minHrsPerDay>MAX_STUDY_HRS?T.red:T.orange,marginBottom:10}}>
                  {minHrsPerDay > MAX_STUDY_HRS
                    ? `🚨 Infeasible: ${minHrsPerDay}h/day needed — exceeds ${MAX_STUDY_HRS}h max. Remove days off, extend target, or enable override.`
                    : `⚠️ Tight: ${minHrsPerDay}h/day needed. Consider removing exception dates.`}
                </div>
              )}
              {data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS && (
                <div style={{padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:10}}>
                  ⚠️ Override active — {minHrsPerDay}h/day required. Safeguards disabled at your request.
                </div>
              )}

              {/* Validation checks */}
              {(() => {
                const warns = [];
                if (hrsPerDay < 2 && totalEstHours > 0) warns.push({c:T.orange,m:`⚠️ ${hrsPerDay}h/day is very low. Most WGU students need 3-6h/day.`});
                if (hrsPerDay > 12 && hrsPerDay <= MAX_STUDY_HRS) warns.push({c:T.orange,m:`⚠️ ${hrsPerDay}h/day is extremely high. Risk of burnout.`});
                if (data.targetCompletionDate && data.targetDate && data.targetCompletionDate > data.targetDate) warns.push({c:T.red,m:"🚨 Target completion is AFTER term end."});
                if (data.studyStartDate && data.targetCompletionDate && data.studyStartDate >= data.targetCompletionDate) warns.push({c:T.red,m:"🚨 Start date on or after completion — no study days."});
                if (data.studyStartDate && data.studyStartDate > todayStr()) warns.push({c:T.blue,m:`ℹ️ Start date is in the future.`});
                // Est. finish vs term end
                if (estCompletionDate && data.targetDate && estCompletionDate > data.targetDate) {
                  const overDays = diffDays(data.targetDate, estCompletionDate);
                  warns.push({c:T.red,m:`🚨 Estimated finish (${new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) is ${overDays} day${overDays>1?"s":""} past your term end. Increase hours/day, remove days off, or extend your term.`});
                } else if (estCompletionDate && data.targetCompletionDate && estCompletionDate > data.targetCompletionDate) {
                  const overDays = diffDays(data.targetCompletionDate, estCompletionDate);
                  warns.push({c:T.orange,m:`⚠️ Estimated finish (${new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) is ${overDays} day${overDays>1?"s":""} past your target completion.`});
                }
                const studyDaysAvail = effectiveTarget && startDate ? calcStudyDays(startDate, effectiveTarget) : null;
                const totalCalDays = effectiveTarget && startDate ? diffDays(startDate, effectiveTarget) : null;
                if (studyDaysAvail != null && totalCalDays != null && totalCalDays > 0) {
                  const offPct = Math.round((1 - studyDaysAvail / totalCalDays) * 100);
                  if (offPct > 60) warns.push({c:T.red,m:`🚨 ${offPct}% of calendar is days off. Only ${studyDaysAvail} study days.`});
                }
                if (warns.length === 0) return null;
                return <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:10}}>{warns.map((w,i) => <div key={i} style={{padding:"6px 12px",borderRadius:7,background:`${w.c}11`,border:`1px solid ${w.c}33`,fontSize:fs(10),color:w.c}}>{w.m}</div>)}</div>;
              })()}
            </div>

            {/* Divider */}
            <div style={{borderTop:`1px solid ${T.border}`,marginBottom:16}}/>

            {/* Section B: Estimate Hours */}
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontSize:fs(12),fontWeight:700,color:T.text,display:"flex",alignItems:"center",gap:6}}>
                  ⏱ Estimate Study Hours
                  {allHaveHours && <Badge color={T.accent} bg={T.accentD}>✓</Badge>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  {isEstimating && getBgState().abortCtrl && (
                    <Btn small v="ghost" onClick={()=>{getBgState().abortCtrl?.abort();bgSet({loading:false,regenId:null,label:""});toast("Estimation stopped","info")}} style={{color:T.red,borderColor:T.red}}>Stop</Btn>
                  )}
                  <Btn v={allHaveHours?"secondary":"ai"} onClick={estimateHours} disabled={bg.loading||!profile||allHaveHours}>
                    {isEstimating?<><Ic.Spin s={14}/> Estimating...</>:allHaveHours?"All Estimated ✓":"Estimate Hours"}
                  </Btn>
                </div>
              </div>
              <div style={{fontSize:fs(11),color:T.soft,marginBottom:8}}>{allHaveHours ? `All ${courses.filter(c=>c.status!=="completed").length} courses have hour estimates` : `${needsHours.length} course${needsHours.length>1?"s":""} need AI-powered hour estimates`}</div>
              {(needsHours.length > 0 || isEstimating) && (
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
                  {courses.filter(c=>c.status!=="completed").map(c => (
                    <span key={c.id} style={{fontSize:fs(10),padding:"3px 9px",borderRadius:5,fontWeight:600,
                      background:c.averageStudyHours>0?T.accentD:(isEstimating&&bg.regenId===c.id)?T.purpleD:T.input,
                      color:c.averageStudyHours>0?T.accent:(isEstimating&&bg.regenId===c.id)?T.purple:T.dim,
                    }}>{(isEstimating&&bg.regenId===c.id)?"⏳ ":""}{c.courseCode||c.name.slice(0,12)} {c.averageStudyHours>0?`${c.averageStudyHours}h ✓`:"—"}</span>
                  ))}
                </div>
              )}
            </div>
            {activeStep===2 && <AIActivity/>}
          </StepHead>
        );
      })()}

      {/* Estimates (compact) */}
      {activeCourses.length > 0 && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:16}}>
          {[
            {l:"Est. Hours",v:totalEstHours,c:T.purple,sub:`${activeCourses.length} courses`},
            {l:"Est. Days",v:rawDaysNeeded,c:T.blue,sub:`at ${hrsPerDay}h/day`},
            {l:"Est. Finish",v:estCompletionDate?new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})+" '"+new Date(estCompletionDate+"T12:00:00").getFullYear().toString().slice(2):"—",c:estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate?T.red:estCompletionDate&&effectiveTarget&&estCompletionDate>effectiveTarget?T.orange:T.accent,sub:estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate?"⚠ past term end":effectiveDaysLeft!=null?`${effectiveDaysLeft}d to goal`:"set target"},
            {l:"Min Hrs/Day",v:minHrsPerDay!=null?(!data.overrideSafeguards&&minHrsPerDay>MAX_STUDY_HRS?"❌":minHrsPerDay):"—",c:minHrsPerDay!=null&&!data.overrideSafeguards&&minHrsPerDay>MAX_STUDY_HRS?T.red:minHrsPerDay!=null&&minHrsPerDay>12?T.red:minHrsPerDay!=null&&minHrsPerDay>8?T.orange:T.accent,sub:minHrsPerDay!=null&&!data.overrideSafeguards&&minHrsPerDay>MAX_STUDY_HRS?"infeasible":effectiveTarget?"to hit target":"—"},
          ].map((s,i)=>(
            <div key={i} className="sf-stat" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 14px",textAlign:"center"}}>
              <div style={{fontSize:fs(9),color:T.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,marginBottom:4}}>{s.l}</div>
              <div style={{fontSize:fs(22),fontWeight:800,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}</div>
              <div style={{fontSize:fs(9),color:T.dim}}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}
      {!data.overrideSafeguards && minHrsPerDay != null && minHrsPerDay > MAX_STUDY_HRS && <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(12),color:T.red,marginBottom:12,fontWeight:600}}>🚨 Schedule is infeasible — {minHrsPerDay}h/day required but maximum is {MAX_STUDY_HRS}h. Extend your target date, remove days off, or enable override.</div>}
      {!data.overrideSafeguards && estCompletionDate && data.targetDate && estCompletionDate > data.targetDate && (minHrsPerDay==null||minHrsPerDay<=MAX_STUDY_HRS) && <div style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(12),color:T.red,marginBottom:12,fontWeight:600}}>🚨 Estimated finish ({new Date(estCompletionDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) exceeds term end ({new Date(data.targetDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}). Increase hours/day or reduce days off.</div>}
      {minHrsPerDay != null && minHrsPerDay > hrsPerDay && minHrsPerDay <= MAX_STUDY_HRS && <div style={{padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:12}}>You need {minHrsPerDay}h/day to hit your target completion — currently set to {hrsPerDay}h/day.</div>}

      {/* STEP 3: Enrich Courses */}
      {(() => {
        const unenriched = courses.filter(c => c.status!=="completed" && !hasCtx(c));
        const isEnriching = bg.loading && (bg.label||"").toLowerCase().includes("enrich");
        return (
          <StepHead n={3} title="Enrich Courses" done={step3Done} disabled={!step2Done} subtitle={step3Done?`All ${activeCourses.length} courses enriched`:unenriched.length>0?`${unenriched.length} need enrichment`:""}>
            {!profile && <div style={{padding:"8px 12px",borderRadius:8,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:10}}>Connect an AI profile in Settings first.</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:fs(11),color:T.soft}}>{step3Done?"All courses have exam intelligence":"Sequential individual enrichment for reliable, thorough results"}</div>
              <div style={{display:"flex",gap:8}}>
                {isEnriching && getBgState().abortCtrl && (
                  <Btn small v="ghost" onClick={()=>{getBgState().abortCtrl?.abort();bgSet({loading:false,regenId:null,label:""});toast("Enrichment stopped","info")}} style={{color:T.red,borderColor:T.red}}>Stop</Btn>
                )}
                <Btn v={step3Done?"secondary":"ai"} onClick={enrichNew} disabled={bg.loading||!profile||unenriched.length===0}>
                  {isEnriching?<><Ic.Spin s={14}/> Working...</>:step3Done?"All Enriched ✓":"Enrich All New"}
                </Btn>
              </div>
            </div>
            {(isEnriching || unenriched.length > 0) && (
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {courses.filter(c=>c.status!=="completed").map(c => {
                  const enriched = hasCtx(c);
                  const active = bg.regenId === c.id;
                  return (
                    <span key={c.id} style={{fontSize:fs(9),padding:"3px 8px",borderRadius:5,fontWeight:600,
                      background:active?T.purpleD:enriched?T.accentD:T.input,
                      color:active?T.purple:enriched?T.accent:T.dim,
                    }}>{active?"⏳ ":""}{c.courseCode||c.name.slice(0,15)}{enriched?" ✓":""}</span>
                  );
                })}
              </div>
            )}
            {activeStep===3 && <AIActivity/>}
          </StepHead>
        );
      })()}

      {/* Course List */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:fs(14),fontWeight:700}}>Courses ({courses.length})</h3>
        <div style={{display:"flex",gap:6}}>
          <Btn small v="ai" onClick={regenAll} disabled={bg.loading||!profile||activeCourses.length===0}>Regenerate All</Btn>
          <Btn small v="ghost" onClick={()=>setExpanded(courses.reduce((a,c)=>({...a,[c.id]:true}),{}))}>Expand</Btn>
          <Btn small v="ghost" onClick={()=>setExpanded({})}>Collapse</Btn>
        </div>
      </div>

      {courses.length===0?<div style={{padding:"30px 0",textAlign:"center",color:T.dim,fontSize:fs(13)}}>No courses yet. Import a degree plan or add manually.</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:16}}>
          {courses.map((c,i)=>(
            <div key={c.id} draggable onDragStart={e=>handleDragStart(e,i)} onDragOver={e=>handleDragOver(e,i)} onDragLeave={handleDragLeave} onDrop={e=>handleDrop(e,i)} onDragEnd={handleDragEnd} className="fade sf-card"
              style={{background:dragOverIdx===i?T.purpleD:dragIdx===i?T.input:T.card,border:`1px solid ${dragOverIdx===i?T.purple:T.border}`,borderRadius:12,padding:"10px 14px",opacity:dragIdx===i?0.5:1,cursor:"grab"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <input type="number" min="1" max={courses.length} value={i+1} onChange={e=>setPriority(c.id,e.target.value)} onClick={e=>e.stopPropagation()} style={{width:36,padding:"4px 2px",textAlign:"center",fontSize:fs(13),fontWeight:700,color:c.status==="completed"?T.dim:T.accent,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:6,cursor:"text",fontFamily:"'Outfit',sans-serif"}}/>
                <div style={{width:5,height:40,borderRadius:3,background:STATUS_C[c.status]||T.dim,flexShrink:0}}/>
                <div style={{flex:1,cursor:"pointer",minWidth:0}} onClick={()=>setExpanded(e=>({...e,[c.id]:!e[c.id]}))}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3,flexWrap:"wrap"}}>
                    <span style={{fontSize:fs(13),fontWeight:600}}>{c.name}</span>
                    <Badge color={STATUS_C[c.status]||T.dim} bg={(STATUS_C[c.status]||T.dim)+"22"}>{STATUS_L[c.status]||c.status}</Badge>
                    {c.assessmentType&&<Badge color={T.blue} bg={T.blueD}>{c.assessmentType}</Badge>}
                    {hasCtx(c)?<Badge color={T.accent} bg={T.accentD}>ENRICHED</Badge>:c.status!=="completed"&&<Badge color={T.orange} bg={T.orangeD}>NEEDS ENRICHMENT</Badge>}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,fontSize:fs(11),color:T.dim,flexWrap:"wrap"}}>
                    <span>{c.credits||0} CU</span>
                    <span>{"★".repeat(c.difficulty||0)}{"☆".repeat(5-(c.difficulty||0))}</span>
                    {c.averageStudyHours>0&&<span>~{c.averageStudyHours}h</span>}
                    <CtxBadge label="Topics" count={safeArr(c.topicBreakdown).length} color={T.purple}/>
                    <CtxBadge label="Terms" count={safeArr(c.keyTermsAndConcepts).length} color={T.blue}/>
                    <CtxBadge label="Tips" count={safeArr(c.examTips).length} color={T.yellow}/>
                  </div>
                </div>
                <div style={{display:"flex",gap:3,flexShrink:0,alignItems:"center"}}>
                  <button onClick={e=>{e.stopPropagation();if(i>0)moveCourse(i,i-1)}} disabled={i===0} style={{background:"none",border:"none",color:i>0?T.soft:T.faint,cursor:i>0?"pointer":"default",padding:2,fontSize:fs(16),lineHeight:1}}>↑</button>
                  <button onClick={e=>{e.stopPropagation();if(i<courses.length-1)moveCourse(i,i+1)}} disabled={i===courses.length-1} style={{background:"none",border:"none",color:i<courses.length-1?T.soft:T.faint,cursor:i<courses.length-1?"pointer":"default",padding:2,fontSize:fs(16),lineHeight:1}}>↓</button>
                  <Btn small v={bg.regenId===c.id?"ai":"ghost"} onClick={()=>regenCourse(c)} disabled={!profile||bg.regenId===c.id||bg.loading}>{bg.regenId===c.id?<Ic.Spin s={12}/>:bg.loading?"—":"🔄"}</Btn>
                  <button onClick={()=>openEdit(c)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Edit/></button>
                  <button onClick={()=>deleteCourse(c.id)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.Trash/></button>
                </div>
              </div>
              {expanded[c.id] && <ErrorBoundary key={c.id+"detail"}><CourseDetail c={c}/></ErrorBoundary>}
            </div>
          ))}
        </div>
      )}

      {/* STEP 4: Generate Study Plan */}
      {(() => {
        const isBusy = bg.loading && !(bg.label||"").toLowerCase().includes("plan");
        const isGenerating = bg.loading && (bg.label||"").toLowerCase().includes("plan");
        return (
        <StepHead n={4} title="Generate Study Plan" done={step4Done} disabled={!step3Done} subtitle={step4Done?`${Object.keys(data.tasks||{}).length} days scheduled`:""}>
          <textarea value={planPrompt} onChange={e=>setPlanPrompt(e.target.value)} disabled={isBusy} placeholder="Optional: Describe your scheduling preferences — e.g. 'I work 9-5 weekdays so only schedule study in evenings and weekends'..." style={{minHeight:45,fontSize:fs(11),marginBottom:10,opacity:isBusy?0.4:1}}/>
          <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:pendingPlan?12:0}}>
              {isGenerating && getBgState().abortCtrl && (
                <Btn small v="ghost" onClick={()=>{getBgState().abortCtrl?.abort();bgSet({loading:false,regenId:null,label:""});toast("Plan generation stopped","info")}} style={{color:T.red,borderColor:T.red}}>⬛ Stop</Btn>
              )}
              <Btn v={isBusy?"secondary":"ai"} onClick={genPlan} disabled={bg.loading||!profile||activeCourses.length===0||(!data.overrideSafeguards&&((minHrsPerDay!=null&&minHrsPerDay>MAX_STUDY_HRS)||(estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate)))}>
                {!data.overrideSafeguards&&minHrsPerDay!=null&&minHrsPerDay>MAX_STUDY_HRS?"Schedule Infeasible":!data.overrideSafeguards&&estCompletionDate&&data.targetDate&&estCompletionDate>data.targetDate?"Exceeds Term End":isGenerating?<><Ic.Spin s={14}/> Generating...</>:isBusy?"Waiting...":"Generate Plan"}
              </Btn>
          </div>
          {pendingPlan && (
            <div style={{marginTop:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <span style={{fontSize:fs(12),color:T.soft}}>{pendingPlan.summary}</span>
                <div style={{display:"flex",gap:8}}>
                  <Btn small v="primary" onClick={confirmPlan}>Confirm</Btn>
                  <Btn small v="ghost" onClick={discardPlan}>Discard</Btn>
                </div>
              </div>
              <div style={{maxHeight:250,overflowY:"auto",display:"flex",flexDirection:"column",gap:2}}>
                {[...new Set(pendingPlan.tasks.map(t=>t.date))].sort().map(dt => (
                  <div key={dt}>
                    <div style={{fontSize:fs(10),fontWeight:700,color:T.accent,padding:"4px 0 2px"}}>{new Date(dt+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})}</div>
                    {pendingPlan.tasks.filter(t=>t.date===dt).map((t,j) => (
                      <div key={j} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 8px",borderRadius:6,background:T.input,marginBottom:2,fontSize:fs(10)}}>
                        <span style={{color:T.blue,minWidth:40,fontFamily:"'JetBrains Mono',monospace"}}>{t.time||"—"}</span>
                        <span style={{flex:1,color:T.text}}>{t.title}</span>
                        {t.endTime&&<span style={{color:T.dim,fontSize:fs(9)}}>→ {t.endTime}</span>}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          {activeStep===4 && <AIActivity/>}
        </StepHead>
        );
      })()}

      {showAdd&&<Modal title={editId?"Edit Course":"Add Course"} onClose={()=>setShowAdd(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div><Label>Course Name</Label><input autoFocus value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="e.g. C779 - Web Development"/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
            <div><Label>Code</Label><input value={form.courseCode} onChange={e=>setForm({...form,courseCode:e.target.value})} placeholder="C779"/></div>
            <div><Label>Credits</Label><input type="number" min="1" max="12" value={form.credits} onChange={e=>setForm({...form,credits:e.target.value})}/></div>
            <div><Label>Difficulty</Label><input type="number" min="1" max="5" value={form.difficulty} onChange={e=>setForm({...form,difficulty:e.target.value})}/></div>
            <div><Label>Assessment</Label><select value={form.assessmentType} onChange={e=>setForm({...form,assessmentType:e.target.value})}><option value="">—</option><option value="OA">OA</option><option value="PA">PA</option><option value="OA+PA">OA+PA</option></select></div>
          </div>
          <div><Label>Status</Label><div style={{display:"flex",gap:4}}>{["not_started","in_progress","completed"].map(s=><button key={s} onClick={()=>setForm({...form,status:s})} style={{flex:1,padding:"8px 0",borderRadius:8,cursor:"pointer",fontSize:fs(11),fontWeight:600,border:`1.5px solid ${form.status===s?(STATUS_C[s]||T.dim):T.border}`,background:form.status===s?(STATUS_C[s]||T.dim)+"22":T.input,color:form.status===s?(STATUS_C[s]||T.dim):T.dim}}>{STATUS_L[s]}</button>)}</div></div>
          <div><Label>Topics</Label><input value={form.topics||""} onChange={e=>setForm({...form,topics:e.target.value})} placeholder="HTML, CSS..."/></div>
          <div><Label>Notes</Label><input value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Tips..."/></div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}><Btn v="secondary" onClick={()=>setShowAdd(false)}>Cancel</Btn><Btn onClick={saveCourse} disabled={!form.name.trim()}>{editId?"Update":"Add"}</Btn></div>
        </div>
      </Modal>}
    </div>
  );
};

export { CoursePlanner };
export default CoursePlanner;
