import { useState, useEffect, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, diffDays, minsToStr, parseTime } from "../../utils/helpers.js";
import { getSTATUS_C, STATUS_L, STUDY_CATS } from "../../constants/categories.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { toast } from "../../systems/toast.js";
import { Badge } from "../../components/ui/Badge.jsx";
import { Btn } from "../../components/ui/Btn.jsx";
import { safeArr } from "../../utils/toolExecution.js";
import { WidgetGrid } from "../../components/widgets/WidgetGrid.jsx";
import { hasCtx } from "../../utils/courseHelpers.js";
import { CourseDetail } from "../../components/course/CourseDetail.jsx";
import { ErrorBoundary } from "../../components/ui/ErrorBoundary.jsx";

const DegreeDashboard = ({ data, setData, setPage, setDate }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const [filter, setFilter] = useState("all");
  const [showCheckin, setShowCheckin] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const courses = data.courses || [];
  const sessions = data.studySessions || [];
  const streak = data.studyStreak || { lastStudyDate:"", currentStreak:0, longestStreak:0 };
  const totalCU = courses.reduce((s,c) => s + (c.credits||0), 0);
  const doneCU = courses.filter(c => c.status === "completed").reduce((s,c) => s + (c.credits||0), 0);
  const remainCU = totalCU - doneCU;
  const daysLeft = data.targetDate ? Math.max(0, diffDays(todayStr(), data.targetDate)) : null;
  const hrsPerDay = data.studyHoursPerDay || 4;
  const activeCourses = courses.filter(c => c.status !== "completed");
  const totalEstHrs = activeCourses.reduce((s,c) => s + (c.averageStudyHours > 0 ? c.averageStudyHours : ([0,20,35,50,70,100][c.difficulty||3]||50)), 0);
  const earlyFinishWeeks = 0; // legacy compat
  const exDates = safeArr(data.exceptionDates);
  const rawDaysNeeded = hrsPerDay > 0 ? Math.ceil(totalEstHrs / hrsPerDay) : 0;

  // Two-date system: targetCompletionDate = when student wants to finish, targetDate = term end
  const goalDate = data.targetCompletionDate || data.targetDate || null;
  const termEndDate = data.targetDate || null;
  const daysToGoal = goalDate ? Math.max(0, diffDays(todayStr(), goalDate)) : null;
  const daysToTermEnd = termEndDate ? Math.max(0, diffDays(todayStr(), termEndDate)) : null;

  // Actual scheduled hours from calendar
  const allTaskDates = Object.keys(data.tasks || {});
  const futureDatesWithTasks = allTaskDates.filter(d => d >= todayStr()).sort();
  const scheduledStudyMins = futureDatesWithTasks.reduce((s, d) => {
    return s + safeArr(data.tasks[d]).filter(t => STUDY_CATS.includes(t.category)).reduce((ms, t) => {
      const st = parseTime(t.time), et = parseTime(t.endTime);
      return ms + (st && et ? Math.max(0, et.mins - st.mins) : 0);
    }, 0);
  }, 0);
  const scheduledHrs = Math.round(scheduledStudyMins / 6) / 10;
  // Only count days that actually have study/exam tasks
  const studyDatesWithTasks = futureDatesWithTasks.filter(d => safeArr(data.tasks[d]).some(t => STUDY_CATS.includes(t.category)));
  const lastScheduledDate = studyDatesWithTasks.length > 0 ? studyDatesWithTasks[studyDatesWithTasks.length - 1] : null;
  const scheduleFinish = lastScheduledDate;

  // Global conflict scan — check all future dates for time overlaps
  const globalConflicts = useMemo(() => {
    let totalConflicts = 0;
    const conflictDateList = [];
    for (const d of futureDatesWithTasks) {
      const dt = safeArr(data.tasks[d]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
      let dayConflicts = 0;
      for (let i=0; i<dt.length; i++) {
        const as = parseTime(dt[i].time), ae = parseTime(dt[i].endTime);
        if(!as||!ae) continue;
        for (let j=i+1; j<dt.length; j++) {
          const bs = parseTime(dt[j].time), be = parseTime(dt[j].endTime);
          if(!bs||!be) continue;
          if(as.mins < be.mins && ae.mins > bs.mins) { totalConflicts++; dayConflicts++; }
        }
      }
      if (dayConflicts > 0) conflictDateList.push({date:d, count:dayConflicts});
    }
    return { totalConflicts, conflictDays: conflictDateList.length, dates: conflictDateList };
  }, [data.tasks]);

  // Two-date system: goalDate is the completion target
  const effectiveTarget = goalDate; // alias for compat
  const effectiveDaysLeft = daysToGoal;

  // Study sessions stats
  const todaySessions = sessions.filter(s => s.date === todayStr());
  const todayMins = todaySessions.reduce((s,x) => s + (x.mins||0), 0);
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate()-7);
  const weekSessions = sessions.filter(s => new Date(s.date+"T12:00:00") >= weekAgo);
  const weekMins = weekSessions.reduce((s,x) => s + (x.mins||0), 0);
  const totalStudiedMins = sessions.reduce((s,x) => s + (x.mins||0), 0);

  // Per-course studied hours
  const courseHours = {};
  sessions.forEach(s => {
    const key = s.course || "Unlinked";
    courseHours[key] = (courseHours[key]||0) + (s.mins||0);
  });

  // Velocity: avg hours/day over last 14 days
  const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate()-14);
  const recentSessions = sessions.filter(s => new Date(s.date+"T12:00:00") >= twoWeeksAgo);
  const recentMins = recentSessions.reduce((s,x) => s + (x.mins||0), 0);
  const avgHrsPerDay14 = Math.round((recentMins / 60 / 14) * 10) / 10;
  const estDaysAtPace = avgHrsPerDay14 > 0 ? Math.ceil(totalEstHrs / avgHrsPerDay14) : null;

  // Estimated finish date (pure study days from now, skipping exceptions)
  const calcFinish = (hrs) => {
    if (!hrs || hrs <= 0 || !data.studyStartDate) return null;
    let d = new Date(Math.max(new Date(data.studyStartDate+"T12:00:00"), new Date())); let rem = rawDaysNeeded;
    for (let i=0; i<rem+exDates.length+365 && rem>0; i++) { const ds=d.toISOString().split("T")[0]; if(!exDates.includes(ds)) rem--; d.setDate(d.getDate()+1); }
    return d.toISOString().split("T")[0];
  };
  // Use blueprint finish date if available, otherwise linear estimate
  const blueprintFinish = (() => {
    if (!data.scheduleOutline?.weeks?.length) return null;
    const outline = data.scheduleOutline;
    const lastWeek = outline.weeks[outline.weeks.length - 1];
    if (!lastWeek?.week_of) return null;
    const d = new Date(lastWeek.week_of + 'T12:00:00');
    d.setDate(d.getDate() + 6); // end of last week
    return d.toISOString().split('T')[0];
  })();
  const estFinish = blueprintFinish || calcFinish(hrsPerDay);

  const tasks = data.tasks || {};
  const today = todayStr();

  // Study check-in prompt logic
  useEffect(() => {
    const lastCheckin = localStorage.getItem('ds-last-checkin');
    if (lastCheckin !== todayStr() && sessions.length > 0 && streak.lastStudyDate && streak.lastStudyDate !== todayStr()) {
      const timer = setTimeout(() => setShowCheckin(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const logManualSession = (didStudy) => {
    localStorage.setItem('ds-last-checkin', todayStr());
    setShowCheckin(false);
    if (didStudy) {
      toast("Great job! Your streak continues.", "success");
    } else {
      toast("No worries \u2014 get back to it today!", "info");
    }
  };

  // Course filter
  const filtered = filter === "all" ? courses : courses.filter(c => c.status === filter);
  return (
    <div className="fade">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
        <div><h1 style={{fontSize:fs(24),fontWeight:800,marginBottom:2}}>Degree Dashboard</h1><p style={{color:T.dim,fontSize:fs(13)}}>Your degree progress at a glance</p></div>
        <Btn v="ai" onClick={()=>setPage("courses")}><Ic.Edit s={14}/> My Courses</Btn>
      </div>

      {/* Welcome Back Banner — returning user detection */}
      {(() => {
        const daysSinceLastStudy = streak.lastStudyDate ? diffDays(streak.lastStudyDate, todayStr()) : null;
        if (daysSinceLastStudy !== null && daysSinceLastStudy >= 3) return (
          <div className="fade" style={{background:`linear-gradient(135deg, ${T.accentD}, ${T.purpleD})`,border:`1.5px solid ${T.accent}55`,borderRadius:14,padding:"18px 22px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
            <div>
              <div style={{fontSize:fs(15),fontWeight:700,color:T.text}}>Welcome back!</div>
              <div style={{fontSize:fs(12),color:T.soft,marginTop:2}}>You've been away {daysSinceLastStudy} days. Your plan may need adjusting.</div>
            </div>
            <Btn small v="primary" onClick={()=>setPage("planner")}>Replan from Today {"\u2192"}</Btn>
          </div>
        );
        return null;
      })()}

      {/* Study Check-in Prompt */}
      {showCheckin && !(streak.lastStudyDate && diffDays(streak.lastStudyDate, todayStr()) >= 3) && (
        <div className="fade" style={{background:`linear-gradient(135deg, ${T.purpleD}, ${T.accentD})`,border:`1.5px solid ${T.purple}55`,borderRadius:14,padding:"16px 22px",marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
          <div>
            <div style={{fontSize:fs(14),fontWeight:700,color:T.text}}>Did you study yesterday?</div>
            <div style={{fontSize:fs(11),color:T.soft}}>Keep your streak alive! Current: {streak.currentStreak} day{streak.currentStreak!==1?"s":""}</div>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn small v="primary" onClick={()=>logManualSession(true)}>Yes!</Btn>
            <Btn small v="ghost" onClick={()=>logManualSession(false)}>Not today</Btn>
          </div>
        </div>
      )}

      {/* School profile nudge — when courses exist but no profile is set */}
      {courses.length > 0 && !data.universityProfile?.name && (
        <div className="fade" style={{padding:"12px 18px",borderRadius:10,background:`linear-gradient(135deg, ${T.purpleD}, ${T.blueD})`,border:`1px solid ${T.purple}33`,marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
          <div>
            <div style={{fontSize:fs(12),fontWeight:700,color:T.text}}>Set your school profile</div>
            <div style={{fontSize:fs(10),color:T.soft}}>Get personalized study recommendations tailored to your institution's grading system and assessment model.</div>
          </div>
          <Btn small v="ghost" onClick={()=>setPage("settings")} style={{flexShrink:0}}>Set Up {"\u2192"}</Btn>
        </div>
      )}

      {/* Customizable Widget Grid */}
      <WidgetGrid
        widgets={data.dashboardWidgets}
        data={data}
        setData={setData}
        setPage={setPage}
        setDate={setDate}
        Btn={Btn}
      />

      {/* Plan Health Widget */}
      {(() => {
        const lastPlan = (data.planHistory || []).slice(-1)[0];
        if (!lastPlan) return null;
        const planId = lastPlan.planId;
        let done = 0, total = 0, totalMins = 0, doneMins = 0;
        const today = todayStr();
        for (const [dt, dayTasks] of Object.entries(data.tasks || {})) {
          for (const t of safeArr(dayTasks)) {
            if (t.planId !== planId) continue;
            total++;
            const st = parseTime(t.time), et = parseTime(t.endTime);
            const mins = st && et ? Math.max(0, et.mins - st.mins) : 0;
            totalMins += mins;
            if (t.done) { done++; doneMins += mins; }
          }
        }
        if (total === 0) return null;
        const pct = Math.round((doneMins / totalMins) * 100);
        const doneHrs = Math.round(doneMins / 60 * 10) / 10;
        const totalHrs = Math.round(totalMins / 60 * 10) / 10;
        const remainHrs = Math.round((totalMins - doneMins) / 60 * 10) / 10;
        // Streak
        let streak = 0;
        const allDates = Object.keys(data.tasks || {}).filter(d => d <= today).sort().reverse();
        for (const dt of allDates) {
          const dayPlanTasks = safeArr(data.tasks[dt]).filter(t => t.planId === planId);
          if (dayPlanTasks.length === 0) continue;
          if (dayPlanTasks.some(t => t.done)) streak++;
          else break;
        }
        return (
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <h3 style={{fontSize:fs(14),fontWeight:700,margin:0}}>Plan Health</h3>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {streak > 0 && <Badge color={T.accent} bg={T.accentD}>{"\uD83D\uDD25"} {streak}d streak</Badge>}
                <button onClick={()=>setPage("planner")} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:fs(10),fontWeight:600,textDecoration:"underline"}}>View plan {"\u2192"}</button>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:fs(10),color:T.dim,marginBottom:4}}>
              <span>{doneHrs}h / {totalHrs}h completed</span>
              <span style={{fontWeight:700,color:pct>=80?T.accent:T.text}}>{pct}%</span>
            </div>
            <div style={{height:8,borderRadius:4,background:T.input,overflow:"hidden",marginBottom:8}}>
              <div style={{height:"100%",width:`${pct}%`,borderRadius:4,background:`linear-gradient(90deg, ${T.accent}, ${T.blue})`,transition:"width .6s"}}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <div style={{flex:1,padding:"6px 10px",background:T.input,borderRadius:6,textAlign:"center"}}>
                <div style={{fontSize:fs(14),fontWeight:700,color:T.text}}>{done}/{total}</div>
                <div style={{fontSize:fs(9),color:T.dim}}>tasks done</div>
              </div>
              <div style={{flex:1,padding:"6px 10px",background:T.input,borderRadius:6,textAlign:"center"}}>
                <div style={{fontSize:fs(14),fontWeight:700,color:T.accent}}>{remainHrs}h</div>
                <div style={{fontSize:fs(9),color:T.dim}}>remaining</div>
              </div>
              <div style={{flex:1,padding:"6px 10px",background:T.input,borderRadius:6,textAlign:"center"}}>
                <div style={{fontSize:fs(14),fontWeight:700,color:T.purple}}>{new Date(lastPlan.createdAt).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                <div style={{fontSize:fs(9),color:T.dim}}>started</div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Start Studying Card — next undone plan task today */}
      {(() => {
        const todayTasks = safeArr((data.tasks || {})[todayStr()]);
        const nextTask = todayTasks.find(t => !t.done && t.planId);
        if (!nextTask) return null;
        const course = (data.courses || []).find(c => nextTask.title && (nextTask.title.toLowerCase().includes(c.name.toLowerCase().split(" \u2013 ")[0].split(" - ")[0]) || (c.courseCode && nextTask.title.toLowerCase().includes(c.courseCode.toLowerCase()))));
        return (
          <div style={{background:`linear-gradient(135deg, ${T.accentD}, ${T.accent}11)`,border:`1.5px solid ${T.accent}44`,borderRadius:12,padding:16,marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:14}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:fs(13),fontWeight:700,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{nextTask.title}</div>
              <div style={{fontSize:fs(11),color:T.soft,marginTop:3,display:"flex",alignItems:"center",gap:8}}>
                {nextTask.time && <span>{nextTask.time}{nextTask.endTime ? ` \u2013 ${nextTask.endTime}` : ""}</span>}
                {course && <Badge color={T.accent} bg={T.accentD}>{course.courseCode || course.name.slice(0,20)}</Badge>}
              </div>
            </div>
            <Btn v="primary" onClick={()=>{setDate(todayStr());setPage("daily")}}>Start Studying {"\u2192"}</Btn>
          </div>
        );
      })()}

      {/* Collapsible Alert Banners */}
      {(() => {
        const alerts = [];

        // Global Schedule Conflicts
        if (globalConflicts.totalConflicts > 0) {
          alerts.push(
            <div key="conflicts" style={{padding:"12px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,marginBottom:8}}>
              <div style={{fontSize:fs(11),color:T.red,fontWeight:700,marginBottom:8}}>{'\u26A0\uFE0F'} {globalConflicts.totalConflicts} time overlap{globalConflicts.totalConflicts>1?"s":""} across {globalConflicts.conflictDays} day{globalConflicts.conflictDays>1?"s":""}</div>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {globalConflicts.dates.slice(0,10).map(cd => (
                  <button key={cd.date} onClick={()=>{setDate(cd.date);setPage("daily")}} style={{padding:"6px 12px",borderRadius:7,border:`1px solid ${T.red}55`,background:T.red+"22",color:T.red,fontSize:fs(10),fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:4}}>
                    {new Date(cd.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})} <span style={{opacity:0.7}}>({cd.count})</span>
                  </button>
                ))}
                {globalConflicts.dates.length > 10 && <span style={{fontSize:fs(9),color:T.red,alignSelf:"center"}}>+{globalConflicts.dates.length-10} more days</span>}
              </div>
            </div>
          );
        }

        // Finish date past term end
        if (estFinish && data.targetDate && estFinish > data.targetDate) {
          alerts.push(
            <div key="finish-past" style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(11),color:T.red,marginBottom:8}}>
              {"\ud83d\udea8"} At {hrsPerDay}h/day, estimated finish ({new Date(estFinish+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}) is past your term end ({new Date(data.targetDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}). <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setPage("planner")}>Adjust study plan</span>
            </div>
          );
        }

        // Velocity Warning
        if (avgHrsPerDay14 > 0 && avgHrsPerDay14 < hrsPerDay) {
          alerts.push(
            <div key="velocity" style={{padding:"10px 14px",borderRadius:10,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:8}}>
              {'\u26A0\uFE0F'} Your 14-day average ({avgHrsPerDay14}h/day) is below your target ({hrsPerDay}h/day).
              {estDaysAtPace && ` At current pace, you need ~${estDaysAtPace} days to finish.`}
              {effectiveDaysLeft!=null && estDaysAtPace && estDaysAtPace > effectiveDaysLeft && <span style={{fontWeight:700}}> That's {estDaysAtPace - effectiveDaysLeft} days past your target completion date.</span>}
            </div>
          );
        }

        // Hours/day config warning
        if (hrsPerDay < 2 && totalEstHrs > 0) {
          alerts.push(
            <div key="low-hours" style={{padding:"10px 14px",borderRadius:10,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:8}}>
              {'\u26A0\uFE0F'} Hours/day is set to {hrsPerDay}h {'\u2014'} this is very low. At this pace, {totalEstHrs}h of coursework would take {rawDaysNeeded} study days. <span style={{cursor:"pointer",textDecoration:"underline"}} onClick={()=>setPage("planner")}>Adjust in Study Planner</span>
            </div>
          );
        }

        // Schedule Coverage
        if (scheduledHrs > 0 && totalEstHrs > 0 && scheduledHrs < totalEstHrs * 0.9) {
          alerts.push(
            <div key="coverage" style={{padding:"10px 14px",borderRadius:10,background:T.blueD,border:`1px solid ${T.blue}33`,fontSize:fs(11),color:T.blue,marginBottom:8}}>
              {"\ud83d\udcc5"} Your calendar has {scheduledHrs}h of study scheduled but courses need ~{totalEstHrs}h total. {Math.round(scheduledHrs/totalEstHrs*100)}% coverage{lastScheduledDate ? ` \u2014 last scheduled day: ${new Date(lastScheduledDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}` : ""}.
              {scheduledHrs < totalEstHrs * 0.5 && " Consider regenerating your study plan in Study Planner to fill in the remaining weeks."}
            </div>
          );
        }

        // On Track / Behind indicators
        const projectedFinish = scheduleFinish || estFinish;
        if (projectedFinish && effectiveTarget) {
          const source = scheduleFinish ? "schedule" : "estimate";
          const finishLabel = new Date(projectedFinish+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
          if (projectedFinish > effectiveTarget && data.targetDate && projectedFinish <= data.targetDate) {
            alerts.push(
              <div key="behind-goal" style={{padding:"10px 14px",borderRadius:10,background:T.orangeD,border:`1px solid ${T.orange}33`,fontSize:fs(11),color:T.orange,marginBottom:8}}>
                {'\u26A0\uFE0F'} {source==="schedule"?"Schedule runs":"Estimated finish"} through {finishLabel} {'\u2014'} past your target completion but before term end ({new Date(data.targetDate+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}).
              </div>
            );
          } else if (projectedFinish > (data.targetDate || effectiveTarget)) {
            alerts.push(
              <div key="behind-term" style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(11),color:T.red,marginBottom:8}}>
                {"\ud83d\udea8"} {source==="schedule"?"Schedule extends":"Estimated finish"} to {finishLabel} {"\u2014"} {diffDays(data.targetDate || effectiveTarget, projectedFinish)} days PAST your term end date! Increase study hours or adjust your plan.
              </div>
            );
          } else if (projectedFinish <= effectiveTarget) {
            // On track — this is positive, not a warning. Show outside the collapsible.
          }
        }

        // Time Conflict Detection — scan today's tasks
        const todayTasks = safeArr(tasks[today]).sort((a,b)=>(parseTime(a.time)?.mins??9999)-(parseTime(b.time)?.mins??9999));
        const overlaps = [];
        for (let i=0; i<todayTasks.length; i++) {
          const a = todayTasks[i], as = parseTime(a.time), ae = parseTime(a.endTime);
          if(!as||!ae) continue;
          for (let j=i+1; j<todayTasks.length; j++) {
            const b = todayTasks[j], bs = parseTime(b.time), be = parseTime(b.endTime);
            if(!bs||!be) continue;
            if(as.mins < be.mins && ae.mins > bs.mins) overlaps.push({a:a.title, b:b.title, aTime:`${a.time}\u2013${a.endTime}`, bTime:`${b.time}\u2013${b.endTime}`});
          }
        }
        if (overlaps.length > 0) {
          alerts.push(
            <div key="today-conflicts" style={{padding:"10px 14px",borderRadius:10,background:T.redD,border:`1px solid ${T.red}33`,fontSize:fs(11),color:T.red,marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <span style={{fontWeight:700}}>{'\u26A0\uFE0F'} {overlaps.length} time conflict{overlaps.length>1?"s":""} in today{'\u2019'}s schedule</span>
                <button onClick={()=>{setDate(today);setPage("daily")}} style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${T.red}55`,background:T.red+"22",color:T.red,fontSize:fs(11),fontWeight:600,cursor:"pointer"}}>Fix in Schedule {"\u2192"}</button>
              </div>
              {overlaps.slice(0,3).map((o,i) => (
                <div key={i} style={{fontSize:fs(10),opacity:0.85,marginBottom:2}}>
                  {o.aTime} "{o.a.slice(0,30)}" overlaps with {o.bTime} "{o.b.slice(0,30)}"
                </div>
              ))}
              {overlaps.length > 3 && <div style={{fontSize:fs(9),opacity:0.7}}>+{overlaps.length-3} more conflicts</div>}
            </div>
          );
        }

        if (alerts.length === 0) return null;

        const visibleAlerts = alertsExpanded ? alerts : [alerts[0]];
        const hiddenCount = alerts.length - 1;

        return (
          <div style={{marginBottom:16}}>
            {visibleAlerts}
            {hiddenCount > 0 && !alertsExpanded && (
              <button onClick={()=>setAlertsExpanded(true)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 14px",fontSize:fs(11),color:T.soft,cursor:"pointer",fontWeight:600,width:"100%",textAlign:"center",marginTop:2}}>
                {hiddenCount} more alert{hiddenCount>1?"s":""} {"\u25BC"}
              </button>
            )}
            {alertsExpanded && alerts.length > 1 && (
              <button onClick={()=>setAlertsExpanded(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,padding:"6px 14px",fontSize:fs(11),color:T.soft,cursor:"pointer",fontWeight:600,width:"100%",textAlign:"center",marginTop:2}}>
                Show less {"\u25B2"}
              </button>
            )}
          </div>
        );
      })()}

      {/* On Track positive indicator — shown outside collapsible */}
      {(() => {
        const projectedFinish = scheduleFinish || estFinish;
        if (!projectedFinish || !effectiveTarget) return null;
        if (projectedFinish <= effectiveTarget) {
          const source = scheduleFinish ? "schedule" : "estimate";
          const finishLabel = new Date(projectedFinish+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"});
          return (
            <div style={{padding:"10px 14px",borderRadius:10,background:T.accentD,border:`1px solid ${T.accent}33`,fontSize:fs(11),color:T.accent,marginBottom:16}}>
              {'\u2705'} On track! {source==="schedule"?"Last scheduled study day":"Estimated finish"}: {finishLabel} {'\u2014'} {diffDays(projectedFinish, effectiveTarget)} days before your target completion date.
            </div>
          );
        }
        return null;
      })()}

      {/* Per-Course Study Time */}
      {Object.keys(courseHours).length > 0 && (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:16,marginBottom:16}}>
          <h3 style={{fontSize:fs(14),fontWeight:700,marginBottom:10}}>{"\ud83d\udcda"} Study Time by Course</h3>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {Object.entries(courseHours).sort((a,b)=>b[1]-a[1]).map(([name,mins]) => {
              const course = courses.find(c => c.name === name);
              const estHrs = course?.averageStudyHours || 0;
              const studied = Math.round(mins/6)/10;
              const pct = estHrs > 0 ? Math.min(100, Math.round((studied/estHrs)*100)) : 0;
              return (
                <div key={name} style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:fs(11),color:T.text,fontWeight:500,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",minWidth:0}}>{name}</span>
                  <div style={{width:80,height:6,borderRadius:3,background:T.bg2,overflow:"hidden",flexShrink:0}}>
                    <div style={{width:`${pct}%`,height:"100%",background:pct>=80?T.accent:pct>=40?T.blue:T.orange,borderRadius:3}}/>
                  </div>
                  <span style={{fontSize:fs(10),color:T.accent,fontWeight:600,minWidth:35,textAlign:"right"}}>{studied}h</span>
                  {estHrs>0&&<span style={{fontSize:fs(9),color:T.dim,minWidth:30}}>/{estHrs}h</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Course List (compact read-only) */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <h3 style={{fontSize:fs(14),fontWeight:700}}>Courses ({courses.length})</h3>
        <div style={{display:"flex",gap:4}}>
          {["all","not_started","in_progress","completed"].map(f => (
            <button key={f} onClick={()=>setFilter(f)} style={{padding:"4px 10px",borderRadius:6,border:"none",fontSize:fs(10),fontWeight:f===filter?700:400,cursor:"pointer",
              background:f===filter?T.accentD:"transparent",color:f===filter?T.accent:T.dim}}>
              {f==="all"?"All":f==="not_started"?"Not Started":f==="in_progress"?"In Progress":"Done"}
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <div style={{padding:"30px",textAlign:"center",color:T.dim,fontSize:fs(13)}}>
          {courses.length===0?"No courses yet. ":"No courses match this filter. "}
          <span style={{color:T.accent,cursor:"pointer",textDecoration:"underline"}} onClick={()=>{if(courses.length===0)setPage("courses");else setFilter("all")}}>{courses.length===0?"Go to My Courses":"Show all"}</span>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:16}}>
          {filtered.map((c,i)=>(
            <div key={c.id} className="sf-card" style={{background:T.card,border:`1px solid ${expanded[c.id]?T.accent+"44":T.border}`,borderRadius:10,overflow:"hidden"}}>
              <div style={{padding:"8px 14px",display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>setExpanded(e=>({...e,[c.id]:!e[c.id]}))}>
                <div style={{width:4,height:32,borderRadius:2,background:STATUS_C[c.status]||T.dim,flexShrink:0}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{fontSize:fs(12),fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.name}</span>
                    <Badge color={STATUS_C[c.status]||T.dim} bg={(STATUS_C[c.status]||T.dim)+"22"}>{STATUS_L[c.status]||c.status}</Badge>
                    {hasCtx(c)?<Badge color={T.accent} bg={T.accentD}>ENRICHED</Badge>:c.status!=="completed"&&<Badge color={T.orange} bg={T.orangeD}>NEEDS ENRICHMENT</Badge>}
                  </div>
                  <div style={{fontSize:fs(10),color:T.dim,display:"flex",gap:8,marginTop:2}}>
                    <span>{c.credits||0} CU</span>
                    <span>{"\u2605".repeat(c.difficulty||0)}{"\u2606".repeat(5-(c.difficulty||0))}</span>
                    {c.assessmentType&&<span>{c.assessmentType}</span>}
                    {courseHours[c.name]&&<span style={{color:T.accent}}>{"\u23F1"} {Math.round((courseHours[c.name]||0)/6)/10}h studied</span>}
                  </div>
                </div>
                <span style={{fontSize:fs(10),color:T.dim,transition:"transform .2s",transform:expanded[c.id]?"rotate(180deg)":"rotate(0)",flexShrink:0}}>{"\u25BC"}</span>
              </div>
              {expanded[c.id] && (
                <div style={{padding:"0 14px 12px",borderTop:`1px solid ${T.border}`}}>
                  <ErrorBoundary><CourseDetail c={c}/></ErrorBoundary>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export { DegreeDashboard };
export default DegreeDashboard;
