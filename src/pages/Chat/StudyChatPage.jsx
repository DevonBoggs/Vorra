import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { dlog } from "../../systems/debug.js";
import { toast } from "../../systems/toast.js";
import { buildSystemPrompt, runAILoop, APP_VERSION, callAIWithTools, continueAfterTools } from "../../systems/api.js";
import { useBgTask, bgSet, bgLog, bgClear, bgAbort, bgStream } from "../../systems/background.js";
import { executeTools, safeArr } from "../../utils/toolExecution.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { Modal } from "../../components/ui/Modal.jsx";
import { uid, todayStr, fileToBase64 } from "../../utils/helpers.js";
import { getSTATUS_C, STATUS_L } from "../../constants/categories.js";

export const StudyChatPage=({data,setData,profile,Btn})=>{
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const[selCourse,setSelCourse]=useState(data.courses?.[0]?.id||"");
  const[input,setInput]=useState("");
  const[loading,setLoading]=useState(false);
  const[chatAbort,setChatAbort]=useState(null);
  const[imgFile,setImgFile]=useState(null);
  const[imgPrev,setImgPrev]=useState(null);
  const[showExport,setShowExport]=useState(false);
  const[searchQ,setSearchQ]=useState("");
  const messagesEnd=useRef(null);
  const fileRef=useRef(null);

  const course=data.courses?.find(c=>c.id===selCourse);
  const chatKey=selCourse||"_general";
  const messages=data.chatHistories?.[chatKey]||[];
  const hasCtx = c => safeArr(c?.competencies).length>0||safeArr(c?.topicBreakdown).length>0||safeArr(c?.examTips).length>0;

  useEffect(()=>{messagesEnd.current?.scrollIntoView({behavior:"smooth"})},[messages.length]);

  const handleImg=(e)=>{
    const f=e.target.files?.[0];if(!f)return;setImgFile(f);
    const r=new FileReader();r.onload=()=>setImgPrev(r.result);r.readAsDataURL(f);
    e.target.value='';
  };

  const stopChat = () => { if(chatAbort) { chatAbort.abort(); setChatAbort(null); setLoading(false); toast("Stopped","info"); } };

  const sendMessage=async(overrideMsg)=>{
    if(loading) { stopChat(); return; }
    const msg = overrideMsg || input.trim();
    if((!msg&&!imgFile)||!profile)return;
    const controller = new AbortController();
    setChatAbort(controller);
    if(!overrideMsg) setInput("");

    const displayMsg={role:"user",content:msg,hasImage:!!imgFile};
    const newMsgs=[...messages,displayMsg];
    setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:newMsgs}}));
    setLoading(true);

    // Rich course context including enrichment data
    let courseCtx = "No specific course selected — general study help.";
    if (course) {
      courseCtx = `Active course: ${course.name} (${course.courseCode||"no code"})
Credits: ${course.credits} CU | Difficulty: ${course.difficulty}/5 | Status: ${course.status} | Assessment: ${course.assessmentType||"unknown"}`;
      if (safeArr(course.topicBreakdown).length > 0) courseCtx += `\nTopics: ${safeArr(course.topicBreakdown).map(t=>`${t.topic} (${t.weight||"?"})`).join(", ")}`;
      if (safeArr(course.competencies).length > 0) courseCtx += `\nCompetencies: ${safeArr(course.competencies).map(c=>`${c.code||""} ${c.title}`).join("; ")}`;
      if (safeArr(course.examTips).length > 0) courseCtx += `\nExam tips: ${safeArr(course.examTips).slice(0,5).join("; ")}`;
      if (safeArr(course.knownFocusAreas).length > 0) courseCtx += `\nFocus areas: ${safeArr(course.knownFocusAreas).join(", ")}`;
      // Actual study time vs estimated
      const courseStudiedMins = (data.studySessions||[]).filter(s => s.course === course.name).reduce((s,x) => s + (x.mins||0), 0);
      const courseEstHrs = course.averageStudyHours || 0;
      if (courseEstHrs > 0) courseCtx += `\nStudy progress: ${Math.round(courseStudiedMins/6)/10}h studied of ~${courseEstHrs}h estimated (${courseStudiedMins > 0 ? Math.round(courseStudiedMins/60/courseEstHrs*100) : 0}% complete by time)`;
    }

    // Calendar context: today's tasks + this week
    const today = todayStr();
    const todayTasks = safeArr(data.tasks?.[today]);
    const todayDone = todayTasks.filter(t => t.done).length;
    let calCtx = `\n\nCALENDAR CONTEXT:`;
    if (todayTasks.length > 0) {
      calCtx += `\nToday (${today}): ${todayTasks.length} tasks, ${todayDone} done`;
      calCtx += `\n${todayTasks.map(t => `  ${t.time||"--:--"}–${t.endTime||"?"} ${t.done?"✅":"⬜"} ${t.title} [${t.category}]`).join("\n")}`;
    } else {
      calCtx += `\nToday: No tasks scheduled.`;
    }
    // Next 7 days summary
    const weekSummary = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = d.toISOString().split("T")[0];
      const dt = safeArr(data.tasks?.[ds]);
      if (dt.length > 0) weekSummary.push(`${ds} (${d.toLocaleDateString("en-US",{weekday:"short"})}): ${dt.length} tasks — ${dt.filter(t=>t.category==="study").length} study, ${dt.filter(t=>t.done).length} done`);
    }
    if (weekSummary.length > 0) calCtx += `\nUpcoming this week:\n${weekSummary.join("\n")}`;

    // Study session history
    const sessions = data.studySessions || [];
    const sessionCourseHrs = {};
    sessions.forEach(s => { sessionCourseHrs[s.course||"Unlinked"] = (sessionCourseHrs[s.course||"Unlinked"]||0) + (s.mins||0); });
    const totalStudiedMins = sessions.reduce((s,x) => s + (x.mins||0), 0);
    const todaySessMins = sessions.filter(s => s.date === today).reduce((s,x) => s + (x.mins||0), 0);
    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
    const weekSessMins = sessions.filter(s => new Date(s.date+"T12:00:00") >= weekAgo).reduce((s,x) => s + (x.mins||0), 0);
    const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate()-14);
    const recentMins = sessions.filter(s => new Date(s.date+"T12:00:00") >= twoWeeksAgo).reduce((s,x) => s + (x.mins||0), 0);
    const avgHrsDay14 = Math.round((recentMins / 60 / 14) * 10) / 10;

    let sessionCtx = `\n\nSTUDY PROGRESS:`;
    sessionCtx += `\nToday: ${Math.round(todaySessMins/6)/10}h studied | This week: ${Math.round(weekSessMins/6)/10}h | All time: ${Math.round(totalStudiedMins/6)/10}h`;
    sessionCtx += `\n14-day avg pace: ${avgHrsDay14}h/day (target: ${data.studyHoursPerDay||4}h/day) — ${avgHrsDay14 >= (data.studyHoursPerDay||4) ? "ON TRACK ✅" : "BEHIND ⚠️"}`;
    if (Object.keys(sessionCourseHrs).length > 0) {
      sessionCtx += `\nHours studied per course: ${Object.entries(sessionCourseHrs).sort((a,b)=>b[1]-a[1]).map(([c,m])=>`${c}: ${Math.round(m/6)/10}h`).join(", ")}`;
    }

    // Streak + motivation
    const streak = data.studyStreak || { currentStreak:0, longestStreak:0 };
    sessionCtx += `\nStudy streak: ${streak.currentStreak} day${streak.currentStreak!==1?"s":""} (best: ${streak.longestStreak||0}d)`;

    // Task completion velocity
    const allTaskDates = Object.keys(data.tasks || {});
    const totalTasks = allTaskDates.reduce((s,d) => s + safeArr(data.tasks[d]).length, 0);
    const doneTasks = allTaskDates.reduce((s,d) => s + safeArr(data.tasks[d]).filter(t=>t.done).length, 0);
    if (totalTasks > 0) sessionCtx += `\nTask completion: ${doneTasks}/${totalTasks} (${Math.round(doneTasks/totalTasks*100)}%)`;

    const sys=`${buildSystemPrompt(data,courseCtx + calCtx + sessionCtx)}

You are a knowledgeable study tutor with full awareness of the student's calendar, study progress, and pace.
You have tools to add tasks and courses if the student asks to schedule something.
When explaining concepts, use concrete examples and analogies.
For practice questions, provide immediate feedback with explanations.
Format code blocks with triple backticks. Use **bold** for key terms.

CONTEXT-AWARE GUIDANCE:
- Reference the student's actual calendar when suggesting what to study next.
- If they're behind on pace, acknowledge it and help them prioritize.
- If they have tasks due today, mention specific upcoming blocks.
- Use their session data to identify which courses need more attention.
- Celebrate streaks and milestones — motivation matters.
- If a course has low tracked hours vs estimated hours, flag it.
Be concise, encouraging, and actionable.`;

    const apiMsgs=newMsgs.filter(m=>m.role==="user"||m.role==="assistant").map(m=>({role:m.role,content:m.content}));

    let imageData=null;
    if(imgFile){
      const b64=await fileToBase64(imgFile);
      imageData={type:imgFile.type,data:b64};
      setImgFile(null);setImgPrev(null);
    }

    try{
      let resp=await callAIWithTools(profile,sys,apiMsgs,imageData);
      let fullText="";
      let maxLoops=5;
      while(maxLoops-->0){
        if(controller.signal.aborted) break;
        if(resp.text)fullText+=(fullText?" ":"")+resp.text;
        if(resp.toolCalls.length>0){
          const results=executeTools(resp.toolCalls,data,setData);
          const toolSummary=results.map(r=>`[${r.result}]`).join(" ");
          fullText+=(fullText?"\n\n":"")+toolSummary;
          resp=await continueAfterTools(profile,sys,apiMsgs,resp.toolCalls,results);
        }else break;
      }
      if(resp.text&&!fullText.includes(resp.text))fullText+=(fullText?"\n\n":"")+resp.text;

      const withReply=[...newMsgs,{role:"assistant",content:fullText}];
      setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:withReply}}));
    }catch(e){
      if(e.name!=='AbortError') setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:[...newMsgs,{role:"assistant",content:`Error: ${e.message}`}]}}));
    }
    setLoading(false);
    setChatAbort(null);
  };

  // Export chat as markdown
  const exportChat = () => {
    const md = messages.map(m => `**${m.role==="user"?"You":"AI"}:** ${m.content}`).join("\n\n---\n\n");
    const header = `# Study Chat — ${course?course.name:"General"}\nExported: ${new Date().toLocaleString()}\nMessages: ${messages.length}\n\n---\n\n`;
    const blob = new Blob([header+md], {type:"text/markdown"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download=`devonsync-chat-${chatKey}-${todayStr()}.md`; a.click();
    URL.revokeObjectURL(url);
    toast("Chat exported as markdown","success");
  };

  // Simple markdown rendering
  const renderMd = (text) => {
    if(!text) return null;
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part,i) => {
      if(part.startsWith("```")) {
        const code = part.replace(/^```\w*\n?/,"").replace(/```$/,"");
        return <pre key={i} style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px",fontSize:fs(11),fontFamily:"'JetBrains Mono',monospace",overflow:"auto",margin:"6px 0",whiteSpace:"pre-wrap"}}>{code}</pre>;
      }
      // Bold, inline code
      const html = part.replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:4px;font-size:12px;font-family:JetBrains Mono,monospace">$1</code>');
      return <span key={i} dangerouslySetInnerHTML={{__html:html}}/>;
    });
  };

  // Chat stats
  const msgCount = messages.length;
  const userMsgCount = messages.filter(m=>m.role==="user").length;

  // Quick actions based on course context
  const quickActions = course ? [
    // Learn
    {label:"Explain key concepts",prompt:`Explain the most important concepts in ${course.name} that I need to know for the assessment.`,cat:"learn"},
    {label:"Simplify hardest topic",prompt:`What's the hardest topic in ${course.name}? Explain it simply with an analogy a 10-year-old would understand.`,cat:"learn"},
    {label:"Create flashcards",prompt:`Create 10 flashcard-style Q&A pairs for the most important terms and concepts in ${course.name}.`,cat:"learn"},
    {label:"Teach me like I'm new",prompt:`I'm starting ${course.name} from scratch. Give me a roadmap — what concepts build on each other and what order should I learn them?`,cat:"learn"},
    {label:"Real-world examples",prompt:`Give me real-world examples for each major concept in ${course.name}. I learn better when I can see how things apply in practice.`,cat:"learn"},
    {label:"Compare & contrast",prompt:`What are the most commonly confused concepts in ${course.name}? Create a comparison table showing the differences.`,cat:"learn"},
    {label:"Memory tricks",prompt:`Give me mnemonics, acronyms, or memory tricks for the hardest-to-remember facts in ${course.name}.`,cat:"learn"},
    {label:"Explain like a story",prompt:`Explain the core framework/model in ${course.name} as a narrative story — with characters, conflict, and resolution.`,cat:"learn"},
    // Practice
    {label:"Quiz me (5 Q)",prompt:`Give me 5 practice questions for ${course.name}. After each question, wait for my answer before revealing the correct one.`,cat:"practice"},
    {label:"Scenario question",prompt:`Give me a real-world scenario question for ${course.name} — the kind that appears on WGU OAs. Make it application-level, not just recall.`,cat:"practice"},
    {label:"Fill in the blank",prompt:`Create 8 fill-in-the-blank questions covering key vocabulary and definitions from ${course.name}.`,cat:"practice"},
    {label:"True or false",prompt:`Give me 10 true/false statements about ${course.name}. Include common misconceptions as false statements. Wait for my answers.`,cat:"practice"},
    {label:"Match the terms",prompt:`Create a matching exercise: 10 terms on the left, 10 definitions on the right, shuffled. I'll match them.`,cat:"practice"},
    {label:"Case study",prompt:`Give me a detailed case study for ${course.name} with 3-4 questions I need to analyze and answer. Make it realistic.`,cat:"practice"},
    {label:"Rapid fire review",prompt:`Ask me 15 rapid-fire one-line questions about ${course.name}. I'll answer each one quickly, then grade me at the end.`,cat:"practice"},
    // Plan & Progress
    {label:"What's on today?",prompt:`Look at my calendar for today and this week. What should I focus on right now?`,cat:"plan"},
    {label:"Am I on track?",prompt:`Based on my study pace, session history, and calendar — am I on track to finish on time? What adjustments should I make?`,cat:"plan"},
    {label:"Schedule 2h study",prompt:`Schedule 2 hours of study for ${course.name} on my calendar for today.`,cat:"plan"},
    {label:"Optimize my week",prompt:`Look at my schedule for this week. Are there gaps I should fill? Am I spending too much time on anything?`,cat:"plan"},
    {label:"What's falling behind?",prompt:`Based on my course hours tracked vs estimated, which courses am I behind on? Prioritize what needs attention.`,cat:"plan"},
    // Assessment Prep
    ...(course.assessmentType==="PA"?[
      {label:"PA walkthrough",prompt:`Walk me through how to approach the Performance Assessment for ${course.name}. What are the key deliverables and rubric sections?`,cat:"assess"},
      {label:"PA rubric tips",prompt:`What do evaluators specifically look for in each section of the ${course.name} PA? How do I avoid getting sent back for revisions?`,cat:"assess"},
      {label:"PA outline template",prompt:`Create an outline/template I can follow to write my ${course.name} PA paper. Include section headers, approximate word counts, and key points to hit.`,cat:"assess"},
    ]:[]),
    ...(course.assessmentType==="OA"||course.assessmentType==="OA+PA"?[
      {label:"OA strategy",prompt:`What are the best strategies for passing the OA for ${course.name}? Cover format, time limit, common traps, and which competencies to prioritize.`,cat:"assess"},
      {label:"OA question types",prompt:`What types of questions appear on the ${course.name} OA? Multiple choice, multi-select, drag-and-drop? What formats should I prepare for?`,cat:"assess"},
      {label:"Last-minute review",prompt:`I'm taking the ${course.name} OA tomorrow. Give me a focused last-minute review — only the highest-weighted topics and most commonly missed concepts.`,cat:"assess"},
    ]:[]),
    {label:"Weak areas",prompt:`Based on the topic breakdown for ${course.name}, which areas are most commonly failed and what should I focus on?`,cat:"assess"},
    {label:"Predict my readiness",prompt:`Based on what I've studied so far for ${course.name}, do you think I'm ready for the assessment? What gaps remain?`,cat:"assess"},
    // Motivation & Wellness
    {label:"I'm stuck",prompt:`I'm stuck on ${course.name} and feeling frustrated. Help me break through — what's a different angle I can approach this from?`,cat:"wellness"},
    {label:"Motivate me",prompt:`I'm losing motivation. Remind me why finishing ${course.name} matters and give me a concrete micro-goal for the next 30 minutes.`,cat:"wellness"},
    {label:"Pomodoro plan",prompt:`Create a Pomodoro study plan for the next 2 hours on ${course.name}. 25-min focused blocks with specific topics per block.`,cat:"wellness"},
  ] : [
    // General — no course selected
    {label:"What should I study?",prompt:"Based on my calendar, courses, and progress — what should I focus on right now?",cat:"plan"},
    {label:"Am I on track?",prompt:"Look at my study pace, hours logged, and schedule. Am I on track to finish on time? What should I change?",cat:"plan"},
    {label:"Plan my week",prompt:"Help me plan my study schedule for this week based on my courses and current progress.",cat:"plan"},
    {label:"Priority order",prompt:"Based on my courses, difficulty, and deadlines — what order should I study them in and why?",cat:"plan"},
    {label:"Course overview",prompt:"Give me a one-paragraph summary of each of my remaining courses — what they cover and what to expect.",cat:"learn"},
    {label:"Easiest wins",prompt:"Which of my remaining courses are the quickest to pass? Help me plan to knock out easy wins first for momentum.",cat:"plan"},
    {label:"Study techniques",prompt:"What are the most effective study techniques for WGU online courses? Be specific to OA vs PA.",cat:"learn"},
    {label:"Burnout recovery",prompt:"I'm feeling burned out. Give me specific, actionable strategies to recover and get back on track with my WGU courses.",cat:"wellness"},
    {label:"Accountability check",prompt:"Be my accountability partner. Look at my progress data and give me honest, direct feedback on how I'm doing.",cat:"wellness"},
    {label:"Weekend plan",prompt:"Plan a productive but balanced weekend study schedule. Include study blocks, breaks, and personal time.",cat:"plan"},
  ];

  return(
    <div className="fade" style={{display:"flex",flexDirection:"column",height:"calc(100vh - 56px)"}}>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10,flexShrink:0}}>
        <div><h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Study Chat</h1><p style={{color:T.dim,fontSize:fs(13)}}>AI tutor with tool-use — schedule tasks, get explanations, practice questions</p></div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <select value={selCourse} onChange={e=>setSelCourse(e.target.value)} style={{width:220}}>
            <option value="">General Help</option>
            {(data.courses||[]).map(c=><option key={c.id} value={c.id}>{c.name} {hasCtx(c)?"✓":""}</option>)}
          </select>
          {messages.length>0&&<Btn small v="ghost" onClick={exportChat} title="Export chat as markdown">📋</Btn>}
          <Btn small v="ghost" onClick={()=>setData(d=>({...d,chatHistories:{...d.chatHistories,[chatKey]:[]}}))} title="Clear chat history">Clear</Btn>
        </div>
      </div>

      {/* Course context bar */}
      {course&&<div style={{background:T.panel,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 14px",marginBottom:10,display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap"}}>
        <span style={{fontSize:fs(12),fontWeight:600}}>{course.name}</span>
        <Badge color={STATUS_C[course.status]||T.dim} bg={(STATUS_C[course.status]||T.dim)+"22"}>{STATUS_L[course.status]||course.status}</Badge>
        {course.assessmentType&&<Badge color={T.blue} bg={T.blueD}>{course.assessmentType}</Badge>}
        {hasCtx(course)?<Badge color={T.accent} bg={T.accentD}>ENRICHED — full context available</Badge>:<Badge color={T.orange} bg={T.orangeD}>Basic — enrich in Course Planner for better answers</Badge>}
        <span style={{fontSize:fs(10),color:T.dim,marginLeft:"auto"}}>{msgCount} messages</span>
      </div>}

      {!profile&&<div style={{padding:"40px 0",textAlign:"center",color:T.dim}}><p style={{fontSize:fs(13)}}>Connect an AI profile in Settings to start chatting.</p></div>}

      {/* Messages */}
      {profile&&<div style={{flex:1,overflowY:"auto",marginBottom:10,display:"flex",flexDirection:"column",gap:8}}>
        {messages.length===0&&<div style={{padding:"20px 0",color:T.dim,fontSize:fs(13)}}>
          <p style={{marginBottom:12,textAlign:"center"}}>Ask about {course?course.name:"anything"}.</p>
          {(() => {
            const cats = {learn:{l:"📚 Learn",c:T.blue},practice:{l:"🎯 Practice",c:T.purple},plan:{l:"📅 Plan & Progress",c:T.accent},assess:{l:"📝 Assessment Prep",c:T.orange},wellness:{l:"💪 Motivation & Wellness",c:"#f472b6"}};
            const grouped = {};
            quickActions.forEach(q => { const k=q.cat||"learn"; if(!grouped[k])grouped[k]=[]; grouped[k].push(q); });
            return (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {Object.entries(grouped).map(([cat,actions]) => {
                  const info = cats[cat]||{l:cat,c:T.soft};
                  return (
                    <div key={cat}>
                      <div style={{fontSize:fs(10),fontWeight:700,color:info.c,marginBottom:4}}>{info.l}</div>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                        {actions.map((q,i) => (
                          <button key={i} onClick={()=>sendMessage(q.prompt)} style={{background:T.input,border:`1px solid ${info.c}33`,borderRadius:8,padding:"8px 14px",color:T.soft,fontSize:fs(11),cursor:"pointer",fontWeight:500}}>{q.label}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>}
        {messages.map((m,i)=><div key={i} style={{display:"flex",justifyContent:m.role==="user"?"flex-end":"flex-start"}}>
          <div style={{maxWidth:"78%",padding:"10px 14px",borderRadius:12,fontSize:fs(13),lineHeight:1.6,background:m.role==="user"?T.accent:T.card,color:m.role==="user"?"#060e09":T.text,border:m.role==="user"?"none":`1px solid ${T.border}`,whiteSpace:"pre-wrap"}}>
            {m.hasImage&&<span style={{fontSize:fs(10),opacity:.7}}>📷 Image attached<br/></span>}
            {m.role==="assistant"?renderMd(m.content):m.content}
          </div>
        </div>)}
        {loading&&<div style={{display:"flex",alignItems:"center",gap:6,padding:"8px 14px",color:T.soft,fontSize:fs(12)}}><Ic.Spin s={14}/> Thinking...</div>}
        <div ref={messagesEnd}/>
      </div>}

      {/* Quick actions bar (when chat has messages) */}
      {profile && messages.length > 0 && !loading && (
        <div style={{display:"flex",gap:4,flexShrink:0,marginBottom:6,overflowX:"auto",paddingBottom:2}}>
          {quickActions.slice(0,5).map((q,i)=>(
            <button key={i} className="sf-chip" onClick={()=>sendMessage(q.prompt)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:7,padding:"6px 12px",color:T.dim,fontSize:fs(10),cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{q.label}</button>
          ))}
        </div>
      )}

      {/* Image preview */}
      {imgPrev&&<div style={{padding:"6px 0",flexShrink:0,display:"flex",alignItems:"center",gap:8}}>
        <img src={imgPrev} style={{height:50,borderRadius:8,border:`1px solid ${T.border}`}} alt="upload"/>
        <span style={{fontSize:fs(10),color:T.soft}}>{imgFile?.name}</span>
        <button onClick={()=>{setImgFile(null);setImgPrev(null)}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer"}}><Ic.X s={14}/></button>
      </div>}

      {/* Input bar */}
      {profile&&<div style={{display:"flex",gap:8,flexShrink:0}}>
        <button onClick={()=>fileRef.current?.click()} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:9,padding:"0 14px",cursor:"pointer",color:T.soft,display:"flex",alignItems:"center"}}><Ic.Img s={16}/></button>
        <input ref={fileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImg}/>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&sendMessage()} placeholder={`Ask about ${course?course.name:"studying"}...`} style={{flex:1,padding:"12px 16px",fontSize:fs(14)}}/>
        <Btn onClick={()=>sendMessage()} disabled={!loading&&(!input.trim()&&!imgFile)} style={{padding:"12px 20px",background:loading?T.red:undefined}}>{loading?<span style={{fontSize:fs(12),fontWeight:700}}>⬛ Stop</span>:<Ic.Send s={16}/>}</Btn>
      </div>}
    </div>
  );
};

export default StudyChatPage;
