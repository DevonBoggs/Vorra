import { useState } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import Ic from "../../components/icons/index.jsx";

const todayStr = () => new Date().toISOString().split("T")[0];
const pad = (n) => String(n).padStart(2, "0");

const MiniCal=({date,setDate,tasks})=>{
  const T = useTheme();
  const d=new Date(date+"T12:00:00");
  const[vm,setVm]=useState(d.getMonth());
  const[vy,setVy]=useState(d.getFullYear());
  const[showPicker,setShowPicker]=useState(false);
  const today=todayStr();
  const f=new Date(vy,vm,1).getDay(),dim=new Date(vy,vm+1,0).getDate();
  const cells=[];for(let i=0;i<f;i++)cells.push(null);for(let i=1;i<=dim;i++)cells.push(i);
  const nav=delta=>{let m=vm+delta,y=vy;if(m<0){m=11;y--}else if(m>11){m=0;y++}setVm(m);setVy(y)};
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const curYear = new Date().getFullYear();
  return(
    <div style={{padding:"0 4px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <button onClick={()=>nav(-1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer",padding:4,borderRadius:4,transition:"all .15s"}} className="sf-nav">
          <Ic.ChevL s={14}/>
        </button>
        <button onClick={()=>setShowPicker(!showPicker)} style={{fontSize:fs(13),fontWeight:700,color:T.soft,background:showPicker?T.accentD:"transparent",border:"none",cursor:"pointer",padding:"3px 8px",borderRadius:6,transition:"all .15s"}} title="Click to pick month/year">
          {new Date(vy,vm).toLocaleDateString("en-US",{month:"long",year:"numeric"})} v
        </button>
        <button onClick={()=>nav(1)} style={{background:"none",border:"none",color:T.soft,cursor:"pointer",padding:4,borderRadius:4,transition:"all .15s"}} className="sf-nav">
          <Ic.ChevR s={14}/>
        </button>
      </div>
      {/* Month/Year picker dropdown */}
      {showPicker && (
        <div className="fade" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:8,marginBottom:8,boxShadow:"0 4px 12px rgba(0,0,0,.2)"}}>
          <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:6}}>
            <button onClick={()=>setVy(vy-1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontSize:fs(10),color:T.soft}}>{"\u25C0"}</button>
            <span style={{flex:1,textAlign:"center",fontSize:fs(12),fontWeight:700,color:T.text}}>{vy}</span>
            <button onClick={()=>setVy(vy+1)} style={{background:T.input,border:`1px solid ${T.border}`,borderRadius:4,padding:"2px 6px",cursor:"pointer",fontSize:fs(10),color:T.soft}}>{"\u25B6"}</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:3}}>
            {months.map((m,i)=>(
              <button key={i} onClick={()=>{setVm(i);setShowPicker(false)}} style={{
                padding:"4px 2px",borderRadius:5,border:"none",cursor:"pointer",fontSize:fs(10),fontWeight:vm===i&&vy===curYear?700:400,
                background:vm===i?T.accentD:"transparent",color:vm===i?T.accent:T.soft,transition:"all .1s"
              }}>{m}</button>
            ))}
          </div>
          <button onClick={()=>{setVm(new Date().getMonth());setVy(new Date().getFullYear());setShowPicker(false)}} style={{width:"100%",marginTop:4,padding:"5px 8px",borderRadius:5,border:`1px solid ${T.border}`,background:T.input,cursor:"pointer",fontSize:fs(9),color:T.accent,fontWeight:600}}>Today</button>
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,textAlign:"center"}}>
        {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} style={{fontSize:fs(11),color:T.dim,fontWeight:600,padding:3}}>{d}</div>)}
        {cells.map((day,i)=>{
          if(!day) return (<div key={i}/>);
          const ds=`${vy}-${pad(vm+1)}-${pad(day)}`,isT=ds===today,isS=ds===date,hasT=(tasks[ds]||[]).length>0;
          const isPast = ds < today;
          return (
            <button key={i} onClick={()=>setDate(ds)} className="sf-cal-day" style={{background:isS?T.accent:isT?T.accentD:"transparent",color:isS?"#060e09":isT?T.accent:isPast?T.dim:T.text,border:"none",borderRadius:6,fontSize:fs(13),fontWeight:isS||isT?700:400,padding:"5px 0",cursor:"pointer",position:"relative",opacity:isPast&&!isS?0.4:1}}>
              {day}{hasT&&!isS&&<div style={{position:"absolute",bottom:1,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:isT?T.accent:T.soft}}/>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export { MiniCal };
export default MiniCal;
