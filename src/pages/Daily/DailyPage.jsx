import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, pad, fmtTime, parseTime, minsToStr, nowMins, uid, fmtDateLong, diffDays } from "../../utils/helpers.js";
import { findNextUndonePlanTask, pullTaskToToday } from "../../utils/courseLifecycle.js";
import { getCAT, AI_CATS, STUDY_CATS, getPRIO, getSTATUS_C, STATUS_L } from "../../constants/categories.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { timerStart, timerStop, timerPause, useTimer, fmtElapsed } from "../../systems/timer.js";
import { focusStart, focusStop, useFocus } from "../../systems/focus.js";
import { buildSystemPrompt, runAILoop, APP_VERSION, callAIWithTools, continueAfterTools } from "../../systems/api.js";
import { useBgTask, bgSet, bgClear, bgAbort } from "../../systems/background.js";
import { executeTools, safeArr } from "../../utils/toolExecution.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { BufferedInput } from "../../components/ui/BufferedInput.jsx";
import { ProgressBar } from "../../components/ui/ProgressBar.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { Label } from "../../components/ui/Label.jsx";
import { SortableList, SortableItem } from "../../components/ui/SortableList.jsx";
import { ProgressHeader, useDayProgress } from "../../components/daily/ProgressHeader.jsx";
import { NowStrip } from "../../components/daily/NowStrip.jsx";
import { DayTimeline } from "../../components/daily/DayTimeline.jsx";
import { FocusMode } from "../../components/daily/FocusMode.jsx";
import { AIAssistBar } from "../../components/daily/AIAssistBar.jsx";
import { pushUndoSnapshot, undo, redo, useUndoState } from "../../systems/undoStack.js";
import { shiftUndoneTasks, detectUndoneTasks } from "../../utils/scheduleShift.js";

const DailyPage=({date,tasks,setTasks,profile,data,setData,setDate,setPage})=>{
  const T = useTheme();
  const CAT = getCAT(T);
  const PRIO = getPRIO(T);
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const _timerState = useTimer();
  const[showAdd,setShowAdd]=useState(false);
  const[editId,setEditId]=useState(null);
  const[form,setForm]=useState({time:"09:00",endTime:"09:30",title:"",category:"study",priority:"medium",notes:"",recurring:""});
  const[aiPrompt,setAiPrompt]=useState("");
  const[aiLoading,setAiLoading]=useState(false);
  const[aiLog,setAiLog]=useState([]);
  const[aiAbort,setAiAbort]=useState(null);
  const[reschedScope,setReschedScope]=useState("day");
  const[reschedMonths,setReschedMonths]=useState(1);
  const[now,setNow]=useState(nowMins());
  const[view,setView]=useState("day"); // "day" or "week"
  const[catFilter,setCatFilter]=useState("all");
  const[showTemplates,setShowTemplates]=useState(false);
  const[manualOrder,setManualOrder]=useState(null); // array of task ids when user has manually reordered
  const[expandedWeekDays,setExpandedWeekDays]=useState({});
  const[dayView,setDayView]=useState('list'); // 'list' or 'timeline'
  const[showAIPlanner,setShowAIPlanner]=useState(false); // collapsed by default
  const[focusTaskId,setFocusTaskId]=useState(null); // active task in focus mode
  const[expandedTaskId,setExpandedTaskId]=useState(null); // queue task detail expansion
  const[activeTimerId,setActiveTimerId]=useState(null); // task with running timer
  const[timerRemaining,setTimerRemaining]=useState(0); // seconds remaining
  const[timerPaused,setTimerPaused]=useState(false);
  const timerRef=useRef(null);
  const undoState = useUndoState();
  const isToday=date===todayStr();

  // ── Task timer logic ──
  const playTimerSound = useCallback(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      // Play a pleasant chime: two ascending tones
      [440, 554, 659].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.2);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.2 + 0.5);
        osc.start(ctx.currentTime + i * 0.2);
        osc.stop(ctx.currentTime + i * 0.2 + 0.5);
      });
    } catch (_) {}
  }, []);
  const startTimer = useCallback((taskId, mins) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setActiveTimerId(taskId);
    setTimerRemaining(mins * 60);
    setTimerPaused(false);
  }, []);
  const pauseTimer = useCallback(() => setTimerPaused(p => !p), []);
  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setActiveTimerId(null); setTimerRemaining(0); setTimerPaused(false);
  }, []);
  // Tick the timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!activeTimerId || timerPaused) return;
    timerRef.current = setInterval(() => {
      setTimerRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          playTimerSound();
          toast('Timer complete!', 'success');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeTimerId, timerPaused, playTimerSound]);
  const dayProgress = useDayProgress(tasks, data);
  useEffect(()=>{const iv=setInterval(()=>setNow(nowMins()),30000);return()=>clearInterval(iv)},[]);
  // Reset manual order when date changes
  useEffect(()=>{setManualOrder(null)},[date]);

  // Week dates starting from current date's Monday
  const getWeekDates = (d) => {
    const dt = new Date(d+"T12:00:00");
    const day = dt.getDay();
    const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
    return Array.from({length:7}, (_,i) => { const x = new Date(mon); x.setDate(mon.getDate()+i); return x.toISOString().split("T")[0]; });
  };
  const weekDates = useMemo(() => getWeekDates(date), [date]);

  const sorted=useMemo(()=>{
    if(manualOrder){
      const orderMap=new Map(manualOrder.map((id,i)=>[id,i]));
      return [...tasks].sort((a,b)=>(orderMap.get(a.id)??9999)-(orderMap.get(b.id)??9999));
    }
    return [...tasks].sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
  },[tasks,manualOrder]);
  const filtered = catFilter === "all" ? sorted : sorted.filter(t => t.category === catFilter);
  const completed=tasks.filter(t=>t.done).length;
  const currentId=useMemo(()=>{if(!isToday)return null;for(const t of sorted){const s=parseTime(t.time),e=parseTime(t.endTime);if(s&&e&&now>=s.mins&&now<e.mins&&!t.done)return t.id}return null},[sorted,now,isToday]);

  // Time conflict detection
  const conflicts = useMemo(() => {
    const c = new Set();
    for (let i=0; i<sorted.length; i++) {
      const a = sorted[i], as = parseTime(a.time), ae = parseTime(a.endTime);
      if(!as||!ae) continue;
      for (let j=i+1; j<sorted.length; j++) {
        const b = sorted[j], bs = parseTime(b.time), be = parseTime(b.endTime);
        if(!bs||!be) continue;
        if(as.mins < be.mins && ae.mins > bs.mins) { c.add(a.id); c.add(b.id); }
      }
    }
    return c;
  }, [sorted]);

  // Pomodoro via global timer (survives navigation)
  const pomActive = _timerState.running && (_timerState.taskTitle === 'Pomodoro Focus' || _timerState.taskTitle === 'Break');
  const pomBreak = _timerState.running && _timerState.taskTitle === 'Break';
  const pomTimeSec = pomActive ? Math.ceil(_timerState.remaining / 1000) : 25 * 60;

  // Auto-start break when Pomodoro focus finishes, notify when break finishes
  const prevFinishedTitle = useRef(null);
  useEffect(() => {
    if (_timerState.finished && _timerState.taskTitle !== prevFinishedTitle.current) {
      prevFinishedTitle.current = _timerState.taskTitle;
      if (_timerState.taskTitle === 'Pomodoro Focus') {
        // Small delay to let timerStop() complete before starting new timer
        setTimeout(() => timerStart('Break', '', 5), 100);
      } else if (_timerState.taskTitle === 'Break') {
        toast("Break over! Back to work.", "info");
      }
    }
    if (!_timerState.finished) prevFinishedTitle.current = null;
  }, [_timerState.finished, _timerState.taskTitle]);

  const pomToggle = () => { if(pomActive) { timerStop(); } else timerStart('Pomodoro Focus', '', 25); };
  const pomReset = () => { if(pomActive) timerStop(); };

  // Task templates
  const TEMPLATES = [
    {name:"Study Day", tasks:[{time:"08:00",endTime:"08:30",title:"Morning review",category:"study",priority:"medium"},{time:"08:30",endTime:"11:30",title:"Deep study session",category:"study",priority:"high"},{time:"11:30",endTime:"12:00",title:"Break & stretch",category:"break",priority:"low"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"15:00",title:"Afternoon study",category:"study",priority:"high"},{time:"15:00",endTime:"15:30",title:"Exercise",category:"health",priority:"medium"},{time:"15:30",endTime:"17:00",title:"Practice problems / review",category:"study",priority:"medium"}]},
    {name:"Light Day", tasks:[{time:"09:00",endTime:"10:30",title:"Study session",category:"study",priority:"medium"},{time:"10:30",endTime:"11:00",title:"Break",category:"break",priority:"low"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"14:00",endTime:"15:00",title:"Light review",category:"study",priority:"low"},{time:"17:00",endTime:"18:00",title:"Exercise",category:"health",priority:"medium"}]},
    {name:"Exam Prep", tasks:[{time:"07:00",endTime:"07:30",title:"Quick review of weak areas",category:"review",priority:"high"},{time:"08:00",endTime:"10:00",title:"Practice exam #1",category:"exam-prep",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"12:15",title:"Practice exam #2",category:"exam-prep",priority:"high"},{time:"12:15",endTime:"12:45",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"15:00",title:"Review missed questions",category:"review",priority:"high"},{time:"15:00",endTime:"16:00",title:"Final flashcard review",category:"review",priority:"medium"}]},
    {name:"Balanced Day", tasks:[{time:"06:30",endTime:"07:30",title:"Morning exercise",category:"health",priority:"medium"},{time:"08:00",endTime:"10:00",title:"Study block 1",category:"study",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"12:00",title:"Study block 2",category:"study",priority:"high"},{time:"12:00",endTime:"13:00",title:"Lunch & rest",category:"personal",priority:"medium"},{time:"13:00",endTime:"14:30",title:"Study block 3",category:"study",priority:"medium"},{time:"14:30",endTime:"15:00",title:"Break",category:"break",priority:"low"},{time:"15:00",endTime:"16:00",title:"Personal tasks / errands",category:"personal",priority:"medium"},{time:"17:00",endTime:"18:00",title:"Light review",category:"review",priority:"low"}]},
    {name:"Exam Day", tasks:[{time:"07:00",endTime:"07:45",title:"Light review of key concepts",category:"review",priority:"high"},{time:"07:45",endTime:"08:00",title:"Pre-exam prep (quiet, water, deep breaths)",category:"break",priority:"medium"},{time:"08:00",endTime:"10:00",title:"\🎯 Exam",category:"exam-day",priority:"high",notes:"Take your time. Flag questions you're unsure about and return to them."},{time:"10:00",endTime:"10:30",title:"Post-exam break & decompress",category:"break",priority:"medium"},{time:"10:30",endTime:"11:00",title:"Review results & celebrate",category:"personal",priority:"low"}]},
    {name:"Project Submission Day", tasks:[{time:"08:00",endTime:"10:00",title:"Final project review & polish",category:"project",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"11:15",title:"Rubric self-check (every section)",category:"project",priority:"high"},{time:"11:15",endTime:"12:00",title:"Proofread & format",category:"project",priority:"high"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"13:30",title:"\🎯 Submit Project",category:"exam-day",priority:"high",notes:"Double-check all files are attached and sections are complete."},{time:"13:30",endTime:"14:00",title:"Celebrate & plan next course",category:"personal",priority:"low"}]},
  ];
  const applyTemplate = (tmpl) => {
    const newTasks = tmpl.tasks.map(t => ({...t, id:uid(), done:false, notes:"", recurring:""}));
    setTasks([...tasks, ...newTasks]);
    setShowTemplates(false);
    toast(`Template "${tmpl.name}" applied: ${newTasks.length} tasks added`, "success");
  };

  // Drag-to-reorder tasks via @dnd-kit
  const handleTaskReorder = (reorderedList) => {
    setManualOrder(reorderedList.map(t => t.id));
    toast('Tasks reordered', 'info');
  };

  // Smart carryforward: incomplete tasks from yesterday
  const yesterdayStr = useMemo(() => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; }, []);
  const carryTasks = useMemo(() => {
    if(!isToday) return [];
    // Expanded: all categories (not just study), look back up to 3 days
    const lookback = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const incomplete = safeArr(data.tasks?.[ds]).filter(t => !t.done && t.category !== 'break');
      lookback.push(...incomplete.map(t => ({ ...t, fromDate: ds })));
    }
    return lookback;
  }, [data.tasks, isToday]);
  const carryForward = (task) => {
    setTasks([...tasks, {...task, id:uid(), done:false}]);
    toast(`Carried forward: ${task.title}`, "info");
  };
  const carryAll = () => {
    pushUndoSnapshot(`Carry ${carryTasks.length} tasks forward`, data.tasks);
    const newTasks = carryTasks.map(t => ({...t, id:uid(), done:false}));
    setTasks([...tasks, ...newTasks]);
    toast(`${newTasks.length} task(s) carried forward`, "info");
  };

  // Schedule shift: move undone tasks from a date to future available days
  const handleShiftDay = (sourceDate) => {
    pushUndoSnapshot(`Shift tasks from ${sourceDate}`, data.tasks);
    const pc = data.plannerConfig;
    const exDts = safeArr(data.exceptionDates);
    const fixedExams = {};
    for (const c of (data.courses || [])) { if (c.examDate) fixedExams[c.courseCode || c.name] = c.examDate; }
    const { updatedTasks, shiftedCount, summary, warnings } = shiftUndoneTasks(data.tasks, sourceDate, pc, exDts, { fixedExamDates: fixedExams });
    setData(d => ({ ...d, tasks: updatedTasks }));
    toast(summary, shiftedCount > 0 ? 'success' : 'info');
    for (const w of warnings) toast(w, 'warn');
  };

  const openAdd=(cat)=>{setForm({time:"09:00",endTime:"09:30",title:"",category:cat||"study",priority:"medium",notes:"",recurring:""});setEditId(null);setShowAdd(true)};
  const openEdit=(t)=>{setForm({...t,recurring:t.recurring||""});setEditId(t.id);setShowAdd(true)};
  const saveTask=()=>{
    if(!form.title.trim())return;
    const taskData = {...form};
    delete taskData.moveToDate; // don't persist the move field on the task
    delete taskData.fromDate; // clean up carry-forward metadata
    if(editId){
      // Handle move-to-date: remove from current day, add to target day
      if (form.moveToDate && form.moveToDate !== date) {
        setTasks(tasks.filter(t => t.id !== editId));
        setData(d => {
          const targetTasks = safeArr(d.tasks?.[form.moveToDate]);
          return { ...d, tasks: { ...d.tasks, [form.moveToDate]: [...targetTasks, { ...taskData, id: editId, done: false }] } };
        });
        toast(`Task moved to ${new Date(form.moveToDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}`, 'success');
        setShowAdd(false);
        return;
      }
      setTasks(tasks.map(t=>t.id===editId?{...t,...taskData}:t));
    } else {
      setTasks([...tasks,{...taskData,id:uid(),done:false}]);
      // Handle recurring — create copies on future dates
      if(form.recurring && form.recurring !== "") {
        const copies = [];
        const maxDays = form.recurring === "daily" ? 30 : form.recurring === "weekdays" ? 22 : form.recurring === "weekly" ? 12 : 0;
        let d = new Date(date+"T12:00:00");
        for(let i=0; i<maxDays; i++) {
          d.setDate(d.getDate() + (form.recurring === "weekly" ? 7 : 1));
          const ds = d.toISOString().split("T")[0];
          const dow = d.getDay();
          if(form.recurring === "weekdays" && (dow === 0 || dow === 6)) continue;
          copies.push({ds, task:{...taskData, id:uid(), done:false}});
        }
        if(copies.length > 0) {
          setData(prev => {
            const t = {...prev.tasks};
            copies.forEach(c => { if(!t[c.ds]) t[c.ds] = []; t[c.ds] = [...t[c.ds], c.task]; });
            return {...prev, tasks: t};
          });
          toast(`Recurring: +${copies.length} future tasks created`, "info");
        }
      }
    }
    setShowAdd(false);
  };
  const toggleTask = (id) => {
    const task = tasks.find(t => t.id === id);
    const wasDone = task?.done;
    setTasks(tasks.map(t => t.id === id ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : null } : t));
    if (!wasDone) {
      // Just marked done — show undo option
      toast(`Task completed. Tap to undo.`, 'success');
    }
  };
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const deleteTask = (id) => {
    const task = tasks.find(t => t.id === id);
    // Plan tasks require 2-step confirmation
    if (task?.planId && deleteConfirmId !== id) {
      setDeleteConfirmId(id);
      return;
    }
    pushUndoSnapshot(`Delete: ${task?.title || 'task'}`, data.tasks);
    setTasks(tasks.filter(t => t.id !== id));
    setDeleteConfirmId(null);
    toast(`Deleted "${task?.title?.slice(0, 30) || 'task'}". Press Ctrl+Z to undo.`, 'info');
  };

  const [showRestructure, setShowRestructure] = useState(null);
  const completeEarly = (task) => {
    if (!isToday || task.done) return;
    const nowT = nowMins();
    const end = parseTime(task.endTime);
    const savedMins = end ? Math.max(0, end.mins - nowT) : 0;
    setTasks(tasks.map(t => t.id === task.id ? {...t, done: true} : t));
    if (_timerState.running && _timerState.taskTitle === task.title) timerStop();
    toast(`Completed: ${task.title}${savedMins > 0 ? ` (${minsToStr(savedMins)} early)` : ""}`, "success");
    if (savedMins >= 5) setShowRestructure({ taskId: task.id, savedMins });
  };

  const restructureTasks = (savedMins) => {
    if (!showRestructure) return;
    const doneIdx = sorted.findIndex(t => t.id === showRestructure.taskId);
    if (doneIdx < 0) { setShowRestructure(null); return; }
    const afterTasks = sorted.slice(doneIdx + 1).filter(t => !t.done);
    const updatedTasks = tasks.map(t => {
      const match = afterTasks.find(at => at.id === t.id);
      if (!match) return t;
      const s = parseTime(t.time), e = parseTime(t.endTime);
      if (!s || !e) return t;
      const newStart = Math.max(0, s.mins - savedMins), newEnd = Math.max(newStart + 1, e.mins - savedMins);
      return { ...t, time: `${pad(Math.floor(newStart/60))}:${pad(newStart%60)}`, endTime: `${pad(Math.floor(newEnd/60))}:${pad(newEnd%60)}` };
    });
    setTasks(updatedTasks);
    toast(`Shifted ${afterTasks.length} task(s) earlier by ${minsToStr(savedMins)}`, "success");
    setShowRestructure(null);
  };

  const stopAI = () => { if(aiAbort) { aiAbort.abort(); setAiAbort(null); setAiLoading(false); toast("Cancelled","info"); } };

  const generateAI=async(preset, freeformPrompt = null)=>{
    if(!profile)return;
    const controller = new AbortController();
    setAiAbort(controller);
    setAiLoading(true);
    const logs = [];

    // Build date range for reschedule scopes
    const getDateRange = (scope) => {
      const start = new Date(date+"T12:00:00");
      const end = new Date(start);
      if(scope==="day") { /* single day */ }
      else if(scope==="week") end.setDate(end.getDate()+6);
      else if(scope==="month") end.setMonth(end.getMonth()+1);
      else if(scope==="custom") end.setMonth(end.getMonth()+(reschedMonths||1));
      const dates = [];
      const d = new Date(start);
      while(d<=end) { dates.push(d.toISOString().split("T")[0]); d.setDate(d.getDate()+1); }
      return dates;
    };

    const activeCourseNames = (data.courses||[]).filter(c=>c.status!=="completed").map((c,i)=>`${i+1}. ${c.name} (~${c.averageStudyHours||"?"}h est)`).join(", ");
    const existingToday = safeArr(data.tasks?.[date]).map(t=>`${t.time}-${t.endTime} ${t.title} [${t.done?"done":"pending"}]`).join("; ");
    const todayCtx = existingToday ? `\nExisting tasks today: ${existingToday}` : "\nNo existing tasks today.";
    // Derive start time from weekly availability or fall back to legacy
    const derivedStart = (() => {
      const pc = data.plannerConfig;
      if (!pc?.weeklyAvailability) return data.studyStartTime || '';
      const dow = new Date(date + 'T12:00:00').getDay();
      const day = pc.weeklyAvailability[dow];
      if (day?.available && day.windows?.length) return day.windows[0].start;
      // Fall back to earliest across all days
      let earliest = '';
      for (let d = 0; d < 7; d++) {
        const dy = pc.weeklyAvailability[d];
        if (dy?.available && dy.windows?.length && (!earliest || dy.windows[0].start < earliest)) earliest = dy.windows[0].start;
      }
      return earliest || data.studyStartTime || '';
    })();
    const startCtx = derivedStart ? ` Start time: ${derivedStart}.` : "";

    const presets = {
      school: `Plan my study sessions for ${fmtDateLong(date)}. Courses (priority order): ${activeCourseNames}. ${data.studyHoursPerDay||4}h of study.${startCtx}${todayCtx}\nInclude study blocks (1-2h max) with 10-15 min breaks between them. Use specific course names and topics in titles.`,
      life: `Plan my personal day for ${fmtDateLong(date)}.${startCtx}${todayCtx}\nInclude meals (breakfast, lunch, dinner), exercise/walk, errands, and relaxation time. Keep it realistic and balanced.`,
      full: `Plan my full day for ${fmtDateLong(date)}. Courses: ${activeCourseNames}. ${data.studyHoursPerDay||4}h study target.${startCtx}${todayCtx}\nBalance study sessions with personal tasks: meals, exercise, breaks. Study blocks 1-2h max with breaks between. Use specific course names in titles.`,
      week: `Plan my entire week starting ${fmtDateLong(date)} (${weekDates[0]} to ${weekDates[6]}). Courses: ${activeCourseNames}. ${data.studyHoursPerDay||4}h/day study target.${startCtx}\nFor each day create study sessions with breaks, meals, and personal time. Use specific course names and topics. Create tasks for ALL 7 days.`,
      reschedule: (() => {
        const rangeDates = getDateRange(reschedScope);
        const scopeLabel = reschedScope==="day"?"today":reschedScope==="week"?"this week":reschedScope==="month"?"this month":`the next ${reschedMonths} month(s)`;
        const existingTasks = rangeDates.flatMap(d => safeArr(data.tasks?.[d]).map(t=>({...t,date:d})));
        const taskSummary = existingTasks.length > 0 ? `Current schedule (${existingTasks.length} tasks):\n${existingTasks.slice(0,40).map(t=>`  ${t.date} ${t.time||"--:--"}-${t.endTime||"?"} ${t.done?"\u2705":"\u2B1C"} ${t.title} [${t.category}]`).join("\n")}${existingTasks.length>40?`\n  ...and ${existingTasks.length-40} more`:""}` : "No existing tasks in this range.";
        const userInstructions = aiPrompt.trim();
        return `Reschedule my calendar for ${scopeLabel} (${rangeDates[0]} to ${rangeDates[rangeDates.length-1]}).

${taskSummary}

${userInstructions ? `INSTRUCTIONS: ${userInstructions}` : "Optimize the schedule \u2014 balance study, personal time, and breaks. Keep study blocks 1-2h with breaks between."}

RULES: Use add_tasks to create new tasks. Keep any tasks the user didn't mention. Each task needs date, time, endTime (24h format), title, and category.`;
      })(),
    };
    const msg = freeformPrompt ? `${freeformPrompt}\n\nContext: Date is ${fmtDateLong(date)}. Courses: ${activeCourseNames}.${startCtx}${todayCtx}\nUse add_tasks to create or modify tasks. Each task needs date "${date}", time (24h), endTime, title, and category.` : preset ? (typeof presets[preset]==="function"?presets[preset]():presets[preset]) : (aiPrompt.trim()||presets.full);
    logs.push({type:"user",content:msg});
    setAiLog([...logs]);
    const dateCtx = view === "week" ? `The user is viewing the week of ${weekDates[0]} to ${weekDates[6]}. Create tasks across multiple days.` : `The user is viewing the study schedule for ${fmtDateLong(date)}. When adding tasks, use date "${date}".`;
    const sys = buildSystemPrompt(data, dateCtx);
    try {
      let resp = await callAIWithTools(profile, sys, [{role:"user",content:msg}]);
      let maxLoops = 5;
      while (maxLoops-- > 0) {
        if (controller.signal.aborted) { logs.push({type:"error",content:"Cancelled"}); break; }
        if (resp.text) logs.push({type:"text",content:resp.text});
        if (resp.toolCalls.length > 0) {
          for (const tc of resp.toolCalls) logs.push({type:"tool_call",content:`\🔧 ${tc.name}(${JSON.stringify(tc.input).slice(0,200)}...)`});
          setAiLog([...logs]);
          const results = executeTools(resp.toolCalls, data, setData);
          for (const r of results) logs.push({type:"tool_result",content:`\u2705 ${r.result}`});
          setAiLog([...logs]);
          resp = await continueAfterTools(profile, sys, [{role:"user",content:msg}], resp.toolCalls, results);
        } else break;
      }
      if (resp.text && !logs.find(l=>l.content===resp.text)) logs.push({type:"text",content:resp.text});
    } catch(e) {
      if(e.message!=='Cancelled') logs.push({type:"error",content:e.message});
    }
    setAiLog([...logs]);
    setAiLoading(false);
    setAiAbort(null);
  };

  // Week view task renderer
  const renderWeekView = () => (
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6}}>
      {weekDates.map(d => {
        const dayTasks = safeArr(data.tasks?.[d]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
        const isT = d === todayStr();
        const done = dayTasks.filter(t=>t.done).length;
        const isExpanded = expandedWeekDays[d];
        const visibleTasks = isExpanded ? dayTasks : dayTasks.slice(0,6);
        const hasMore = dayTasks.length > 6;
        return (
          <div key={d} className="sf-card" style={{background:isT?T.accentD:T.card,border:`1.5px solid ${isT?T.accent+"44":T.border}`,borderRadius:12,padding:10,minHeight:120,cursor:"pointer"}} onClick={()=>{setDate(d);setView("day")}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:fs(10),fontWeight:700,color:isT?T.accent:T.soft}}>{new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",day:"numeric"})}</div>
              {dayTasks.length>0&&<span style={{fontSize:fs(8),color:T.dim}}>{done}/{dayTasks.length}</span>}
            </div>
            {visibleTasks.map(t => {
              const c = CAT[t.category]||CAT.other;
              return (
                <div key={t.id} style={{fontSize:fs(9),padding:"3px 5px",borderRadius:4,marginBottom:2,background:t.done?T.bg2:c.bg,color:t.done?T.dim:c.fg,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none",cursor:"pointer"}}>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",marginRight:3}}>{t.time?.slice(0,5)||""}</span>{t.title}
                </div>
              );
            })}
            {hasMore && (
              <button onClick={()=>setExpandedWeekDays(p=>({...p,[d]:!p[d]}))} style={{width:"100%",background:"none",border:"none",cursor:"pointer",fontSize:fs(9),color:T.accent,textAlign:"center",padding:"4px 0",fontWeight:600}}>
                {isExpanded ? "Show less \u25B2" : `+${dayTasks.length-6} more \u25BC`}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  // Task card renderer — used inside SortableItem
  const renderTaskCard = (t) => {
    // Ghost placeholder for pulled tasks
    if (t._ghost) {
      const s = parseTime(t.time);
      return (<div className="fade" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: T.input, border: `1px dashed ${T.border}`, borderRadius: 10, opacity: 0.4, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: fs(11), color: T.dim }}>{s ? fmtTime(s.h, s.m) : '—'}</span>
        <span style={{ fontSize: fs(10), color: T.dim, fontStyle: 'italic', flex: 1 }}>{t.title}</span>
        <span style={{ fontSize: fs(9), color: T.accent }}>Pulled to {t._pulledTo === todayStr() ? 'today' : new Date(t._pulledTo + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}</span>
      </div>);
    }
    const c=CAT[t.category]||CAT.other,s=parseTime(t.time),e=parseTime(t.endTime),dur=s&&e?e.mins-s.mins:null,isCur=t.id===currentId;
    const hasConflict = conflicts.has(t.id);
    const isExamDay = t.category === "exam-day";
    return (<div className="fade sf-task"
      style={{display:"flex",alignItems:"stretch",background:isExamDay?`${c.bg}`:t.done?`${T.input}88`:hasConflict?T.redD:T.card,border:`1.5px solid ${isExamDay?c.fg+"55":hasConflict?T.red+"55":isCur?T.accent+"55":T.border}`,borderRadius:12,overflow:"hidden",opacity:t.done?.5:1,boxShadow:isExamDay?`0 0 16px ${c.fg}18`:isCur?`0 0 20px ${T.accentD}`:"0 1px 4px rgba(0,0,0,.08)"}}>
      <div style={{width:3,background:hasConflict?T.red:c.fg,flexShrink:0}}/>
      <div style={{padding:"10px 14px",minWidth:100,display:"flex",flexDirection:"column",justifyContent:"center",borderRight:`1px solid ${T.border}`}}>
        <span className="mono" style={{fontSize:fs(15),fontWeight:600,color:hasConflict?T.red:isCur?T.accent:T.text}}>{s?fmtTime(s.h,s.m):"\u2014"}</span>
        {e&&<span className="mono" style={{fontSize:fs(12),color:T.dim}}>{'\u2192'} {fmtTime(e.h,e.m)}</span>}
        {dur>0&&<span style={{fontSize:fs(11),color:T.dim,display:"flex",alignItems:"center",gap:2,marginTop:1}}><Ic.Clock/>{minsToStr(dur)}</span>}
        {hasConflict&&<span style={{fontSize:fs(10),color:T.red,fontWeight:700,marginTop:1}}>OVERLAP</span>}
      </div>
      <div style={{flex:1,padding:"10px 14px",display:"flex",flexDirection:"column",justifyContent:"center",gap:3}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:fs(15),fontWeight:500,textDecoration:t.done?"line-through":"none",color:t.done?T.dim:T.text}}>{t.title}</span>
          {isCur&&!t.done&&<span style={{fontSize:fs(10),padding:"2px 6px",borderRadius:4,background:T.accentD,color:T.accent,fontWeight:700}}>NOW</span>}
          {t.planId&&<span style={{fontSize:fs(10),padding:"2px 6px",borderRadius:4,background:T.purpleD,color:T.purple,fontWeight:600}}>PLAN</span>}
          {t.recurring&&<span style={{fontSize:fs(10),padding:"2px 6px",borderRadius:4,background:T.blueD,color:T.blue,fontWeight:600}}>{'\u21BB'} {t.recurring}</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
          <span style={{fontSize:fs(11),color:PRIO[t.priority]||T.soft,fontWeight:600}}>{'\u25CF'} {t.priority}</span>
          {t.notes&&<span style={{fontSize:fs(12),color:T.dim}}>{'\u2014'} {t.notes}</span>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:3,padding:"0 10px"}}>
        {!t.done && isToday && <button className="sf-icon-btn" onClick={()=>completeEarly(t)} title="Complete early" style={{background:"none",border:"none",color:T.accent,cursor:"pointer",padding:5,fontSize:fs(10),fontWeight:600}}>Done \u2713</button>}
        {!t.done && <button className="sf-icon-btn" onClick={()=>{const match=(data.courses||[]).find(c=>t.title.toLowerCase().includes(c.name.toLowerCase().split(" \u2013 ")[0].split(" - ")[0])||(c.courseCode&&t.title.toLowerCase().includes(c.courseCode.toLowerCase())));timerStart(t.title,match?.name||"")}} title="Start timer" style={{background:"none",border:"none",color:_timerState.running&&_timerState.taskTitle===t.title?T.accent:T.dim,cursor:"pointer",padding:5,fontSize:fs(14)}}>⏱</button>}
        {!t.done && setPage && ["study","review","exam-prep"].includes(t.category) && <button className="sf-icon-btn" onClick={()=>setPage("chat")} title="Get Help" style={{background:"none",border:"none",color:T.blue,cursor:"pointer",padding:5,fontSize:fs(13),fontWeight:700}}>?</button>}
        {!t.done && setPage && ["exam-prep","exam-day"].includes(t.category) && <button className="sf-icon-btn" onClick={()=>setPage("quiz")} title="Practice Exam" style={{background:"none",border:"none",cursor:"pointer",padding:"2px 6px",fontSize:fs(9),fontWeight:700,color:T.purple,borderRadius:4}}>PRACTICE</button>}
        <button onClick={()=>toggleTask(t.id)} style={{width:30,height:30,borderRadius:8,border:`2px solid ${t.done?T.accent:T.border}`,background:t.done?T.accentD:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.accent,transition:"all .15s"}}>{t.done&&<Ic.Check s={14}/>}</button>
        <button className="sf-icon-btn" onClick={()=>openEdit(t)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:5}}><Ic.Edit/></button>
        {deleteConfirmId === t.id ? (
          <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <button onClick={() => deleteTask(t.id)} style={{ padding: '4px 10px', borderRadius: 5, border: `1px solid ${T.red}`, background: T.redD, color: T.red, fontSize: fs(11), cursor: 'pointer', fontWeight: 600 }}>Confirm Delete</button>
            <button onClick={() => setDeleteConfirmId(null)} style={{ padding: '4px 8px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.input, color: T.dim, fontSize: fs(11), cursor: 'pointer' }}>Cancel</button>
          </div>
        ) : (
          <button className="sf-icon-btn" onClick={()=>deleteTask(t.id)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:5}}><Ic.Trash/></button>
        )}
      </div>
    </div>);
  };

  // Wrapped task renderer for SortableList — adds SortableItem with drag handle
  const renderTask = (t) => (
    <SortableItem key={t.id} id={t.id} handleColor={T.dim} dragHandleStyle={{borderRadius:'12px 0 0 12px',background:T.input,borderRight:`1px solid ${T.border}`}}>
      {renderTaskCard(t)}
    </SortableItem>
  );

  // Date navigation helpers
  const navDate = (delta) => {
    if (view === "week") {
      const d = new Date(date+"T12:00:00"); d.setDate(d.getDate() + delta * 7); setDate(d.toISOString().split("T")[0]);
    } else {
      const d = new Date(date+"T12:00:00"); d.setDate(d.getDate() + delta); setDate(d.toISOString().split("T")[0]);
    }
  };
  const goToday = () => setDate(todayStr());

  // Focus Mode: find the task and next task
  const focusTask = focusTaskId ? tasks.find(t => t.id === focusTaskId) : null;
  const focusNextTask = focusTask ? sorted.find(t => !t.done && t.id !== focusTaskId && (parseTime(t.time)?.mins || 0) > (parseTime(focusTask.time)?.mins || 0)) : null;

  // Global keyboard shortcuts (outside focus mode)
  useEffect(() => {
    if (focusTaskId) return; // focus mode handles its own shortcuts
    const handler = (e) => {
      // Undo/Redo (works even in inputs)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const restored = undo(data.tasks);
        if (restored) setData(d => ({ ...d, tasks: restored }));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const restored = redo(data.tasks);
        if (restored) setData(d => ({ ...d, tasks: restored }));
        return;
      }
      if (e.target.closest('input,textarea,select')) return;
      if (e.key === 'f' || e.key === 'F') {
        const target = currentId || sorted.find(t => !t.done)?.id;
        if (target) setFocusTaskId(target);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusTaskId, currentId, sorted, data.tasks]);

  // If focus mode active, render it instead of the normal page
  if (focusTask && !focusTask.done) {
    return (
      <FocusMode
        task={focusTask}
        nextTask={focusNextTask}
        courses={data.courses || []}
        onDone={(id) => { toggleTask(id); if (focusNextTask) setFocusTaskId(focusNextTask.id); else setFocusTaskId(null); }}
        onExit={() => { setFocusTaskId(null); }}
      />
    );
  }

  return(
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {/* Date nav */}
          <div style={{display:"flex",alignItems:"center",gap:2}}>
            <button className="sf-icon-btn" onClick={()=>navDate(-1)} style={{width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.soft}}><Ic.ChevL s={16}/></button>
            {!isToday && <button onClick={goToday} style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${T.accent}44`,background:T.accentD,cursor:"pointer",fontSize:fs(11),fontWeight:700,color:T.accent}}>Today</button>}
            <button className="sf-icon-btn" onClick={()=>navDate(1)} style={{width:34,height:34,borderRadius:8,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.soft}}><Ic.ChevR s={16}/></button>
          </div>
          <div>
            <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>
              {view==="week" ? "Weekly Planner" : isToday ? "Today's Plan" : fmtDateLong(date)}
              {view==="day"&&!isToday && (() => { const days = diffDays(todayStr(), date); return <span style={{fontSize:fs(14),fontWeight:500,color:days>0?T.blue:T.orange,marginLeft:10}}>{days > 0 ? `${days}d from now` : days < 0 ? `${Math.abs(days)}d ago` : ""}</span>; })()}
            </h1>
            <p style={{color:T.dim,fontSize:fs(13)}}>{view==="week" ? `${weekDates[0].slice(5)} \u2014 ${weekDates[6].slice(5)}` : tasks.length===0?"Empty \u2014 add tasks or let AI plan":`${tasks.length} tasks \u00B7 ${completed} done`}</p>
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <div style={{display:"flex",borderRadius:8,border:`1px solid ${T.border}`,overflow:"hidden"}}>
            <button className="sf-toggle" onClick={()=>setView("day")} style={{padding:"6px 12px",fontSize:fs(11),fontWeight:view==="day"?700:400,border:"none",cursor:"pointer",background:view==="day"?T.accentD:"transparent",color:view==="day"?T.accent:T.dim}}>Day</button>
            <button className="sf-toggle" onClick={()=>setView("week")} style={{padding:"6px 12px",fontSize:fs(11),fontWeight:view==="week"?700:400,border:"none",cursor:"pointer",background:view==="week"?T.accentD:"transparent",color:view==="week"?T.accent:T.dim}}>Week</button>
          </div>
          {/* Undo/Redo buttons */}
          <div style={{ display: 'flex', gap: 2 }}>
            <button onClick={() => { const r = undo(data.tasks); if (r) setData(d => ({ ...d, tasks: r })); }} disabled={!undoState.canUndo}
              title={undoState.canUndo ? `Undo: ${undoState.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
              style={{ width: 38, height: 38, borderRadius: 8, border: `1.5px solid ${undoState.canUndo ? T.accent + '44' : T.border}`, background: undoState.canUndo ? T.input : 'transparent', color: undoState.canUndo ? T.text : T.dim, cursor: undoState.canUndo ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(16), fontWeight: 600, opacity: undoState.canUndo ? 1 : 0.3 }}>
              ↩
            </button>
            <button onClick={() => { const r = redo(data.tasks); if (r) setData(d => ({ ...d, tasks: r })); }} disabled={!undoState.canRedo}
              title={undoState.canRedo ? `Redo: ${undoState.redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
              style={{ width: 38, height: 38, borderRadius: 8, border: `1.5px solid ${undoState.canRedo ? T.accent + '44' : T.border}`, background: undoState.canRedo ? T.input : 'transparent', color: undoState.canRedo ? T.text : T.dim, cursor: undoState.canRedo ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(16), fontWeight: 600, opacity: undoState.canRedo ? 1 : 0.3 }}>
              ↪
            </button>
          </div>
          <Btn onClick={()=>openAdd()}><Ic.Plus s={15}/> Add Task</Btn>
          {isToday && sorted.some(t => !t.done) && (
            <button onClick={() => { const target = currentId || sorted.find(t => !t.done)?.id; if (target) setFocusTaskId(target); }}
              title="Enter Focus Mode (F)"
              style={{ padding: '6px 12px', borderRadius: 7, border: `1px solid ${T.accent}44`, background: T.accentD, color: T.accent, fontSize: fs(11), fontWeight: 600, cursor: 'pointer' }}>
              Focus
            </button>
          )}
        </div>
      </div>

      {/* Progress Header — always visible */}
      <ProgressHeader progress={dayProgress} />

      {/* Now Strip — current/next task with integrated timer (today only) */}
      {isToday && view === 'day' && (
        <NowStrip
          tasks={sorted}
          currentId={currentId}
          now={now}
          timerState={_timerState}
          onToggleTask={toggleTask}
          onStartTimer={(t) => setFocusTaskId(t.id)}
          onNavigateDaily={() => {}}
        />
      )}

      {/* Toolbar: Pomodoro + Templates + Carry Forward */}
      {/* Pomodoro timer removed — queue model handles pacing */}

      {/* Smart Carry Forward — incomplete study tasks from yesterday */}
      {carryTasks.length > 0 && (
        <div style={{background:T.orangeD,border:`1px solid ${T.orange}33`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.orange}}>{carryTasks.length} incomplete task{carryTasks.length>1?"s":""} from recent days</div>
            <div style={{fontSize:fs(10),color:T.soft,marginTop:2}}>{carryTasks.slice(0,5).map(t => `${t.title}${t.fromDate ? ` (${new Date(t.fromDate+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})})` : ''}`).join(', ')}{carryTasks.length > 5 ? `, +${carryTasks.length-5} more` : ''}</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <Btn small onClick={carryAll}>Carry All Forward</Btn>
          </div>
        </div>
      )}

      {/* Plan Pulse — today's plan progress + overall context */}
      {(() => {
        const lastPlan = (data.planHistory || []).slice(-1)[0];
        if (!lastPlan) return null;
        const planTasks = safeArr(tasks).filter(t => t.planId === lastPlan.planId);
        if (planTasks.length === 0) return null;
        const done = planTasks.filter(t => t.done).length;
        const total = planTasks.length;
        const doneMins = planTasks.filter(t => t.done).reduce((s, t) => {
          const st = parseTime(t.time), et = parseTime(t.endTime);
          return s + (st && et ? Math.max(0, et.mins - st.mins) : 0);
        }, 0);
        const totalMins = planTasks.reduce((s, t) => {
          const st = parseTime(t.time), et = parseTime(t.endTime);
          return s + (st && et ? Math.max(0, et.mins - st.mins) : 0);
        }, 0);
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const allDone = done >= total;
        const color = allDone ? T.accent : pct >= 50 ? T.blue : T.soft;

        // Overall plan progress
        let overallDone = 0, overallTotal = 0;
        for (const [, dayTasks] of Object.entries(data.tasks || {})) {
          for (const t of safeArr(dayTasks)) {
            if (t.planId !== lastPlan.planId) continue;
            overallTotal++;
            if (t.done) overallDone++;
          }
        }
        const overallPct = overallTotal > 0 ? Math.round((overallDone / overallTotal) * 100) : 0;

        // Streak calculation
        let streak = 0;
        const today = todayStr();
        const allDates = Object.keys(data.tasks || {}).filter(d => d <= today).sort().reverse();
        for (const dt of allDates) {
          const dayPlanTasks = safeArr(data.tasks[dt]).filter(t => t.planId === lastPlan.planId);
          if (dayPlanTasks.length === 0) continue;
          if (dayPlanTasks.some(t => t.done)) streak++;
          else break;
        }

        return (
          <div style={{ background: T.card, border: `1px solid ${allDone ? T.accent + '44' : T.border}`, borderRadius: 10, padding: '10px 14px', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: fs(11), fontWeight: 600, color: T.text }}>
                  {allDone ? `${'\u2705'} All plan tasks done!` : `Today${'\u2019'}s Plan: ${done}/${total} tasks`}
                </span>
                {streak > 1 && <Badge color={T.accent} bg={T.accentD}>{'\uD83D\uDD25'} {streak}d</Badge>}
              </div>
              <span style={{ fontSize: fs(10), color, fontWeight: 600 }}>{Math.round(doneMins / 60 * 10) / 10}h / {Math.round(totalMins / 60 * 10) / 10}h</span>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: T.input, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: allDone ? T.accent : color, transition: 'width .3s' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: fs(9), color: T.dim }}>Overall: {overallPct}% complete ({overallDone}/{overallTotal} tasks)</span>
              {allDone && !safeArr(tasks).every(t => t.done) && (
                <span style={{ fontSize: fs(9), color: T.accent }}>Plan tasks done — finish remaining tasks or rest!</span>
              )}
            </div>

            {/* All Done — Acceleration Options */}
            {allDone && (() => {
              const today = todayStr();
              const nextTask = findNextUndonePlanTask(data.tasks, lastPlan.planId, today, today);
              if (!nextTask) return null;
              return (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: T.accentD, border: `1px solid ${T.accent}33` }}>
                  <div style={{ fontSize: fs(10), fontWeight: 600, color: T.accent, marginBottom: 6 }}>You finished today's plan early! What next?</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => {
                      const { tasks: updated } = pullTaskToToday(data.tasks, nextTask.task.id, nextTask.date, today);
                      setData(d => ({ ...d, tasks: updated }));
                      toast(`Pulled "${nextTask.task.title?.split(/[\u2014\-:]/)[0]?.trim()}" from ${new Date(nextTask.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}`, 'success');
                    }} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.accent}44`, background: T.accentD, color: T.accent, fontSize: fs(10), fontWeight: 600, cursor: 'pointer' }}>
                      Continue with next material
                    </button>
                    <button onClick={() => toast('Great work today! Enjoy your break.', 'success')}
                      style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${T.border}`, background: T.input, color: T.soft, fontSize: fs(10), cursor: 'pointer' }}>
                      Take the rest off
                    </button>
                  </div>
                  <div style={{ fontSize: fs(9), color: T.dim, marginTop: 4 }}>
                    Next: {nextTask.task.title} ({new Date(nextTask.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })})
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Time Conflict Warning — current day */}
      {conflicts.size > 0 && view === "day" && (
        <div style={{background:`linear-gradient(135deg, ${T.redD}, ${T.red}11)`,border:`1px solid ${T.red}33`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:T.red,flexShrink:0}}/>
            <span style={{fontSize:fs(11),color:T.red,fontWeight:600}}>{conflicts.size} task{conflicts.size>1?"s":""} have overlapping time slots</span>
          </div>
          <span style={{fontSize:fs(9),color:T.red,opacity:0.6}}>Drag tasks or edit times to resolve</span>
        </div>
      )}

      {/* Global schedule conflicts — only show if OTHER days have conflicts too */}
      {(() => {
        const allDates = Object.keys(data.tasks||{}).filter(d => d >= todayStr()).sort();
        const cDates = [];
        for (const d of allDates) {
          const dt = safeArr(data.tasks[d]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
          let n = 0;
          for (let i=0; i<dt.length; i++) {
            const as=parseTime(dt[i].time),ae=parseTime(dt[i].endTime);
            if(!as||!ae) continue;
            for (let j=i+1; j<dt.length; j++) {
              const bs=parseTime(dt[j].time),be=parseTime(dt[j].endTime);
              if(!bs||!be) continue;
              if(as.mins<be.mins&&ae.mins>bs.mins) n++;
            }
          }
          if(n>0) cDates.push({date:d,count:n});
        }
        // If only 1 conflict day and it's the current day, the per-day banner already handles it
        if(cDates.length===0) return null;
        if(cDates.length===1 && cDates[0].date===date && view==="day") return null;
        const otherDates = cDates.filter(cd => cd.date !== date);
        const total = cDates.reduce((s,c)=>s+c.count,0);
        return (
          <div style={{background:T.card,border:`1px solid ${T.red}33`,borderRadius:10,padding:"12px 16px",marginBottom:12}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:T.red,flexShrink:0}}/>
                <span style={{fontSize:fs(12),color:T.text,fontWeight:700}}>Schedule Conflicts</span>
              </div>
              <span style={{fontSize:fs(10),color:T.dim}}>{total} overlap{total>1?"s":""} \u00B7 {cDates.length} day{cDates.length>1?"s":""}</span>
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {cDates.slice(0,12).map(cd => (
                <button key={cd.date} onClick={()=>setDate(cd.date)} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${cd.date===date?T.red:T.border}`,background:cd.date===date?T.red+"33":T.input,color:cd.date===date?T.red:T.soft,fontSize:fs(10),fontWeight:600,cursor:"pointer",transition:"all .15s"}}>
                  {new Date(cd.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})} <span style={{color:T.red,fontWeight:700}}>({cd.count})</span>
                </button>
              ))}
              {cDates.length>12&&<span style={{fontSize:fs(9),color:T.dim,alignSelf:"center"}}>+{cDates.length-12} more</span>}
            </div>
          </div>
        );
      })()}

      {/* AI Assist Bar removed — queue model handles task flow */}

      {/* ═══ QUEUE-BASED DAILY VIEW ═══ */}
      {(() => {
        const queue = data.taskQueue || [];
        const hasQueue = queue.length > 0 && queue.some(t => !t.done);
        if (!hasQueue || !isToday) return null;

        // Compute today's queue
        const pc = data.plannerConfig;
        const targetDate = data.targetCompletionDate || data.targetDate || '';
        const startDt = data.studyStartDate || todayStr();

        // Import-free inline populateToday logic
        const dow = new Date(todayStr() + 'T12:00:00').getDay();
        const dayConf = pc?.weeklyAvailability?.[dow];
        const dayAvailMins = dayConf?.available ? (() => {
          let mins = 0;
          for (const w of (dayConf.windows || [])) {
            const [sh, sm] = (w.start || '08:00').split(':').map(Number);
            const [eh, em] = (w.end || '17:00').split(':').map(Number);
            mins += (eh * 60 + em) - (sh * 60 + sm);
          }
          return Math.max(0, mins);
        })() : 4 * 60;

        const remainingStudy = queue.filter(t => !t.done && t.category !== 'break');
        const totalRemMins = remainingStudy.reduce((s, t) => s + (t.estimatedMins || 60), 0);
        const daysLeft = targetDate ? Math.max(1, diffDays(todayStr(), targetDate)) : 30;
        const dailyTargetMins = Math.min(dayAvailMins, Math.ceil(totalRemMins / daysLeft));

        // Fill today + work-ahead
        // Find the "frontier" — the first undone non-break task. Everything before it is
        // already completed (show dimmed). The frontier + enough tasks to fill daily target
        // = today's active list. Everything after = work-ahead (hidden until today is done).
        const frontierIdx = queue.findIndex(t => !t.done && t.category !== 'break');
        const todayQ = [], aheadQ = [];
        let filledMins = 0;
        let targetMet = false;

        // Include recent completed tasks for context (up to 5 before the frontier)
        const contextStart = Math.max(0, frontierIdx - 5);
        for (let i = contextStart; i < frontierIdx && i >= 0; i++) {
          const t = queue[i];
          if (t.done && t.category !== 'break') todayQ.push(t);
        }

        // Fill from the frontier forward
        for (let i = Math.max(0, frontierIdx); i < queue.length; i++) {
          const t = queue[i];
          if (t.done) { todayQ.push(t); continue; } // undone-then-redone tasks stay in place
          if (!targetMet) {
            todayQ.push(t);
            if (t.category !== 'break') filledMins += t.estimatedMins || 0;
            if (filledMins >= dailyTargetMins) targetMet = true;
          } else if (aheadQ.length < 8) {
            aheadQ.push(t);
          }
        }

        const doneTodayMins = todayQ.filter(t => t.done).reduce((s, t) => s + (t.estimatedMins || 0), 0);
        const totalDoneMins = queue.filter(t => t.done && t.category !== 'break').reduce((s, t) => s + (t.estimatedMins || 0), 0);
        const totalMins = queue.filter(t => t.category !== 'break').reduce((s, t) => s + (t.estimatedMins || 0), 0);
        const overallPct = totalMins > 0 ? Math.round(totalDoneMins / totalMins * 100) : 0;

        // SPI
        const elapsed = startDt ? Math.max(1, diffDays(startDt, todayStr())) : 1;
        const totalDays = targetDate && startDt ? Math.max(1, diffDays(startDt, targetDate)) : 60;
        const expectedMins = totalMins * Math.min(1, elapsed / totalDays);
        const spi = expectedMins > 0 ? totalDoneMins / expectedMins : 1;
        const status = spi >= 1.1 ? 'ahead' : spi >= 0.9 ? 'on-track' : spi >= 0.7 ? 'behind' : 'at-risk';
        const statusColors = { ahead: '#4ecdc4', 'on-track': T.accent, behind: '#f0c674', 'at-risk': T.red };
        const statusLabels = { ahead: 'Ahead of pace', 'on-track': 'On track', behind: 'Behind pace', 'at-risk': 'At risk' };
        const dailyNeedHrs = Math.round(totalRemMins / daysLeft / 60 * 10) / 10;

        const toggleQueueTask = (taskId) => {
          setData(d => ({
            ...d,
            taskQueue: (d.taskQueue || []).map(t => t.id === taskId ? { ...t, done: !t.done, doneDate: !t.done ? todayStr() : null } : t),
          }));
        };

        const catColors = { study: T.accent, review: T.blue || T.accent, 'exam-prep': T.orange, 'exam-day': T.red, project: T.purple, break: T.dim, class: T.blue };

        return (
          <div style={{ marginBottom: 16 }}>
            {/* Progress banner */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: T.panel, border: `1px solid ${T.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: fs(13), fontWeight: 700, color: T.text }}>{overallPct}% complete</span>
                  <Badge color={statusColors[status]} bg={statusColors[status] + '22'}>{statusLabels[status]}</Badge>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: T.border, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${overallPct}%`, background: statusColors[status], borderRadius: 2, transition: 'width .3s' }} />
                </div>
                <div style={{ fontSize: fs(10), color: T.dim, marginTop: 4 }}>
                  {Math.round(totalDoneMins / 60)}h / {Math.round(totalMins / 60)}h · {daysLeft} days left · need ~{dailyNeedHrs}h/day
                </div>
              </div>
            </div>

            {/* Course progress mini-bars */}
            {(() => {
              const courseProg = {};
              const courseColors2 = [T.accent, T.blue || T.accent, T.purple, T.orange, T.red, '#4ecdc4', '#f7b731'];
              for (const t of queue.filter(qt => qt.category !== 'break')) {
                const k = t.course_code || 'Other';
                if (!courseProg[k]) courseProg[k] = { total: 0, done: 0 };
                courseProg[k].total++;
                if (t.done) courseProg[k].done++;
              }
              return (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  {Object.entries(courseProg).map(([code, cp], ci) => {
                    const cpct = cp.total > 0 ? Math.round(cp.done / cp.total * 100) : 0;
                    const cc = courseColors2[ci % courseColors2.length];
                    return (
                      <div key={code} style={{ flex: '1 1 80px', minWidth: 80, background: T.card, border: `1px solid ${T.border}`, borderRadius: 6, padding: '5px 8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: fs(9), fontWeight: 700, color: T.text }}>{code}</span>
                          <span style={{ fontSize: fs(8), color: T.dim }}>{cpct}%</span>
                        </div>
                        <div style={{ height: 3, borderRadius: 2, background: T.input, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${cpct}%`, background: cc, borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Today's target */}
            <div style={{ fontSize: fs(11), fontWeight: 600, color: T.soft, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
              <span>TODAY — {Math.round(dailyTargetMins / 60 * 10) / 10}h planned</span>
              <span style={{ color: T.dim }}>{todayQ.filter(t => t.done).length}/{todayQ.filter(t => !t.done || (t.done && t.doneDate === todayStr())).length} done</span>
            </div>

            {/* Today's tasks — includes context (recent done) + active + newly done */}
            {todayQ.map((t, i) => {
              const color = catColors[t.category] || T.accent;
              const isNext = !t.done && i === todayQ.findIndex(x => !x.done);
              const isDoneOlderDay = t.done && t.doneDate && t.doneDate !== todayStr();
              const isExpanded = expandedTaskId === t.id;
              const hasTimer = activeTimerId === t.id;
              const timerMins = Math.floor(timerRemaining / 60);
              const timerSecs = timerRemaining % 60;

              // "Why this task" context
              const totalCourseUnits = queue.filter(qt => qt.course_code === t.course_code && qt.category !== 'break').length;
              const doneUnits = queue.filter(qt => qt.course_code === t.course_code && qt.done && qt.category !== 'break').length;
              const unitIdx = queue.filter(qt => qt.course_code === t.course_code && qt.category !== 'break').findIndex(qt => qt.id === t.id) + 1;

              return (
                <div key={t.id} style={{ marginBottom: isDoneOlderDay ? 2 : 6 }}>
                  {/* Main task row */}
                  <div onClick={() => !isDoneOlderDay && setExpandedTaskId(isExpanded ? null : t.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: isDoneOlderDay ? '6px 14px' : '10px 14px',
                    borderRadius: isExpanded ? '8px 8px 0 0' : 8, transition: 'all .12s', cursor: isDoneOlderDay ? 'default' : 'pointer',
                    background: hasTimer ? `${color}18` : t.done ? `${T.card}88` : isNext ? `${color}11` : T.card,
                    border: `1px solid ${hasTimer ? color + '55' : t.done ? T.border : isNext ? color + '44' : T.border}`,
                    borderLeft: `3px solid ${t.done ? T.dim : color}`,
                    borderBottom: isExpanded ? 'none' : undefined,
                    opacity: isDoneOlderDay ? 0.35 : t.done ? 0.6 : 1,
                  }}>
                    {/* Checkbox */}
                    <div onClick={(e) => { e.stopPropagation(); if (!t.done) { if (hasTimer) stopTimer(); toggleQueueTask(t.id); } }} style={{ width: isDoneOlderDay ? 16 : 20, height: isDoneOlderDay ? 16 : 20, borderRadius: 5, border: `2px solid ${t.done ? T.accent : T.border}`, background: t.done ? T.accentD : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: t.done ? 'default' : 'pointer' }}>
                      {t.done && <Ic.Check s={isDoneOlderDay ? 9 : 12} />}
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: fs(isDoneOlderDay ? 11 : 13), fontWeight: 600, color: t.done ? T.dim : T.text, textDecoration: t.done ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {isNext && !hasTimer && <span style={{ color, marginRight: 6 }}>▶</span>}
                        {t.title}
                      </div>
                      {!t.done && !isExpanded && (t.subtitle || t.notes) && <div style={{ fontSize: fs(10), color: T.soft, marginTop: 2, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.subtitle || t.notes?.split('\n')[0]}</div>}
                      {/* Why this task — compact context */}
                      {!t.done && !isDoneOlderDay && !isExpanded && t.course_code && (
                        <div style={{ fontSize: fs(8), color: T.dim, marginTop: 2 }}>Task {unitIdx} of {totalCourseUnits} in {t.course_code} · {doneUnits} completed</div>
                      )}
                    </div>
                    {/* Timer display (when active) */}
                    {hasTimer && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: fs(14), fontWeight: 800, fontFamily: "'JetBrains Mono',monospace", color: timerRemaining <= 60 ? T.red : color, minWidth: 50, textAlign: 'right' }}>
                          {timerMins}:{String(timerSecs).padStart(2, '0')}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); pauseTimer(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: timerPaused ? T.accent : T.dim, fontSize: fs(12), padding: 2 }}>{timerPaused ? '▶' : '⏸'}</button>
                        <button onClick={(e) => { e.stopPropagation(); stopTimer(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.dim, fontSize: fs(10), padding: 2 }}>✕</button>
                      </div>
                    )}
                    {/* Duration + category + undo (hidden when timer active) */}
                    {!hasTimer && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{ fontSize: fs(isDoneOlderDay ? 9 : 10), color: T.dim, fontFamily: "'JetBrains Mono', monospace" }}>{minsToStr(t.estimatedMins || 60)}</span>
                        {!isDoneOlderDay && <Badge color={color} bg={color + '22'}>{t.category}</Badge>}
                        {t.done && (
                          <button onClick={(e) => { e.stopPropagation(); toggleQueueTask(t.id); }} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${T.orange}55`, background: 'transparent', color: T.orange, fontSize: fs(9), cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>Undo</button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded detail panel */}
                  {isExpanded && !isDoneOlderDay && (
                    <div style={{ padding: '10px 14px 12px', background: T.panel, border: `1px solid ${t.done ? T.border : isNext ? color + '44' : T.border}`, borderTop: 'none', borderLeft: `3px solid ${t.done ? T.dim : color}`, borderRadius: '0 0 8px 8px' }}>
                      {/* Why this task — detailed */}
                      {t.course_code && (
                        <div style={{ fontSize: fs(9), color, fontWeight: 600, marginBottom: 6 }}>
                          Unit {t.unitNumber} · Task {unitIdx} of {totalCourseUnits} in {t.course_code} ({t.course_name}) · {doneUnits} done · {totalCourseUnits - doneUnits} remaining
                        </div>
                      )}
                      {/* Topics */}
                      {t.topics?.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: fs(9), fontWeight: 700, color: T.dim, marginBottom: 2 }}>TOPICS</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {t.topics.map((topic, ti) => <span key={ti} style={{ fontSize: fs(9), padding: '2px 8px', borderRadius: 10, background: `${color}15`, color: T.soft, border: `1px solid ${color}22` }}>{topic}</span>)}
                          </div>
                        </div>
                      )}
                      {/* Objective */}
                      {t.objectives && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: fs(9), fontWeight: 700, color: T.dim, marginBottom: 2 }}>OBJECTIVE</div>
                          <div style={{ fontSize: fs(10), color: T.text, lineHeight: 1.4 }}>{t.objectives}</div>
                        </div>
                      )}
                      {/* Study instructions */}
                      {t.notes && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: fs(9), fontWeight: 700, color: T.dim, marginBottom: 2 }}>STUDY GUIDE</div>
                          <div style={{ fontSize: fs(10), color: T.soft, lineHeight: 1.5, whiteSpace: 'pre-line' }}>{t.notes}</div>
                        </div>
                      )}
                      {/* Action buttons */}
                      {!t.done && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          {!hasTimer ? (
                            <button onClick={(e) => { e.stopPropagation(); startTimer(t.id, t.estimatedMins || 60); }} style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${color}`, background: `${color}22`, color, fontSize: fs(10), cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                              ▶ Start Timer ({minsToStr(t.estimatedMins || 60)})
                            </button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); stopTimer(); toggleQueueTask(t.id); }} style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>
                              ✓ Mark Complete
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); if (!t.done) toggleQueueTask(t.id); }} style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>
                            ✓ Done
                          </button>
                        </div>
                      )}
                      {t.done && (
                        <button onClick={(e) => { e.stopPropagation(); toggleQueueTask(t.id); }} style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${T.orange}55`, background: 'transparent', color: T.orange, fontSize: fs(10), cursor: 'pointer', fontWeight: 600 }}>Undo</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Work ahead — only visible when ALL today's tasks are done */}
            {(() => {
              const allTodayDone = todayQ.length > 0 && todayQ.every(t => t.done);
              if (!allTodayDone || aheadQ.length === 0) return null;
              return (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px', padding: '8px 12px', borderRadius: 8, background: `${T.accent}11`, border: `1px solid ${T.accent}33` }}>
                    <span style={{ fontSize: fs(11), color: T.accent, fontWeight: 600 }}>Daily target met!</span>
                    <span style={{ fontSize: fs(10), color: T.dim }}>Keep going to get ahead, or take a break.</span>
                  </div>
                  <div style={{ fontSize: fs(10), fontWeight: 600, color: T.dim, marginBottom: 6 }}>WORK AHEAD</div>
                  {aheadQ.map(t => {
                    const color = catColors[t.category] || T.accent;
                    return (
                      <div key={t.id} onClick={() => toggleQueueTask(t.id)} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', marginBottom: 3,
                        borderRadius: 8, cursor: 'pointer', background: T.input, border: `1px solid ${T.border}`,
                        borderLeft: `3px solid ${color}44`,
                      }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: `1.5px solid ${T.border}`, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: fs(12), color: T.soft, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                        <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono', monospace" }}>{minsToStr(t.estimatedMins || 60)}</span>
                        <Badge color={color} bg={color + '22'}>{t.category}</Badge>
                      </div>
                    );
                  })}
                </>
              );
            })()}

            {/* Daily summary — all tasks done */}
            {todayQ.length > 0 && todayQ.every(t => t.done) && (
              <div style={{ margin: '16px 0', padding: '16px 20px', borderRadius: 10, background: `linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`, border: `1px solid ${T.accent}33`, textAlign: 'center' }}>
                <div style={{ fontSize: fs(16), fontWeight: 800, color: T.text, marginBottom: 4 }}>Daily Target Complete!</div>
                <div style={{ fontSize: fs(11), color: T.soft, marginBottom: 8 }}>
                  You studied ~{Math.round(todayQ.reduce((s, t) => s + (t.estimatedMins || 0), 0) / 60 * 10) / 10}h today
                  {' '}across {[...new Set(todayQ.filter(t => t.course_code).map(t => t.course_code))].length} course{[...new Set(todayQ.filter(t => t.course_code).map(t => t.course_code))].length !== 1 ? 's' : ''}
                </div>
                <div style={{ fontSize: fs(10), color: statusColors[status] }}>
                  {status === 'ahead' ? 'You\'re ahead of pace — great momentum!' : status === 'on-track' ? 'Right on track to meet your target date.' : status === 'behind' ? `Slightly behind — ${dailyNeedHrs}h/day to catch up.` : `At risk — consider extending your target date or increasing daily hours.`}
                </div>
                {aheadQ.length > 0 && <div style={{ fontSize: fs(10), color: T.dim, marginTop: 6 }}>Want to get ahead? {aheadQ.length} more tasks available below.</div>}
              </div>
            )}

            {/* ── Completed History ── */}
            {(() => {
              const doneTasks = queue.filter(t => t.done && t.category !== 'break');
              if (doneTasks.length === 0) return null;
              // Exclude tasks already shown in todayQ
              const todayIds = new Set(todayQ.map(t => t.id));
              const historyTasks = doneTasks.filter(t => !todayIds.has(t.id));
              if (historyTasks.length === 0) return null;

              // Group by doneDate
              const byDate = {};
              for (const t of historyTasks) {
                const dt = t.doneDate || 'Unknown';
                if (!byDate[dt]) byDate[dt] = [];
                byDate[dt].push(t);
              }
              const sortedDates = Object.keys(byDate).sort().reverse();

              return (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}
                    onClick={() => setData(d => ({ ...d, _showHistory: !d._showHistory }))}>
                    <span style={{ fontSize: fs(11), fontWeight: 700, color: T.soft }}>Completed ({historyTasks.length})</span>
                    <span style={{ fontSize: fs(9), color: T.dim }}>{data._showHistory ? '▾ hide' : '▸ show'}</span>
                  </div>
                  {data._showHistory && sortedDates.map(dt => (
                    <div key={dt} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: fs(9), fontWeight: 600, color: T.dim, marginBottom: 4, textTransform: 'uppercase' }}>
                        {dt === todayStr() ? 'Today' : (() => { try { return new Date(dt + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); } catch (_) { return dt; } })()}
                        {' '}({byDate[dt].length} tasks · {minsToStr(byDate[dt].reduce((s, t) => s + (t.estimatedMins || 60), 0))})
                      </div>
                      {byDate[dt].map(t => {
                        const color = catColors[t.category] || T.accent;
                        return (
                          <div key={t.id} style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', marginBottom: 2,
                            borderRadius: 6, background: T.card, border: `1px solid ${T.border}`,
                            borderLeft: `3px solid ${T.dim}`, opacity: 0.55,
                          }}>
                            <div style={{ width: 16, height: 16, borderRadius: 4, background: T.accentD, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Ic.Check s={10} />
                            </div>
                            <span style={{ flex: 1, fontSize: fs(11), color: T.dim, textDecoration: 'line-through', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.title}</span>
                            <span style={{ fontSize: fs(9), color: T.dim, fontFamily: "'JetBrains Mono',monospace" }}>{minsToStr(t.estimatedMins || 60)}</span>
                            <button onClick={(e) => { e.stopPropagation(); toggleQueueTask(t.id); }} style={{ padding: '2px 8px', borderRadius: 4, border: `1px solid ${T.orange}55`, background: 'transparent', color: T.orange, fontSize: fs(9), cursor: 'pointer', fontWeight: 600 }}>Undo</button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* Category filter (day view) */}
      {view==="day" && tasks.length > 0 && !(data.taskQueue?.length > 0 && data.taskQueue.some(t => !t.done) && isToday) && (
        <div style={{display:"flex",gap:4,marginBottom:12,flexWrap:"wrap"}}>
          <button className="sf-chip" onClick={()=>setCatFilter("all")} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:fs(11),fontWeight:catFilter==="all"?700:400,cursor:"pointer",background:catFilter==="all"?T.accentD:"transparent",color:catFilter==="all"?T.accent:T.dim}}>All ({tasks.length})</button>
          {Object.entries(CAT).filter(([k])=>tasks.some(t=>t.category===k)).map(([k,v])=>(
            <button key={k} className="sf-chip" onClick={()=>setCatFilter(k)} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:fs(11),fontWeight:catFilter===k?700:400,cursor:"pointer",background:catFilter===k?v.bg:"transparent",color:catFilter===k?v.fg:T.dim}}>{v.l} ({tasks.filter(t=>t.category===k).length})</button>
          ))}
        </div>
      )}

      {/* Timeline/List toggle (day view only) */}
      {view === 'day' && filtered.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
          <div style={{ display: 'flex', borderRadius: 6, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
            <button onClick={() => setDayView('timeline')} style={{ padding: '4px 10px', fontSize: fs(9), fontWeight: dayView === 'timeline' ? 700 : 400, border: 'none', cursor: 'pointer', background: dayView === 'timeline' ? T.accentD : 'transparent', color: dayView === 'timeline' ? T.accent : T.dim }}>Timeline</button>
            <button onClick={() => setDayView('list')} style={{ padding: '4px 10px', fontSize: fs(9), fontWeight: dayView === 'list' ? 700 : 400, border: 'none', cursor: 'pointer', background: dayView === 'list' ? T.accentD : 'transparent', color: dayView === 'list' ? T.accent : T.dim }}>List</button>
          </div>
        </div>
      )}

      {/* Content */}
      {view==="week" ? renderWeekView() : (
        filtered.length===0 ? <div style={{padding:"50px 0",textAlign:"center"}}><div style={{fontSize:fs(40),marginBottom:12,opacity:.3}}>📋</div><p style={{color:T.dim,fontSize:fs(13)}}>{catFilter!=="all"?"No tasks in this category":"No tasks for this day"}</p></div>
        : dayView === 'timeline' ? (
          <DayTimeline
            tasks={filtered}
            date={date}
            now={now}
            currentId={currentId}
            onToggle={toggleTask}
            onEdit={openEdit}
            onDelete={deleteTask}
          />
        ) : <>
          {manualOrder && (
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <span style={{fontSize:fs(10),color:T.dim}}>Custom order active</span>
              <button onClick={()=>setManualOrder(null)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,padding:"3px 10px",fontSize:fs(10),color:T.soft,cursor:"pointer",fontWeight:600}}>Reset to time order</button>
            </div>
          )}
          <SortableList
            items={filtered}
            keyExtractor={t => t.id}
            onReorder={handleTaskReorder}
            renderItem={renderTask}
          />
        </>
      )}

      {showRestructure && (
        <div className="fade" style={{background:T.accentD,border:`1px solid ${T.accent}44`,borderRadius:12,padding:16,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:fs(13),fontWeight:600,color:T.accent}}>{'\u23E9'} You finished {minsToStr(showRestructure.savedMins)} early!</div>
              <div style={{fontSize:fs(12),color:T.soft,marginTop:2}}>Shift remaining tasks forward?</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn small onClick={()=>restructureTasks(showRestructure.savedMins)}>Shift Earlier</Btn>
              <Btn small v="ghost" onClick={()=>setShowRestructure(null)}>Keep As-Is</Btn>
            </div>
          </div>
        </div>
      )}

      {/* End-of-day shift prompt — show when today has undone tasks and it's past the last task's end time */}
      {isToday && view === 'day' && (() => {
        const undoneTasks = tasks.filter(t => !t.done && t.category !== 'break' && !t._ghost);
        if (undoneTasks.length === 0) return null;
        const lastEnd = undoneTasks.reduce((max, t) => { const e = parseTime(t.endTime); return e ? Math.max(max, e.mins) : max; }, 0);
        if (now < lastEnd) return null; // Not past the end of the day yet
        return (
          <div className="fade" style={{ background: T.orangeD, border: `1px solid ${T.orange}33`, borderRadius: 12, padding: 14, marginTop: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: fs(13), fontWeight: 600, color: T.orange }}>{undoneTasks.length} task{undoneTasks.length !== 1 ? 's' : ''} not completed today</div>
                <div style={{ fontSize: fs(11), color: T.soft, marginTop: 2 }}>Shift them to the next available days?</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Btn small onClick={() => handleShiftDay(date)}>Shift Forward</Btn>
                <Btn small v="ghost" onClick={() => toast('Tasks will remain on today.', 'info')}>Keep Here</Btn>
              </div>
            </div>
          </div>
        );
      })()}

      {showAdd&&<Modal title={editId?"Edit Task":"Add Task"} onClose={()=>setShowAdd(false)}>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div><Label>Title</Label><input autoFocus value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="What needs to be done?" onKeyDown={e=>e.key==="Enter"&&saveTask()}/></div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><Label>Start</Label><input type="time" value={form.time} onChange={e=>setForm({...form,time:e.target.value})}/></div>
            <div><Label>End</Label><input type="time" value={form.endTime} onChange={e=>setForm({...form,endTime:e.target.value})}/></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><Label>Category</Label><select value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(CAT).filter(([k])=>k!=="exam").map(([k,v])=><option key={k} value={k}>{v.l}</option>)}</select></div>
            <div><Label>Priority</Label><div style={{display:"flex",gap:4}}>{["high","medium","low"].map(p=><button key={p} className="sf-toggle" onClick={()=>setForm({...form,priority:p})} style={{flex:1,padding:"8px 0",borderRadius:8,cursor:"pointer",fontSize:fs(11),fontWeight:600,textTransform:"capitalize",border:`1.5px solid ${form.priority===p?PRIO[p]:T.border}`,background:form.priority===p?PRIO[p]+"22":T.input,color:form.priority===p?PRIO[p]:T.dim}}>{p}</button>)}</div></div>
          </div>
          <div><Label>Recurring</Label>
            <div style={{display:"flex",gap:4}}>
              {[{k:"",l:"None"},{k:"daily",l:"Daily"},{k:"weekdays",l:"Weekdays"},{k:"weekly",l:"Weekly"}].map(r=>(
                <button key={r.k} onClick={()=>setForm({...form,recurring:r.k})} style={{flex:1,padding:"8px 0",borderRadius:8,cursor:"pointer",fontSize:fs(10),fontWeight:600,border:`1.5px solid ${form.recurring===r.k?T.blue:T.border}`,background:form.recurring===r.k?T.blueD:T.input,color:form.recurring===r.k?T.blue:T.dim}}>{r.l}</button>
              ))}
            </div>
          </div>
          <div><Label>Notes</Label><input value={form.notes||""} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Optional details..."/></div>
          {editId && (
            <div><Label>Move to Date</Label>
              <input type="date" value={form.moveToDate || ''} onChange={e => setForm({...form, moveToDate: e.target.value})} />
              {form.moveToDate && form.moveToDate !== date && <span style={{fontSize:fs(10),color:T.orange,marginLeft:8}}>Task will move to {new Date(form.moveToDate+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</span>}
            </div>
          )}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
            <Btn v="secondary" onClick={()=>setShowAdd(false)}>Cancel</Btn>
            <Btn onClick={saveTask} disabled={!form.title.trim()}>{editId?"Update":"Add Task"}</Btn>
          </div>
        </div>
      </Modal>}
    </div>
  );
};

export { DailyPage };
export default DailyPage;
