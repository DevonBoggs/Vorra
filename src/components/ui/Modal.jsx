import { useRef, useEffect } from "react";
import { useTheme, fs } from "../../styles/tokens.js";
import { dlog } from "../../systems/debug.js";
import * as Ic from "../icons/index.jsx";

const Modal = ({title, onClose, children, wide}) => {
  const T = useTheme();
  const bdRef = useRef(null);
  const handleBdDown = (e) => { if (e.target === bdRef.current) { dlog('debug','modal',`Closed: "${title}" via backdrop`); onClose() } };
  useEffect(() => { dlog('debug','modal',`Opened: "${title}"`); return () => dlog('debug','modal',`Unmounted: "${title}"`); }, [title]);
  return (
    <div ref={bdRef} onMouseDown={handleBdDown} style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.8)",backdropFilter:"blur(12px)",zIndex:999,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} className="slide-up" style={{background:T.card,border:`1.5px solid ${T.border}`,borderRadius:18,padding:28,width:"100%",maxWidth:wide?720:480,maxHeight:"85vh",overflowY:"auto",boxShadow:`0 24px 60px rgba(0,0,0,.5), 0 0 0 1px ${T.border}`,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h3 style={{fontSize:fs(17),fontWeight:700}}>{title}</h3>
          <button onClick={()=>{dlog('debug','modal',`Closed: "${title}" via X`);onClose()}} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",padding:4}}><Ic.X/></button>
        </div>{children}
      </div>
    </div>
  );
};

export { Modal };
export default Modal;
