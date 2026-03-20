import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, pad, fmtTime, parseTime, minsToStr, nowMins, uid, fmtDateLong, diffDays } from "../../utils/helpers.js";
import { getCAT, AI_CATS, STUDY_CATS, getPRIO, getSTATUS_C, STATUS_L } from "../../constants/categories.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { timerStart, timerStop, useTimer } from "../../systems/timer.js";
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

const DailyPage=({date,tasks,setTasks,profile,data,setData,setDate})=>{
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
  const[pomActive,setPomActive]=useState(false);
  const[pomTime,setPomTime]=useState(25*60);
  const[pomBreak,setPomBreak]=useState(false);
  const[showTemplates,setShowTemplates]=useState(false);
  const[dragTask,setDragTask]=useState(null);
  const[expandedWeekDays,setExpandedWeekDays]=useState({});
  const pomRef=useRef(null);
  const isToday=date===todayStr();
  useEffect(()=>{const iv=setInterval(()=>setNow(nowMins()),30000);return()=>clearInterval(iv)},[]);

  // Week dates starting from current date's Monday
  const getWeekDates = (d) => {
    const dt = new Date(d+"T12:00:00");
    const day = dt.getDay();
    const mon = new Date(dt); mon.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
    return Array.from({length:7}, (_,i) => { const x = new Date(mon); x.setDate(mon.getDate()+i); return x.toISOString().split("T")[0]; });
  };
  const weekDates = useMemo(() => getWeekDates(date), [date]);

  const sorted=useMemo(()=>[...tasks].sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999)),[tasks]);
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

  // Pomodoro timer
  useEffect(() => {
    if(pomActive) {
      pomRef.current = setInterval(() => {
        setPomTime(t => {
          if(t <= 1) {
            clearInterval(pomRef.current);
            setPomActive(false);
            if(pomBreak) { toast("Break over! Back to work.","info"); setPomBreak(false); setPomTime(25*60); }
            else { toast("Pomodoro done! Take a 5-min break.","success"); setPomBreak(true); setPomTime(5*60); }
            return 0;
          }
          return t - 1;
        });
      }, 1000);
      return () => clearInterval(pomRef.current);
    }
  }, [pomActive, pomBreak]);

  const pomToggle = () => { if(pomActive) { clearInterval(pomRef.current); setPomActive(false); } else setPomActive(true); };
  const pomReset = () => { clearInterval(pomRef.current); setPomActive(false); setPomBreak(false); setPomTime(25*60); };

  // Task templates
  const TEMPLATES = [
    {name:"Study Day", tasks:[{time:"08:00",endTime:"08:30",title:"Morning review",category:"study",priority:"medium"},{time:"08:30",endTime:"11:30",title:"Deep study session",category:"study",priority:"high"},{time:"11:30",endTime:"12:00",title:"Break & stretch",category:"break",priority:"low"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"15:00",title:"Afternoon study",category:"study",priority:"high"},{time:"15:00",endTime:"15:30",title:"Exercise",category:"health",priority:"medium"},{time:"15:30",endTime:"17:00",title:"Practice problems / review",category:"study",priority:"medium"}]},
    {name:"Light Day", tasks:[{time:"09:00",endTime:"10:30",title:"Study session",category:"study",priority:"medium"},{time:"10:30",endTime:"11:00",title:"Break",category:"break",priority:"low"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"14:00",endTime:"15:00",title:"Light review",category:"study",priority:"low"},{time:"17:00",endTime:"18:00",title:"Exercise",category:"health",priority:"medium"}]},
    {name:"Exam Prep", tasks:[{time:"07:00",endTime:"07:30",title:"Quick review of weak areas",category:"review",priority:"high"},{time:"08:00",endTime:"10:00",title:"Practice exam #1",category:"exam-prep",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"12:15",title:"Practice exam #2",category:"exam-prep",priority:"high"},{time:"12:15",endTime:"12:45",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"15:00",title:"Review missed questions",category:"review",priority:"high"},{time:"15:00",endTime:"16:00",title:"Final flashcard review",category:"review",priority:"medium"}]},
    {name:"Balanced Day", tasks:[{time:"06:30",endTime:"07:30",title:"Morning exercise",category:"health",priority:"medium"},{time:"08:00",endTime:"10:00",title:"Study block 1",category:"study",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"12:00",title:"Study block 2",category:"study",priority:"high"},{time:"12:00",endTime:"13:00",title:"Lunch & rest",category:"personal",priority:"medium"},{time:"13:00",endTime:"14:30",title:"Study block 3",category:"study",priority:"medium"},{time:"14:30",endTime:"15:00",title:"Break",category:"break",priority:"low"},{time:"15:00",endTime:"16:00",title:"Personal tasks / errands",category:"personal",priority:"medium"},{time:"17:00",endTime:"18:00",title:"Light review",category:"review",priority:"low"}]},
    {name:"OA Exam Day", tasks:[{time:"07:00",endTime:"07:45",title:"Light review of key concepts",category:"review",priority:"high"},{time:"07:45",endTime:"08:00",title:"Pre-exam prep (quiet, water, deep breaths)",category:"break",priority:"medium"},{time:"08:00",endTime:"10:00",title:"\🎯 OA Exam",category:"exam-day",priority:"high",notes:"Take your time. Flag questions you're unsure about and return to them."},{time:"10:00",endTime:"10:30",title:"Post-exam break & decompress",category:"break",priority:"medium"},{time:"10:30",endTime:"11:00",title:"Review results & celebrate",category:"personal",priority:"low"}]},
    {name:"PA Submission Day", tasks:[{time:"08:00",endTime:"10:00",title:"Final PA review & polish",category:"project",priority:"high"},{time:"10:00",endTime:"10:15",title:"Break",category:"break",priority:"low"},{time:"10:15",endTime:"11:15",title:"Rubric self-check (every section)",category:"project",priority:"high"},{time:"11:15",endTime:"12:00",title:"Proofread & format",category:"project",priority:"high"},{time:"12:00",endTime:"12:30",title:"Lunch",category:"personal",priority:"medium"},{time:"13:00",endTime:"13:30",title:"\🎯 Submit PA",category:"exam-day",priority:"high",notes:"Double-check all files are attached and sections are complete."},{time:"13:30",endTime:"14:00",title:"Celebrate & plan next course",category:"personal",priority:"low"}]},
  ];
  const applyTemplate = (tmpl) => {
    const newTasks = tmpl.tasks.map(t => ({...t, id:uid(), done:false, notes:"", recurring:""}));
    setTasks([...tasks, ...newTasks]);
    setShowTemplates(false);
    toast(`Template "${tmpl.name}" applied: ${newTasks.length} tasks added`, "success");
  };

  // Drag-to-reorder tasks
  const handleTaskDragStart = (e, taskId) => { setDragTask(taskId); e.dataTransfer.effectAllowed = "move"; };
  const handleTaskDrop = (e, targetId) => {
    e.preventDefault();
    if(!dragTask || dragTask === targetId) { setDragTask(null); return; }
    const dragIdx = sorted.findIndex(t=>t.id===dragTask);
    const targetIdx = sorted.findIndex(t=>t.id===targetId);
    if(dragIdx < 0 || targetIdx < 0) { setDragTask(null); return; }
    // Swap the times of the dragged task and target
    const dTask = sorted[dragIdx], tTask = sorted[targetIdx];
    setTasks(tasks.map(t => {
      if(t.id === dTask.id) return {...t, time:tTask.time, endTime:tTask.endTime};
      if(t.id === tTask.id) return {...t, time:dTask.time, endTime:dTask.endTime};
      return t;
    }));
    setDragTask(null);
    toast("Tasks swapped","info");
  };

  // Smart carryforward: incomplete tasks from yesterday
  const yesterdayStr = useMemo(() => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split("T")[0]; }, []);
  const carryTasks = useMemo(() => {
    if(!isToday) return [];
    return safeArr(data.tasks?.[yesterdayStr]).filter(t => !t.done && t.category === "study");
  }, [data.tasks, yesterdayStr, isToday]);
  const carryForward = (task) => {
    setTasks([...tasks, {...task, id:uid(), done:false}]);
    toast(`Carried forward: ${task.title}`, "info");
  };
  const carryAll = () => {
    const newTasks = carryTasks.map(t => ({...t, id:uid(), done:false}));
    setTasks([...tasks, ...newTasks]);
    toast(`${newTasks.length} task(s) carried forward from yesterday`, "info");
  };

  const openAdd=(cat)=>{setForm({time:"09:00",endTime:"09:30",title:"",category:cat||"study",priority:"medium",notes:"",recurring:""});setEditId(null);setShowAdd(true)};
  const openEdit=(t)=>{setForm({...t,recurring:t.recurring||""});setEditId(t.id);setShowAdd(true)};
  const saveTask=()=>{
    if(!form.title.trim())return;
    const taskData = {...form};
    if(editId){
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
  const toggleTask=id=>setTasks(tasks.map(t=>t.id===id?{...t,done:!t.done}:t));
  const deleteTask=id=>setTasks(tasks.filter(t=>t.id!==id));

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

  const generateAI=async(preset)=>{
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
    const startCtx = data.studyStartTime ? ` Start time: ${data.studyStartTime}.` : "";

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
    const msg = preset ? (typeof presets[preset]==="function"?presets[preset]():presets[preset]) : (aiPrompt.trim()||presets.full);
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

  // Task card renderer
  const renderTask = (t) => {
    const c=CAT[t.category]||CAT.other,s=parseTime(t.time),e=parseTime(t.endTime),dur=s&&e?e.mins-s.mins:null,isCur=t.id===currentId;
    const hasConflict = conflicts.has(t.id);
    const isExamDay = t.category === "exam-day";
    return (<div key={t.id} className="fade sf-task" draggable onDragStart={e=>handleTaskDragStart(e,t.id)} onDragOver={e=>e.preventDefault()} onDrop={e=>handleTaskDrop(e,t.id)}
      style={{display:"flex",alignItems:"stretch",background:isExamDay?`${c.bg}`:t.done?`${T.input}88`:hasConflict?T.redD:dragTask===t.id?T.purpleD:T.card,border:`1.5px solid ${isExamDay?c.fg+"55":hasConflict?T.red+"55":isCur?T.accent+"55":dragTask===t.id?T.purple:T.border}`,borderRadius:12,overflow:"hidden",opacity:t.done?.5:dragTask===t.id?.6:1,boxShadow:isExamDay?`0 0 16px ${c.fg}18`:isCur?`0 0 20px ${T.accentD}`:"0 1px 4px rgba(0,0,0,.08)",cursor:"grab"}}>
      <div style={{width:3,background:hasConflict?T.red:c.fg,flexShrink:0}}/>
      <div style={{padding:"10px 14px",minWidth:100,display:"flex",flexDirection:"column",justifyContent:"center",borderRight:`1px solid ${T.border}`}}>
        <span className="mono" style={{fontSize:fs(13),fontWeight:600,color:hasConflict?T.red:isCur?T.accent:T.text}}>{s?fmtTime(s.h,s.m):"\u2014"}</span>
        {e&&<span className="mono" style={{fontSize:fs(10),color:T.dim}}>\u2192 {fmtTime(e.h,e.m)}</span>}
        {dur>0&&<span style={{fontSize:fs(9),color:T.dim,display:"flex",alignItems:"center",gap:2,marginTop:1}}><Ic.Clock/>{minsToStr(dur)}</span>}
        {hasConflict&&<span style={{fontSize:fs(8),color:T.red,fontWeight:700,marginTop:1}}>OVERLAP</span>}
      </div>
      <div style={{flex:1,padding:"10px 14px",display:"flex",flexDirection:"column",justifyContent:"center",gap:3}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <span style={{fontSize:fs(13),fontWeight:500,textDecoration:t.done?"line-through":"none",color:t.done?T.dim:T.text}}>{t.title}</span>
          {isCur&&!t.done&&<span style={{fontSize:fs(8),padding:"2px 5px",borderRadius:3,background:T.accentD,color:T.accent,fontWeight:700}}>NOW</span>}
          {t.recurring&&<span style={{fontSize:fs(8),padding:"1px 5px",borderRadius:3,background:T.blueD,color:T.blue,fontWeight:600}}>\u21BB {t.recurring}</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
          <span style={{fontSize:fs(9),color:PRIO[t.priority]||T.soft,fontWeight:600}}>\u25CF {t.priority}</span>
          {t.notes&&<span style={{fontSize:fs(10),color:T.dim}}>\u2014 {t.notes}</span>}
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:3,padding:"0 10px"}}>
        {!t.done && isToday && <button className="sf-icon-btn" onClick={()=>completeEarly(t)} title="Complete early" style={{background:"none",border:"none",color:T.accent,cursor:"pointer",padding:5,fontSize:fs(10),fontWeight:600}}>Done \u2713</button>}
        {!t.done && <button className="sf-icon-btn" onClick={()=>{const match=(data.courses||[]).find(c=>t.title.toLowerCase().includes(c.name.toLowerCase().split(" \u2013 ")[0].split(" - ")[0])||(c.courseCode&&t.title.toLowerCase().includes(c.courseCode.toLowerCase())));timerStart(t.title,match?.name||"")}} title="Start timer" style={{background:"none",border:"none",color:_timerState.running&&_timerState.taskTitle===t.title?T.accent:T.dim,cursor:"pointer",padding:5,fontSize:fs(14)}}>⏱</button>}
        <button onClick={()=>toggleTask(t.id)} style={{width:30,height:30,borderRadius:8,border:`2px solid ${t.done?T.accent:T.border}`,background:t.done?T.accentD:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.accent,transition:"all .15s"}}>{t.done&&<Ic.Check s={14}/>}</button>
        <button className="sf-icon-btn" onClick={()=>openEdit(t)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:5}}><Ic.Edit/></button>
        <button className="sf-icon-btn" onClick={()=>deleteTask(t.id)} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:5}}><Ic.Trash/></button>
      </div>
    </div>);
  };

  // Date navigation helpers
  const navDate = (delta) => {
    if (view === "week") {
      const d = new Date(date+"T12:00:00"); d.setDate(d.getDate() + delta * 7); setDate(d.toISOString().split("T")[0]);
    } else {
      const d = new Date(date+"T12:00:00"); d.setDate(d.getDate() + delta); setDate(d.toISOString().split("T")[0]);
    }
  };
  const goToday = () => setDate(todayStr());

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
              {view==="week" ? "Weekly Schedule" : isToday ? "Today's Schedule" : fmtDateLong(date)}
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
          <Btn onClick={()=>openAdd()}><Ic.Plus s={15}/> Add Task</Btn>
        </div>
      </div>

      {/* Toolbar: Pomodoro + Templates + Carry Forward */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {/* Pomodoro */}
        <div style={{display:"flex",alignItems:"center",gap:6,background:pomActive?(pomBreak?T.blueD:T.accentD):T.card,border:`1.5px solid ${pomActive?(pomBreak?T.blue:T.accent):T.border}`,borderRadius:12,padding:"8px 14px",boxShadow:pomActive?`0 0 12px ${pomBreak?T.blue:T.accent}15`:"none",transition:"all .2s"}}>
          <span style={{fontSize:fs(14),fontWeight:800,fontFamily:"'JetBrains Mono',monospace",color:pomActive?(pomBreak?T.blue:T.accent):T.dim,minWidth:40}}>{Math.floor(pomTime/60)}:{String(pomTime%60).padStart(2,'0')}</span>
          <button onClick={pomToggle} style={{background:"none",border:"none",cursor:"pointer",color:pomActive?T.accent:T.soft,fontSize:fs(12),fontWeight:600}}>{pomActive?"\u23F8":"\u25B6"}</button>
          {(pomActive||pomTime!==25*60)&&<button onClick={pomReset} style={{background:"none",border:"none",cursor:"pointer",color:T.dim,fontSize:fs(10)}}>↻</button>}
          <span style={{fontSize:fs(9),color:T.dim}}>{pomBreak?"Break":"Focus"}</span>
        </div>
        {/* Templates */}
        <div style={{position:"relative"}}>
          <Btn small v="ghost" onClick={()=>setShowTemplates(p=>!p)}>📋 Templates</Btn>
          {showTemplates && (
            <div className="fade" style={{position:"absolute",top:"100%",left:0,marginTop:4,background:T.card,border:`1.5px solid ${T.border}`,borderRadius:12,padding:8,boxShadow:"0 8px 24px rgba(0,0,0,.35)",zIndex:20,width:240}}>
              {TEMPLATES.map((t,i) => (
                <button key={i} className="sf-row" onClick={()=>applyTemplate(t)} style={{width:"100%",textAlign:"left",padding:"8px 10px",borderRadius:7,border:"none",cursor:"pointer",background:"transparent",marginBottom:2,color:T.text,fontSize:fs(11)}}>
                  <div style={{fontWeight:600}}>{t.name}</div>
                  <div style={{fontSize:fs(9),color:T.dim}}>{t.tasks.length} tasks</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Smart Carry Forward — incomplete study tasks from yesterday */}
      {carryTasks.length > 0 && (
        <div style={{background:T.orangeD,border:`1px solid ${T.orange}33`,borderRadius:10,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:fs(12),fontWeight:600,color:T.orange}}>{carryTasks.length} incomplete task{carryTasks.length>1?"s":""} from yesterday</div>
            <div style={{fontSize:fs(10),color:T.soft,marginTop:2}}>{carryTasks.map(t=>t.title).join(", ")}</div>
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            <Btn small onClick={carryAll}>Carry All Forward</Btn>
          </div>
        </div>
      )}

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

      {/* AI Planner with presets */}
      <div style={{background:`linear-gradient(135deg,${T.panel},${T.card})`,border:`1.5px solid ${T.border}`,borderRadius:14,padding:18,marginBottom:16,boxShadow:"0 2px 12px rgba(0,0,0,.08)"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:10}}>
          <Ic.AI s={16}/><span style={{fontSize:fs(13),fontWeight:700}}>AI Planner</span>
          {profile&&<Badge color={T.accent} bg={T.accentD}>{profile.name}</Badge>}
        </div>
        {!profile?<p style={{fontSize:fs(12),color:T.dim}}>Connect an AI profile in Settings first.</p>:<>
          {/* Quick actions */}
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            <Btn small v="ai" onClick={()=>generateAI("school")} disabled={aiLoading}>\📚 Plan Study</Btn>
            <Btn small v="secondary" onClick={()=>generateAI("life")} disabled={aiLoading}>\🏠 Plan Personal</Btn>
            <Btn small v="secondary" onClick={()=>generateAI("full")} disabled={aiLoading}>\📋 Plan Full Day</Btn>
            {view==="week"&&<Btn small v="secondary" onClick={()=>generateAI("week")} disabled={aiLoading}>\📅 Plan Full Week</Btn>}
          </div>

          {/* Reschedule section */}
          <div style={{background:T.input,borderRadius:10,padding:12,marginBottom:10}}>
            <div style={{fontSize:fs(11),fontWeight:700,color:T.soft,marginBottom:8}}>Reschedule Existing Calendar</div>
            <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap",alignItems:"center"}}>
              {[{k:"day",l:"This Day"},{k:"week",l:"This Week"},{k:"month",l:"This Month"},{k:"custom",l:"Custom"}].map(s=>(
                <button key={s.k} onClick={()=>setReschedScope(s.k)} style={{padding:"5px 12px",borderRadius:7,border:`1px solid ${reschedScope===s.k?T.accent:T.border}`,background:reschedScope===s.k?T.accentD:"transparent",color:reschedScope===s.k?T.accent:T.dim,fontSize:fs(10),fontWeight:600,cursor:"pointer"}}>{s.l}</button>
              ))}
              {reschedScope==="custom"&&<div style={{display:"flex",alignItems:"center",gap:4}}><input type="number" min="1" max="12" value={reschedMonths} onChange={e=>setReschedMonths(Number(e.target.value))} style={{width:50,padding:"4px 6px",fontSize:fs(11),textAlign:"center"}}/><span style={{fontSize:fs(10),color:T.dim}}>month(s)</span></div>}
            </div>
            <textarea value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} placeholder="Explain what to change: e.g. 'Move all study blocks to mornings', 'Add gym sessions MWF at 6am', 'Clear Thursday and reschedule everything to other days'..." style={{minHeight:40,fontSize:fs(11),marginBottom:8}}/>
            <div style={{display:"flex",gap:6}}>
              <Btn small v="ai" onClick={()=>generateAI("reschedule")} disabled={aiLoading}>\🔄 Reschedule</Btn>
              {aiPrompt.trim()&&<Btn small v="secondary" onClick={()=>generateAI()} disabled={aiLoading}>Send Custom</Btn>}
              {aiLoading&&<Btn small v="ghost" onClick={stopAI} style={{color:T.red,borderColor:T.red}}>\u2B1B Stop</Btn>}
            </div>
          </div>

          {aiLog.length>0&&(
            <div style={{maxHeight:180,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
              {aiLog.map((l,i)=>(
                <div key={i} style={{padding:"5px 10px",borderRadius:7,fontSize:fs(10),lineHeight:1.5,
                  background:l.type==="error"?T.redD:l.type==="tool_call"?T.purpleD:l.type==="tool_result"?T.accentD:l.type==="user"?T.blueD:T.input,
                  color:l.type==="error"?T.red:l.type==="tool_call"?T.purple:l.type==="tool_result"?T.accent:l.type==="user"?T.blue:T.text,
                  borderLeft:`3px solid ${l.type==="error"?T.red:l.type==="tool_call"?T.purple:l.type==="tool_result"?T.accent:l.type==="user"?T.blue:T.border}`,
                }}>{l.content}</div>
              ))}
            </div>
          )}
        </>}
      </div>

      {/* Category filter (day view) */}
      {view==="day" && tasks.length > 0 && (
        <div style={{display:"flex",gap:4,marginBottom:12,flexWrap:"wrap"}}>
          <button className="sf-chip" onClick={()=>setCatFilter("all")} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:fs(11),fontWeight:catFilter==="all"?700:400,cursor:"pointer",background:catFilter==="all"?T.accentD:"transparent",color:catFilter==="all"?T.accent:T.dim}}>All ({tasks.length})</button>
          {Object.entries(CAT).filter(([k])=>tasks.some(t=>t.category===k)).map(([k,v])=>(
            <button key={k} className="sf-chip" onClick={()=>setCatFilter(k)} style={{padding:"5px 12px",borderRadius:7,border:"none",fontSize:fs(11),fontWeight:catFilter===k?700:400,cursor:"pointer",background:catFilter===k?v.bg:"transparent",color:catFilter===k?v.fg:T.dim}}>{v.l} ({tasks.filter(t=>t.category===k).length})</button>
          ))}
        </div>
      )}

      {/* Content */}
      {view==="week" ? renderWeekView() : (
        filtered.length===0 ? <div style={{padding:"50px 0",textAlign:"center"}}><div style={{fontSize:fs(40),marginBottom:12,opacity:.3}}>\📋</div><p style={{color:T.dim,fontSize:fs(13)}}>{catFilter!=="all"?"No tasks in this category":"No tasks for this day"}</p></div>
        : <div style={{display:"flex",flexDirection:"column",gap:5}}>{filtered.map(renderTask)}</div>
      )}

      {showRestructure && (
        <div className="fade" style={{background:T.accentD,border:`1px solid ${T.accent}44`,borderRadius:12,padding:16,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:fs(13),fontWeight:600,color:T.accent}}>\u23E9 You finished {minsToStr(showRestructure.savedMins)} early!</div>
              <div style={{fontSize:fs(12),color:T.soft,marginTop:2}}>Shift remaining tasks forward?</div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn small onClick={()=>restructureTasks(showRestructure.savedMins)}>Shift Earlier</Btn>
              <Btn small v="ghost" onClick={()=>setShowRestructure(null)}>Keep As-Is</Btn>
            </div>
          </div>
        </div>
      )}

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
