import { useState, useMemo } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";
import { todayStr, pad, fmtDateLong, diffDays, parseTime } from "../../utils/helpers.js";
import { getCAT, STATUS_L } from "../../constants/categories.js";
import { useBreakpoint } from "../../systems/breakpoint.js";
import { Badge } from "../../components/ui/Badge.jsx";

function safeArr(v) { return Array.isArray(v) ? v : []; }

const CalendarPage=({date,setDate,tasks,setPage,Btn,data})=>{
  const T = useTheme();
  const CAT = getCAT(T);
  const d=new Date(date+"T12:00:00");const[vm,setVm]=useState(d.getMonth());const[vy,setVy]=useState(d.getFullYear());const today=todayStr();
  const[showPicker,setShowPicker]=useState(false);
  const[calSearch,setCalSearch]=useState("");
  const[hovDay,setHovDay]=useState(null);
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const curYear = new Date().getFullYear();
  const f=new Date(vy,vm,1).getDay(),dim=new Date(vy,vm+1,0).getDate();
  const cells=[];for(let i=0;i<f;i++)cells.push(null);for(let i=1;i<=dim;i++)cells.push(i);while(cells.length%7!==0)cells.push(null);
  const numRows = cells.length / 7;
  const nav=delta=>{let m=vm+delta,y=vy;if(m<0){m=11;y--}else if(m>11){m=0;y++}setVm(m);setVy(y)};

  // Search: find matching tasks across all dates
  const searchResults = useMemo(() => {
    if (!calSearch.trim()) return null;
    const q = calSearch.trim().toLowerCase();
    const results = [];
    for (const [dt, dayTasks] of Object.entries(tasks)) {
      for (const t of safeArr(dayTasks)) {
        if (t.title.toLowerCase().includes(q) || (t.category||"").toLowerCase().includes(q)) {
          results.push({...t, date: dt});
        }
      }
    }
    return results.sort((a,b) => a.date.localeCompare(b.date) || (a.time||"").localeCompare(b.time||""));
  }, [calSearch, tasks]);

  return(
    <div className="fade" style={{display:"flex",flexDirection:"column",height:"calc(100vh - 56px)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexShrink:0}}>
        <h1 style={{fontSize:fs(24),fontWeight:800}}>Calendar</h1>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>nav(-1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer"}}><Ic.ChevL/></button>
          <button onClick={()=>setShowPicker(!showPicker)} style={{fontSize:fs(16),fontWeight:700,minWidth:180,textAlign:"center",background:showPicker?T.accentD:"transparent",border:"none",cursor:"pointer",color:T.text,padding:"4px 12px",borderRadius:8}}>{new Date(vy,vm).toLocaleDateString("en-US",{month:"long",year:"numeric"})} {"\u25BE"}</button>
          <button onClick={()=>nav(1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer"}}><Ic.ChevR/></button>
          <button onClick={()=>{setVm(new Date().getMonth());setVy(new Date().getFullYear())}} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",fontSize:fs(11),fontWeight:600,color:T.accent}}>Today</button>
        </div>
      </div>

      {/* Search bar */}
      <div style={{display:"flex",gap:8,marginBottom:12,flexShrink:0}}>
        <div style={{flex:1,position:"relative"}}>
          <input value={calSearch} onChange={e=>setCalSearch(e.target.value)} placeholder="Search tasks by name, course code, or category..." style={{width:"100%",padding:"8px 12px 8px 32px",fontSize:fs(12)}}/>
          <Ic.IcSearch s={14} c={T.dim} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        </div>
        {calSearch&&<Btn small v="ghost" onClick={()=>setCalSearch("")}>Clear</Btn>}
      </div>

      {/* Search results */}
      {searchResults && (
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:12,marginBottom:12,maxHeight:300,overflowY:"auto",flexShrink:0}}>
          <div style={{fontSize:fs(11),fontWeight:700,color:T.soft,marginBottom:8}}>{searchResults.length} result{searchResults.length!==1?"s":""} for "{calSearch}"</div>
          {searchResults.length === 0 ? <div style={{fontSize:fs(11),color:T.dim,padding:8}}>No matching tasks found.</div> : (
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              {searchResults.slice(0,30).map((t,i) => {
                const c = CAT[t.category]||CAT.other;
                return (
                  <div key={i} onClick={()=>{setDate(t.date);setPage("daily")}} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 10px",borderRadius:6,background:T.input,cursor:"pointer"}}>
                    <div style={{width:3,height:18,borderRadius:2,background:c.fg,flexShrink:0}}/>
                    <span style={{fontSize:fs(9),color:T.dim,minWidth:70,fontFamily:"'JetBrains Mono',monospace"}}>{new Date(t.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>
                    <span style={{fontSize:fs(9),color:T.blue,minWidth:40,fontFamily:"'JetBrains Mono',monospace"}}>{t.time||"\u2014"}</span>
                    <span style={{flex:1,fontSize:fs(11),color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                    <Badge color={c.fg} bg={c.bg}>{c.l||t.category}</Badge>
                  </div>
                );
              })}
              {searchResults.length > 30 && <div style={{fontSize:fs(9),color:T.dim,textAlign:"center"}}>+{searchResults.length-30} more results</div>}
            </div>
          )}
        </div>
      )}

      {showPicker && (
        <div className="fade" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:12,marginBottom:12,boxShadow:"0 4px 16px rgba(0,0,0,.15)",maxWidth:320}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:8}}>
            <button onClick={()=>setVy(vy-1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontSize:fs(11),color:T.soft}}>{"\u25C0"}</button>
            <span style={{flex:1,textAlign:"center",fontSize:fs(14),fontWeight:700,color:T.text}}>{vy}</span>
            <button onClick={()=>setVy(vy+1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"5px 12px",cursor:"pointer",fontSize:fs(11),color:T.soft}}>{"\u25B6"}</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:4}}>
            {months.map((m,i)=>(
              <button key={i} onClick={()=>{setVm(i);setShowPicker(false)}} style={{
                padding:"6px 4px",borderRadius:6,border:"none",cursor:"pointer",fontSize:fs(12),fontWeight:vm===i?700:400,
                background:vm===i?T.accentD:"transparent",color:vm===i?T.accent:T.soft,transition:"all .1s"
              }}>{m}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{flex:1,display:"grid",gridTemplateColumns:"repeat(7,1fr)",gridTemplateRows:`auto repeat(${numRows},1fr)`,gap:2,background:T.bg,borderRadius:14,overflow:"hidden",border:`1px solid ${T.border}`}}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} style={{background:T.panel,padding:"10px 10px",fontSize:fs(11),fontWeight:700,color:T.dim,textAlign:"center",letterSpacing:"0.5px",textTransform:"uppercase"}}>{d}</div>)}
        {cells.map((day,i)=>{
          if(!day) return (<div key={i} style={{background:T.bg2}}/>);
          const ds=`${vy}-${pad(vm+1)}-${pad(day)}`,isT=ds===today,dt=tasks[ds]||[];
          const isPast = ds < today;
          const isHov = hovDay === ds;
          const hasTasks = dt.length > 0;
          const allDone = hasTasks && dt.every(t=>t.done);
          const doneCount = dt.filter(t=>t.done).length;
          const totalMins = dt.reduce((s,t) => { const st=parseTime(t.time),et=parseTime(t.endTime); return s+(st&&et?Math.max(0,et.mins-st.mins):0); }, 0);
          const totalHrs = Math.round(totalMins / 60 * 10) / 10;
          const hasPlanTasks = dt.some(t=>t.planId);
          const planDone = isPast && hasPlanTasks ? dt.filter(t=>t.planId&&t.done).length : 0;
          const planTotal = dt.filter(t=>t.planId).length;
          const pct = hasTasks ? Math.round((doneCount / dt.length) * 100) : 0;
          return (
            <div key={i} className="sf-cal-cell" onClick={()=>{setDate(ds);setPage("daily")}} onMouseEnter={()=>setHovDay(ds)} onMouseLeave={()=>setHovDay(null)}
              style={{background:isT?`${T.accent}12`:isHov?`${T.accent}08`:T.bg2,padding:"8px 8px 6px",cursor:"pointer",borderLeft:isT?`3px solid ${T.accent}`:"3px solid transparent",overflow:"hidden",opacity:isPast&&!isT?0.45:1,position:"relative",minHeight:90,display:"flex",flexDirection:"column"}}>
              {isPast&&!isT&&<div style={{position:"absolute",inset:0,background:`repeating-linear-gradient(135deg,transparent,transparent 8px,${T.border}15 8px,${T.border}15 9px)`,pointerEvents:"none"}}/>}
              <div style={{fontSize:fs(13),fontWeight:isT?800:500,color:isT?T.accent:isPast?T.dim:T.text,marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{display:"flex",alignItems:"center",gap:4}}>
                  {isT&&<span style={{width:6,height:6,borderRadius:"50%",background:T.accent,boxShadow:`0 0 6px ${T.accent}`}}/>}
                  {day}
                </span>
                <span style={{display:"flex",alignItems:"center",gap:4}}>
                  {totalHrs > 0 && <span style={{fontSize:fs(8),color:T.dim,fontFamily:"'JetBrains Mono',monospace"}}>{totalHrs}h</span>}
                  {hasPlanTasks&&<span style={{width:5,height:5,borderRadius:2,background:T.purple,flexShrink:0}} title="Has plan tasks"/>}
                  {hasTasks&&<span style={{width:7,height:7,borderRadius:"50%",background:isPast?(allDone?T.accent:doneCount>0?T.orange:T.red):(allDone?T.dim:T.accent),boxShadow:allDone&&!isPast?"none":`0 0 4px ${isPast?(allDone?T.accent:T.orange):T.accent}66`}}/>}
                </span>
              </div>
              <div style={{flex:1}}>
                {dt.slice(0,3).map((t,j)=>{const c=CAT[t.category]||CAT.other; return (<div key={j} style={{fontSize:fs(10),padding:"2px 6px",borderRadius:5,marginBottom:2,background:t.done?`${c.bg}88`:c.bg,color:t.done?T.dim:c.fg,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",textDecoration:t.done?"line-through":"none",borderLeft:t.planId?`2px solid ${T.purple}`:"2px solid transparent"}}><span className="mono" style={{fontSize:fs(9),marginRight:3,opacity:.7}}>{t.time}</span>{t.title}</div>);})}
                {dt.length>3&&<div style={{fontSize:fs(9),color:T.dim,fontWeight:600,marginTop:1}}>+{dt.length-3} more</div>}
              </div>
              {/* Progress bar at bottom */}
              {hasTasks && (
                <div style={{height:3,borderRadius:2,background:T.input,marginTop:4,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,borderRadius:2,background:allDone?T.accent:pct>50?T.blue:T.soft,transition:"width .3s"}}/>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export { CalendarPage };
export default CalendarPage;
