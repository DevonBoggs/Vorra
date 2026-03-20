// Responsive Breakpoint System

import { useState, useEffect } from "react";

let _winW = typeof window !== 'undefined' ? window.innerWidth : 1400;
let _bpSubs = [];

function bpNotify() { _bpSubs.forEach(fn => fn(_winW)); }

if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => { _winW = window.innerWidth; bpNotify(); });
}

export function useBreakpoint() {
  const [w, setW] = useState(_winW);
  useEffect(() => {
    _bpSubs.push(setW);
    return () => { _bpSubs = _bpSubs.filter(f => f !== setW); };
  }, []);
  return {
    w,
    sm: w < 1200, md: w >= 1200 && w < 1600, lg: w >= 1600 && w < 2100, xl: w >= 2100,
    cols: w < 1200 ? 3 : w < 1600 ? 4 : w < 2100 ? 5 : 6,
    gridCols: w < 1200 ? 2 : w < 1600 ? 3 : w < 2100 ? 4 : 4,
    pad: w < 1200 ? "24px 28px" : w < 1600 ? "28px 40px" : w < 2100 ? "32px 56px" : "36px 72px",
    padCol: w < 1200 ? "24px 28px 24px 44px" : w < 1600 ? "28px 40px 28px 56px" : w < 2100 ? "32px 56px 32px 72px" : "36px 72px 36px 88px",
    maxW: w < 1200 ? "none" : w < 1600 ? 1200 : w < 2100 ? 1500 : 1800,
    sideW: w < 1200 ? 260 : w < 1600 ? 280 : w < 2100 ? 300 : 320,
  };
}
