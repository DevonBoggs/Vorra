import { useState, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, minsToStr, pad, diffDays, parseTime } from "../../utils/helpers.js";
import { getCAT, STUDY_CATS } from "../../constants/categories.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { useDebugLog } from "../../systems/debug.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { ProgressBar } from "../../components/ui/ProgressBar.jsx";

const WeeklyReportPage = ({ data, Btn }) => {
  const T = useTheme();
  const CAT = getCAT(T);
  const bp = useBreakpoint();
  const [weekOffset, setWeekOffset] = useState(0);

  const getWeekDates = (offset) => {
    const now = new Date(); now.setDate(now.getDate() + offset * 7);
    const day = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const dates = [];
    const d = new Date(mon);
    for (let i=0; i<7; i++) { dates.push(d.toISOString().split("T")[0]); d.setDate(d.getDate() + 1); }
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { dates, monStr: mon.toLocaleDateString("en-US",{month:"short",day:"numeric"}), sunStr: sun.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}) };
  };

  const week = getWeekDates(weekOffset);
  const prevWeek = getWeekDates(weekOffset - 1);
  const tasks = data.tasks || {};
  const courses = data.courses || [];
  const sessions = data.studySessions || [];
  const streak = data.studyStreak || { currentStreak:0, longestStreak:0 };

  // Tasks for week
  const weekTasks = week.dates.flatMap(d => (tasks[d]||[]).map(t => ({...t, date: d})));
  const totalTasks = weekTasks.length;
  const completedTasks = weekTasks.filter(t => t.done).length;
  const studyTasks = weekTasks.filter(t => STUDY_CATS.includes(t.category));
  const studyCompleted = studyTasks.filter(t => t.done).length;
  const completionRate = totalTasks > 0 ? Math.round((completedTasks/totalTasks)*100) : 0;

  const calcHours = (taskList) => taskList.reduce((s, t) => {
    const st = parseTime(t.time), en = parseTime(t.endTime);
    return s + (st && en ? Math.max(0, (en.mins - st.mins) / 60) : 0);
  }, 0);
  const totalScheduledHrs = Math.round(calcHours(weekTasks) * 10) / 10;
  const completedStudyHrs = Math.round(calcHours(studyTasks.filter(t => t.done)) * 10) / 10;

  // Sessions for this week
  const weekSessions = sessions.filter(s => week.dates.includes(s.date));
  const weekSessionMins = weekSessions.reduce((s,x) => s + (x.mins||0), 0);
  const weekSessionHrs = Math.round(weekSessionMins/6)/10;

  // Prev week sessions for comparison
  const prevSessions = sessions.filter(s => prevWeek.dates.includes(s.date));
  const prevSessionMins = prevSessions.reduce((s,x) => s + (x.mins||0), 0);
  const prevSessionHrs = Math.round(prevSessionMins/6)/10;
  const sessionDelta = weekSessionHrs - prevSessionHrs;

  // By day breakdown
  const byDay = week.dates.map(d => {
    const dt = tasks[d] || [];
    const daySessions = weekSessions.filter(s => s.date === d);
    const sessionMins = daySessions.reduce((s,x) => s + (x.mins||0), 0);
    return { date: d, dayName: new Date(d+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}), total: dt.length, done: dt.filter(t=>t.done).length, hrs: Math.round(calcHours(dt)*10)/10, sessionMins, didStudy: sessionMins > 0 || daySessions.length > 0 };
  });

  // By category
  const byCat = {};
  weekTasks.forEach(t => { const c = t.category || "other"; if (!byCat[c]) byCat[c] = {total:0,done:0,hrs:0}; byCat[c].total++; if (t.done) byCat[c].done++; const st=parseTime(t.time),en=parseTime(t.endTime); if(st&&en) byCat[c].hrs+=Math.max(0,(en.mins-st.mins)/60); });

  // Course activity from sessions
  const courseActivity = {};
  weekSessions.forEach(s => {
    const name = s.course || "Unlinked";
    if (!courseActivity[name]) courseActivity[name] = { mins:0, count:0 };
    courseActivity[name].mins += (s.mins||0);
    courseActivity[name].count++;
  });
  // Also add task-based course matching
  studyTasks.forEach(t => {
    const match = courses.find(c => t.title.toLowerCase().includes(c.name.toLowerCase().split(" – ")[0].split(" - ")[0]) || (c.courseCode && t.title.toLowerCase().includes(c.courseCode.toLowerCase())));
    const name = match ? match.name : "Other Study";
    if (!courseActivity[name]) courseActivity[name] = { mins:0, count:0 };
    if (t.done) courseActivity[name].count++;
  });

  // Study days this week
  const studyDays = byDay.filter(d => d.didStudy).length;

  // Velocity
  const allTimeMins = sessions.reduce((s,x) => s + (x.mins||0), 0);
  const uniqueDays = [...new Set(sessions.map(s => s.date))].length;
  const avgMinsPerStudyDay = uniqueDays > 0 ? Math.round(allTimeMins / uniqueDays) : 0;

  return (
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Weekly Report</h1>
          <p style={{color:T.dim,fontSize:fs(13)}}>{week.monStr} — {week.sunStr}</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <Btn small v="ghost" onClick={()=>setWeekOffset(w=>w-1)}>← Prev</Btn>
          <Btn small v={weekOffset===0?"primary":"ghost"} onClick={()=>setWeekOffset(0)}>This Week</Btn>
          <Btn small v="ghost" onClick={()=>setWeekOffset(w=>w+1)}>Next →</Btn>
        </div>
      </div>

      {/* Summary Cards — 2 rows */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:16}}>
        {[
          {l:"Tasks Done",v:`${completedTasks}/${totalTasks}`,c:T.accent,sub:`${completionRate}% complete`},
          {l:"Study Tasks",v:`${studyCompleted}/${studyTasks.length}`,c:T.purple,sub:`of ${studyTasks.length} planned`},
          {l:"Tracked Time",v:`${weekSessionHrs}h`,c:T.blue,sub:sessionDelta!==0?`${sessionDelta>0?"+":""}${sessionDelta}h vs last wk`:"first week"},
          {l:"Study Days",v:`${studyDays}/7`,c:studyDays>=5?T.accent:studyDays>=3?T.orange:T.red,sub:studyDays>=5?"Consistent!":studyDays>=3?"Good pace":"Needs more"},
          {l:"Streak",v:`${streak.currentStreak}d`,c:streak.currentStreak>=7?T.accent:streak.currentStreak>=3?T.orange:T.dim,sub:`Best: ${streak.longestStreak||0}d`},
        ].map((s,i)=>(
          <div key={i} className="fade sf-stat" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:14,textAlign:"center",animationDelay:`${i*40}ms`}}>
            <div style={{fontSize:fs(9),color:T.dim,textTransform:"uppercase",letterSpacing:.5,fontWeight:600,marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:fs(20),fontWeight:800,color:s.c,fontFamily:"'Outfit',sans-serif"}}>{s.v}</div>
            <div style={{fontSize:fs(10),color:T.dim,marginTop:2}}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Daily Breakdown with session tracking */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
        <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:12}}>Daily Breakdown</h3>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8}}>
          {byDay.map((d,i) => {
            const pct = d.total > 0 ? Math.round((d.done/d.total)*100) : 0;
            const isToday = d.date === todayStr();
            const sessionHrs = Math.round(d.sessionMins/6)/10;
            return (
              <div key={i} style={{background:isToday?T.accentD:T.input,border:`1px solid ${isToday?T.accent+"44":T.border}`,borderRadius:10,padding:10,textAlign:"center"}}>
                <div style={{fontSize:fs(11),fontWeight:700,color:isToday?T.accent:T.soft,marginBottom:2}}>{d.dayName}</div>
                <div style={{fontSize:fs(10),color:T.dim,marginBottom:6}}>{new Date(d.date+"T12:00:00").getDate()}</div>
                <div style={{height:40,display:"flex",alignItems:"flex-end",justifyContent:"center",gap:3,marginBottom:6}}>
                  <div style={{width:12,background:T.accent,borderRadius:3,height:`${Math.min(40,Math.max(4,d.done/Math.max(1,d.total)*40))}px`}} title={`${d.done} done`}/>
                  <div style={{width:12,background:T.border,borderRadius:3,height:`${Math.min(40,Math.max(4,(d.total-d.done)/Math.max(1,d.total)*40))}px`}} title={`${d.total-d.done} remaining`}/>
                </div>
                <div style={{fontSize:fs(10),fontWeight:600,color:pct>=80?T.accent:pct>=50?T.orange:d.total>0?T.red:T.dim}}>{d.total > 0 ? `${pct}%` : "—"}</div>
                {sessionHrs>0&&<div style={{fontSize:fs(9),color:T.blue,fontWeight:600,marginTop:2}}>⏱ {sessionHrs}h</div>}
                {d.didStudy&&<div style={{fontSize:fs(8),color:T.accent,marginTop:1}}>✓ studied</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Two-column: Category + Course Activity */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(350px,1fr))",gap:16,marginBottom:16}}>
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:12}}>By Category</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(byCat).sort((a,b)=>b[1].hrs-a[1].hrs).map(([cat,v]) => {
              const c = CAT[cat] || CAT.other;
              const pct = v.total > 0 ? Math.round((v.done/v.total)*100) : 0;
              return (
                <div key={cat} style={{display:"flex",alignItems:"center",gap:8}}>
                  <Badge color={c.fg} bg={c.bg}>{c.l}</Badge>
                  <div style={{flex:1,height:6,borderRadius:3,background:T.bg2,overflow:"hidden"}}>
                    <div style={{width:`${pct}%`,height:"100%",background:c.fg,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:fs(10),color:T.dim,minWidth:55,textAlign:"right"}}>{v.done}/{v.total} · {Math.round(v.hrs*10)/10}h</span>
                </div>
              );
            })}
            {Object.keys(byCat).length === 0 && <div style={{color:T.dim,fontSize:fs(12),textAlign:"center",padding:12}}>No tasks this week</div>}
          </div>
        </div>

        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:12}}>Course Study Time</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(courseActivity).filter(([,v])=>v.mins>0).sort((a,b)=>b[1].mins-a[1].mins).map(([name,v]) => {
              const course = courses.find(c => c.name === name);
              const estHrs = course?.averageStudyHours || 0;
              const hrs = Math.round(v.mins/6)/10;
              return (
                <div key={name} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:fs(11),color:T.text,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</span>
                  <span style={{fontSize:fs(10),color:T.accent,fontWeight:600}}>{hrs}h</span>
                  {estHrs>0&&<span style={{fontSize:fs(9),color:T.dim}}>/{estHrs}h</span>}
                  <span style={{fontSize:fs(9),color:T.dim}}>{v.count}×</span>
                </div>
              );
            })}
            {Object.keys(courseActivity).filter(k=>courseActivity[k].mins>0).length === 0 && <div style={{color:T.dim,fontSize:fs(12),textAlign:"center",padding:12}}>No tracked sessions this week</div>}
          </div>
        </div>
      </div>

      {/* Velocity & Insights */}
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16}}>
        <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:10}}>Insights & Velocity</h3>
        <div style={{display:"flex",flexDirection:"column",gap:6,fontSize:fs(12),color:T.soft}}>
          {completionRate >= 80 && <div style={{padding:"6px 10px",background:T.accentD,borderRadius:6,borderLeft:`3px solid ${T.accent}`,color:T.accent}}>Excellent week! {completionRate}% task completion rate.</div>}
          {completionRate >= 50 && completionRate < 80 && <div style={{padding:"6px 10px",background:T.orangeD,borderRadius:6,borderLeft:`3px solid ${T.orange}`,color:T.orange}}>Decent week at {completionRate}%. Push for 80%+ next week.</div>}
          {completionRate > 0 && completionRate < 50 && <div style={{padding:"6px 10px",background:T.redD,borderRadius:6,borderLeft:`3px solid ${T.red}`,color:T.red}}>Tough week — only {completionRate}% completed. Consider adjusting your plan.</div>}
          {totalTasks === 0 && <div style={{padding:"6px 10px",background:T.input,borderRadius:6,color:T.dim}}>No tasks scheduled. Use Study Planner to generate a study plan.</div>}
          {weekSessionHrs > 0 && <div style={{color:T.soft}}>You logged {weekSessionHrs}h of focused study across {studyDays} day{studyDays!==1?"s":""}.</div>}
          {avgMinsPerStudyDay > 0 && <div style={{color:T.soft}}>Your all-time average is {Math.round(avgMinsPerStudyDay/6)/10}h per study day ({uniqueDays} days tracked).</div>}
          {sessionDelta > 0 && <div style={{color:T.accent}}>Up {sessionDelta}h from last week — keep it going!</div>}
          {sessionDelta < 0 && <div style={{color:T.orange}}>Down {Math.abs(sessionDelta)}h from last week. Try to get back on track.</div>}
          {byDay.filter(d => d.total > 0 && d.done === d.total).length > 0 && <div style={{color:T.accent}}>Perfect days: {byDay.filter(d => d.total > 0 && d.done === d.total).map(d => d.dayName).join(", ")}</div>}
          {byDay.filter(d => d.total > 0 && d.done === 0).length > 0 && <div style={{color:T.orange}}>Missed days: {byDay.filter(d => d.total > 0 && d.done === 0).map(d => d.dayName).join(", ")}</div>}
          {streak.currentStreak >= 7 && <div style={{color:T.accent}}>🔥 {streak.currentStreak}-day study streak! Longest: {streak.longestStreak}d.</div>}
        </div>
      </div>
    </div>
  );
};

export { WeeklyReportPage };
export default WeeklyReportPage;
