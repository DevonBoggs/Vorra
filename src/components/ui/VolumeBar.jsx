import { useRef, useEffect, useCallback } from "react";
import { useTheme } from "../../styles/tokens.js";

const VolumeBar = ({value, onChange}) => {
  const T = useTheme();
  const barRef = useRef(null);
  const dragging = useRef(false);
  const setFromEvent = useCallback((e) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(pct);
  }, [onChange]);
  useEffect(() => {
    const onMove = (e) => { if (dragging.current) setFromEvent(e); };
    const onUp = () => { dragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [setFromEvent]);
  const segs = 24;
  const filled = Math.round(value * segs);
  return (
    <div ref={barRef} onMouseDown={e => { dragging.current = true; setFromEvent(e); }}
      style={{flex:1,display:"flex",gap:1.5,alignItems:"center",cursor:"pointer",padding:"4px 0",userSelect:"none"}} title={`${Math.round(value*100)}%`}>
      {Array.from({length:segs},(_,i) => {
        const on = i < filled;
        const intensity = i / segs;
        return <div key={i} style={{flex:1,height:on?7:3,borderRadius:2,
          background:on ? (intensity>0.8?T.red:intensity>0.6?T.orange:T.accent) : `${T.border}88`,
          transition:"height 60ms,background 60ms"}} />;
      })}
    </div>
  );
};

export { VolumeBar };
export default VolumeBar;
