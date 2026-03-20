import { useState, useEffect, useRef } from "react";

// BufferedInput: holds local state during editing, commits to parent only on blur.
// Prevents re-renders from destroying native date/time pickers while they're open.
const BufferedInput = ({value, onCommit, type, ...props}) => {
  const [local, setLocal] = useState(String(value));
  const committed = useRef(String(value));
  // Always sync from parent when parent value changes externally
  useEffect(() => { const sv = String(value); if (sv !== committed.current) { setLocal(sv); committed.current = sv; } }, [value]);
  const commit = (v) => { if (v !== committed.current) { committed.current = v; onCommit(v); } };
  if (type === "number") {
    // Number inputs: commit on every change (no picker to destroy), but use local state for display
    return <input type={type} value={local} onChange={e => { setLocal(e.target.value); committed.current = e.target.value; onCommit(e.target.value); }} {...props}/>;
  }
  return <input type={type} value={local} onChange={e => setLocal(e.target.value)} onBlur={() => commit(local)} {...props}/>;
};

export { BufferedInput };
export default BufferedInput;
