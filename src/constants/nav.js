// Navigation items — grouped into Study + Tools sections
import * as Ic from "../components/icons/index.jsx";

// Flat array for backward compat (command palette, shortcuts)
export const NAV = [
  {key:"dashboard",label:"Degree Dashboard",icon:Ic.Grad,color:"#06d6a0",group:"study"},
  {key:"courses",label:"My Courses",icon:Ic.Edit,color:"#a78bfa",group:"study"},
  {key:"planner",label:"Study Planner",icon:Ic.Cal,color:"#8b5cf6",group:"study"},
  {key:"daily",label:"Daily Planner",icon:Ic.List,color:"#60a5fa",group:"study"},
  {key:"calendar",label:"Calendar",icon:Ic.Cal,color:"#f472b6",group:"tools"},
  {key:"chat",label:"Study Chat",icon:Ic.Chat,color:"#34d399",group:"tools"},
  {key:"quiz",label:"Practice Exam",icon:Ic.Quiz,color:"#fb923c",group:"tools"},
  {key:"report",label:"Weekly Report",icon:Ic.Report,color:"#38bdf8",group:"tools"},
  {key:"ambient",label:"Study Radio",icon:Ic.Music,color:"#c084fc",group:"tools"},
];

// Grouped nav for sidebar rendering
export const NAV_GROUPS = [
  { id: 'study', label: 'Study', items: NAV.filter(n => n.group === 'study') },
  { id: 'tools', label: 'Tools', items: NAV.filter(n => n.group === 'tools') },
];

// Keyboard shortcut labels per platform
export const getShortcutLabel = (index, isMac) => {
  const mod = isMac ? '⌘' : 'Ctrl';
  return `${mod}+${index + 1}`;
};
