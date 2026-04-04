// StudyChatPage — AI Study Companion
// Modes: Tutor (Socratic), Quiz, Plan, Coach
// Deep integration with taskQueue, lessonPlan, enrichment data

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
import { uid, todayStr, fileToBase64, diffDays, minsToStr } from "../../utils/helpers.js";
import { getEffectiveHours } from "../../utils/availabilityCalc.js";
import { getSTATUS_C, STATUS_L } from "../../constants/categories.js";
import { hasCtx } from "../../utils/courseHelpers.js";

// Mode-specific system prompt modifiers
const MODE_PROMPTS = {
  tutor: `MODE: SOCRATIC TUTOR
When a student asks "What is X?" — respond with "What do you already know about X?" FIRST. Only explain after they attempt.
When they give a wrong answer — do NOT say "That's wrong." Instead ask a guiding question with a counterexample.
When they give a right answer — confirm, then deepen: "Can you think of a case where that breaks down?"
Provide ONE concept per message. One idea, one question.
Use analogies from their course context when available.
FRUSTRATION ESCAPE: If the student says "just tell me" or shows frustration (3+ attempts), switch to direct explanation. Say "Let me walk you through this" and explain clearly. Then return to Socratic mode.`,

  quiz: `MODE: QUIZ MASTER
Generate ONE question at a time. Wait for the student's answer before revealing the correct one.
After each answer, explain WHY the answer is right or wrong — reference specific concepts.
Track and report score within the session.
Match the assessment format: OA courses get multiple-choice scenario questions, PA courses get rubric-based analysis prompts.
Adapt difficulty: if they get 3 right in a row, increase difficulty. If they get 2 wrong, go easier.
Tag each question with the competency or topic it tests.`,

  plan: `MODE: STUDY PLANNER
Reference the student's calendar, pace data, task queue, and deadlines.
Suggest specific time blocks and topics based on their schedule.
Use the add_tasks tool to schedule items when the student agrees.
Check feasibility: compare remaining hours vs available time.
For catch-up: provide concrete micro-plans ("study X for 45 min, then Y for 30 min").`,

  coach: `MODE: ACCOUNTABILITY COACH
Be direct but encouraging. Reference actual data: streak, hours studied, pace vs target, completion percentage.
Celebrate specific wins: "You completed 4 tasks yesterday — that's your best day this week."
For setbacks, provide concrete micro-goals for the next 30 minutes, not the next month.
If they're behind, acknowledge it honestly and offer 2-3 specific recovery options.
If they're ahead, encourage continued momentum or suggest a lighter day.
Keep messages short and punchy. No lectures.`,
};

/* ── Collapsible Thinking Block ────────────────────────────── */
const ThinkingBlock = ({ thinking, T }) => {
  const [open, setOpen] = useState(false);
  if (!thinking) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
        background: `${T.purple}15`, border: `1px solid ${T.purple}33`, cursor: 'pointer',
        color: T.purple, fontSize: fs(10), fontWeight: 600, width: '100%',
        transition: 'background .15s',
      }} onMouseEnter={e => e.currentTarget.style.background = `${T.purple}25`}
         onMouseLeave={e => e.currentTarget.style.background = `${T.purple}15`}>
        <span style={{ fontSize: fs(12), transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'rotate(0)' }}>▶</span>
        <span>Thinking</span>
        <span style={{ marginLeft: 'auto', fontSize: fs(9), color: T.dim }}>{thinking.length > 500 ? `${Math.round(thinking.length / 100) / 10}k chars` : `${thinking.length} chars`}</span>
      </button>
      <div style={{
        overflow: 'hidden', maxHeight: open ? 400 : 0, opacity: open ? 1 : 0,
        transition: 'max-height .3s cubic-bezier(.4,0,.2,1), opacity .2s ease',
      }}>
        <div style={{
          marginTop: 6, padding: '8px 12px', borderRadius: 6,
          background: `${T.purple}08`, border: `1px solid ${T.purple}22`,
          fontSize: fs(11), lineHeight: 1.5, color: T.soft,
          maxHeight: 380, overflowY: 'auto', whiteSpace: 'pre-wrap',
          fontFamily: "'JetBrains Mono', monospace", fontStyle: 'italic',
        }}>
          {thinking}
        </div>
      </div>
    </div>
  );
};

export const StudyChatPage = ({ data, setData, profile, Btn }) => {
  const T = useTheme();
  const STATUS_C = getSTATUS_C(T);
  const bp = useBreakpoint();
  const [selCourse, setSelCourse] = useState(data.courses?.[0]?.id || "");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [chatAbort, setChatAbort] = useState(null);
  const [imgFile, setImgFile] = useState(null);
  const [imgPrev, setImgPrev] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [chatMode, setChatMode] = useState('tutor'); // 'tutor' | 'quiz' | 'plan' | 'coach'
  const [concise, setConcise] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const messagesEnd = useRef(null);
  const dataRef = useRef(data);
  dataRef.current = data; // always points to latest data
  const fileRef = useRef(null);

  const course = data.courses?.find(c => c.id === selCourse);
  const chatKey = selCourse || "_general";
  const messages = data.chatHistories?.[chatKey] || [];
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);

  const handleImg = (e) => {
    const f = e.target.files?.[0]; if (!f) return; setImgFile(f);
    const r = new FileReader(); r.onload = () => setImgPrev(r.result); r.readAsDataURL(f);
    e.target.value = '';
  };

  const stopChat = () => { if (chatAbort) { chatAbort.abort(); setChatAbort(null); setLoading(false); toast("Stopped", "info"); } };

  // ── Build rich context ──
  const buildContext = () => {
    const sa = safeArr;

    // ── SELECTED COURSE CONTEXT (runtime stats only — enrichment comes via fmtCtx in system prompt) ──
    let courseCtx = "No specific course selected — general study help.";
    if (course) {
      courseCtx = `FOCUSED COURSE: ${course.name} (${course.courseCode || "no code"})`;
      // Runtime computed stats not available in fmtCtx
      const courseStudiedMins = (data.studySessions || []).filter(s => s.course === course.name).reduce((s, x) => s + (x.mins || 0), 0);
      const courseEstHrs = course.averageStudyHours || 0;
      if (courseEstHrs > 0) courseCtx += `\nStudy progress: ${Math.round(courseStudiedMins / 6) / 10}h / ~${courseEstHrs}h (${Math.round(courseStudiedMins / 60 / courseEstHrs * 100)}%)`;
      if (course.examDate) courseCtx += `\nExam date: ${course.examDate} (${Math.max(0, diffDays(todayStr(), course.examDate))} days away)`;
      // Queue position for this course
      const courseQueue = (data.taskQueue || []).filter(t => (t.course_code || '').toUpperCase() === (course.courseCode || '').toUpperCase() && t.category !== 'break');
      const courseDone = courseQueue.filter(t => t.done).length;
      if (courseQueue.length > 0) courseCtx += `\nQueue: ${courseDone}/${courseQueue.length} tasks done`;
      const nextCourseTask = courseQueue.find(t => !t.done);
      if (nextCourseTask) courseCtx += `\nNext task: ${nextCourseTask.title} (~${Math.round((nextCourseTask.estimatedMins || 60) / 60 * 10) / 10}h)`;
    }

    // ── TASK QUEUE ──
    const queue = data.taskQueue || [];
    let queueCtx = '';
    if (queue.length > 0) {
      const studyTasks = queue.filter(t => t.category !== 'break');
      const doneTasks = studyTasks.filter(t => t.done);
      const remainMins = studyTasks.filter(t => !t.done).reduce((s, t) => s + (t.estimatedMins || 60), 0);
      const nextTasks = queue.filter(t => !t.done && t.category !== 'break').slice(0, 5);
      queueCtx = `\n\nSTUDY PLAN QUEUE:
Progress: ${doneTasks.length}/${studyTasks.length} tasks complete (~${Math.round(remainMins / 60)}h remaining)`;
      if (nextTasks.length > 0) queueCtx += `\nNext up:\n${nextTasks.map((t, i) => `  ${i + 1}. ${t.title} (${minsToStr(t.estimatedMins || 60)})`).join('\n')}`;
      const courseQ = {};
      for (const t of studyTasks) {
        const k = t.course_code || 'Other';
        if (!courseQ[k]) courseQ[k] = { total: 0, done: 0 };
        courseQ[k].total++;
        if (t.done) courseQ[k].done++;
      }
      queueCtx += `\nPer-course: ${Object.entries(courseQ).map(([k, v]) => `${k}: ${v.done}/${v.total}`).join(', ')}`;
    }

    // ── LESSON PLANS (all courses, summarized) ──
    let lpCtx = '';
    if (data.lessonPlan?.courses?.length > 0) {
      lpCtx = '\n\nLESSON PLANS:';
      for (const lpc of data.lessonPlan.courses) {
        const isSelected = course && (lpc.course_code || '').toUpperCase() === (course.courseCode || '').toUpperCase();
        if (isSelected && lpc.units?.length > 0) {
          // Full detail for selected course
          lpCtx += `\n${lpc.course_code} (${lpc.units.length} units, ${lpc.total_hours || '?'}h) — ACTIVE:`;
          lpCtx += `\n${lpc.units.map(u => `  U${u.unit_number}: ${u.title} (${u.hours}h, ${u.type})`).join('\n')}`;
        } else if (lpc.units?.length > 0) {
          // Summary for other courses
          lpCtx += `\n${lpc.course_code}: ${lpc.units.length} units, ${lpc.total_hours || '?'}h`;
        }
      }
    }

    // ── TODAY'S TASKS (from queue + legacy calendar) ──
    const today = todayStr();
    let calCtx = `\n\nTODAY (${today}):`;

    // Queue-based: tasks completed today + upcoming from queue (including breaks)
    const queueDoneToday = queue.filter(t => t.done && t.doneDate === today);
    const queueUpcoming = queue.filter(t => !t.done);
    // Use plannerConfig for accurate daily hours, fall back to studyHoursPerDay
    const todayDow = new Date(today + 'T12:00:00').getDay();
    const dailyGoalHrs = data.plannerConfig ? (getEffectiveHours(data.plannerConfig, todayDow) || 4) : (data.studyHoursPerDay || 4);
    const dailyGoalMins = dailyGoalHrs * 60;
    let filledMins = 0;
    const todayItems = [];
    // Already done today
    for (const t of queueDoneToday) {
      todayItems.push(`  ✓ ${t.title} (${Math.round((t.actualMins || t.estimatedMins || 60) / 60 * 10) / 10}h) [${t.category}]`);
      if (t.category !== 'break') filledMins += t.actualMins || t.estimatedMins || 60;
    }
    // Next up from queue to fill today's remaining hours
    for (const t of queueUpcoming) {
      if (t.category !== 'break' && filledMins >= dailyGoalMins) break;
      todayItems.push(`  ○ ${t.title} (~${Math.round((t.estimatedMins || 60) / 60 * 10) / 10}h) [${t.category}]`);
      if (t.category !== 'break') filledMins += t.estimatedMins || 60;
    }
    const studyDone = queueDoneToday.filter(t => t.category !== 'break').length;
    const studyRemaining = todayItems.length - queueDoneToday.length;
    calCtx += `\n${studyDone} study tasks done, ${studyRemaining} remaining (~${Math.round(filledMins / 60 * 10) / 10}h of ${dailyGoalHrs}h daily goal)`;
    if (todayItems.length > 0) calCtx += `\n${todayItems.join('\n')}`;

    // Also include legacy calendar tasks if any exist
    const legacyTasks = sa(data.tasks?.[today]);
    if (legacyTasks.length > 0) {
      calCtx += `\nScheduled tasks: ${legacyTasks.map(t => `${t.time || '?'}-${t.endTime || '?'} ${t.done ? '✓' : '○'} ${t.title}`).join(', ')}`;
    }

    // ── EXAM HISTORY (filter out 0% entries — likely accidental submits) ──
    let examCtx = '';
    const examHistory = (data.examHistory || []).filter(e => e.score > 0);
    if (examHistory.length > 0) {
      examCtx = '\n\nPRACTICE EXAM HISTORY:';
      const byCourse = {};
      examHistory.forEach(e => {
        const k = e.courseName || e.courseId || 'Unknown';
        if (!byCourse[k]) byCourse[k] = [];
        byCourse[k].push(e);
      });
      for (const [name, exams] of Object.entries(byCourse)) {
        const sorted = exams.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
        const latest = sorted[sorted.length - 1];
        const scores = sorted.slice(-5).map(e => Math.round(e.score * 100) + '%').join(' → ');
        examCtx += `\n${name}: ${scores} (${sorted.length} attempt${sorted.length > 1 ? 's' : ''}, latest: ${Math.round(latest.score * 100)}%, ${latest.difficulty})`;
        if (latest.topicScores) {
          const weak = Object.entries(latest.topicScores).filter(([, v]) => v.total > 0 && v.correct / v.total < 0.7).map(([t, v]) => `${t}: ${Math.round(v.correct / v.total * 100)}%`);
          if (weak.length > 0) examCtx += `\n  Weak topics: ${weak.join(', ')}`;
        }
      }
    }

    // ── SESSION + STUDY STATS ──
    const sessions = data.studySessions || [];
    const totalStudiedMins = sessions.reduce((s, x) => s + (x.mins || 0), 0);
    const streak = data.studyStreak || { currentStreak: 0, longestStreak: 0 };
    let sessionCtx = `\n\nSTUDY STATS: Total: ${Math.round(totalStudiedMins / 6) / 10}h | Streak: ${streak.currentStreak}d (best: ${streak.longestStreak}d)`;
    const pc = data.plannerConfig;
    if (pc) {
      sessionCtx += `\nStudy mode: ${pc.studyMode || 'sequential'} | Pacing: ${pc.pacingStyle || 'steady'}`;
    }

    // ── PLAN HISTORY (recent) ──
    const planHistory = data.planHistory || [];
    if (planHistory.length > 0) {
      const latest = planHistory[planHistory.length - 1];
      sessionCtx += `\nLatest plan: ${new Date(latest.createdAt).toLocaleDateString()} | ${latest.taskCount || '?'} tasks, ${latest.plannedHours || '?'}h`;
    }

    return courseCtx + queueCtx + lpCtx + calCtx + examCtx + sessionCtx;
  };

  const sendMessage = async (overrideMsg) => {
    if (loading) { stopChat(); return; }
    const msg = overrideMsg || input.trim();
    if ((!msg && !imgFile) || !profile) return;
    const controller = new AbortController();
    setChatAbort(controller);
    if (!overrideMsg) setInput("");

    const displayMsg = { role: "user", content: msg, hasImage: !!imgFile };
    const newMsgs = [...messages, displayMsg];
    setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: newMsgs } }));
    setLoading(true);

    const context = buildContext();
    const modePrompt = MODE_PROMPTS[chatMode] || MODE_PROMPTS.tutor;
    const conciseRule = concise ? '\n\nRESPONSE STYLE: Be brief. 2-3 sentences max unless the student asks for more. Use bullet points. Skip preamble and filler.' : '';

    const sys = `${buildSystemPrompt(data, context, selCourse)}

${modePrompt}
${conciseRule}

CONTEXT-AWARE GUIDANCE:
- Reference the student's actual progress and schedule when relevant.
- If they're behind on pace, acknowledge it and help them prioritize.
- Celebrate streaks and milestones — motivation matters.
- Keep responses focused and actionable.`;

    const apiMsgs = newMsgs.filter(m => m.role === "user" || m.role === "assistant").slice(-30).map(m => ({ role: m.role, content: m.content }));

    let imageData = null;
    if (imgFile) {
      const b64 = await fileToBase64(imgFile);
      imageData = { type: imgFile.type, data: b64 };
      setImgFile(null); setImgPrev(null);
    }

    try {
      let resp = await callAIWithTools(profile, sys, apiMsgs, imageData);
      let fullText = "";
      let thinkingText = "";
      let maxLoops = 5;
      while (maxLoops-- > 0) {
        if (controller.signal.aborted) break;
        if (resp.thinking) thinkingText += (thinkingText ? "\n\n" : "") + resp.thinking;
        if (resp.text) fullText += (fullText ? " " : "") + resp.text;
        if (resp.toolCalls.length > 0) {
          const results = executeTools(resp.toolCalls, dataRef.current, setData);
          const toolSummary = results.map(r => `[${r.result}]`).join(" ");
          fullText += (fullText ? "\n\n" : "") + toolSummary;
          resp = await continueAfterTools(profile, sys, apiMsgs, resp.toolCalls, results);
        } else break;
      }
      if (resp.thinking && !thinkingText.includes(resp.thinking)) thinkingText += (thinkingText ? "\n\n" : "") + resp.thinking;
      if (resp.text && !fullText.includes(resp.text)) fullText += (fullText ? "\n\n" : "") + resp.text;

      const withReply = [...newMsgs, { role: "assistant", content: fullText, thinking: thinkingText || undefined }];
      setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: withReply } }));
    } catch (e) {
      if (e.name !== 'AbortError') setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: [...newMsgs, { role: "assistant", content: `Error: ${e.message}` }] } }));
    }
    setLoading(false);
    setChatAbort(null);
  };

  // Compact/condense chat — summarize older messages to reduce context size
  const [compacting, setCompacting] = useState(false);
  const compactChat = async () => {
    if (!profile || messages.length < 6) { toast('Not enough messages to compact', 'info'); return; }
    setCompacting(true);
    try {
      const transcript = messages.map(m => `${m.role === 'user' ? 'Student' : 'AI'}: ${m.content}`).join('\n\n');
      const compactSys = `You are summarizing a study chat conversation. Create a concise summary that preserves:
1. Key topics discussed and concepts explained
2. Questions the student asked and whether they were resolved
3. Any weak areas or misconceptions identified
4. Quiz scores or practice results if any
5. Any action items or scheduled tasks
6. The student's current understanding level on topics discussed

Format as a structured summary the AI can use as context for continuing the conversation. Be thorough but concise.`;

      const resp = await callAIWithTools(profile, compactSys, [{ role: 'user', content: `Summarize this study chat conversation:\n\n${transcript}` }]);
      const summary = resp.text || 'Chat summary unavailable.';

      // Replace all messages with a summary message + keep the last 4 messages for immediate context
      const recentMessages = messages.slice(-4);
      const compactedHistory = [
        { role: 'assistant', content: `**Chat Compacted** — ${messages.length} messages condensed into a summary.\n\n---\n\n**Summary of prior conversation:**\n${summary}\n\n---\n*${messages.length - recentMessages.length} older messages were compacted. Recent messages preserved below.*` },
        ...recentMessages,
      ];
      setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: compactedHistory } }));
      toast(`Compacted ${messages.length} messages → ${compactedHistory.length}`, 'success');
    } catch (e) {
      toast(`Compact failed: ${e.message}`, 'error');
    }
    setCompacting(false);
  };

  // Estimate context size in tokens (~4 chars per token is the standard approximation)
  const contextTokens = useMemo(() => {
    const totalChars = messages.reduce((s, m) => s + (m.content || '').length, 0);
    return Math.round(totalChars / 4);
  }, [messages]);
  const contextTokensK = Math.round(contextTokens / 100) / 10; // e.g. 12.3k

  // Export
  const exportChat = () => {
    const md = messages.map(m => `**${m.role === "user" ? "You" : "AI"}:** ${m.content}`).join("\n\n---\n\n");
    const header = `# Study Chat — ${course ? course.name : "General"}\nExported: ${new Date().toLocaleString()}\nMessages: ${messages.length}\n\n---\n\n`;
    const blob = new Blob([header + md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `vorra-chat-${chatKey}-${todayStr()}.md`; a.click();
    URL.revokeObjectURL(url); toast("Chat exported", "success");
  };

  // Markdown rendering
  const renderMd = (text) => {
    if (!text) return null;
    // Split on code blocks first (safe — rendered as plain text in <pre>)
    const parts = text.split(/(```[\s\S]*?```)/g);
    return parts.map((part, pi) => {
      if (part.startsWith("```")) {
        const code = part.replace(/^```\w*\n?/, "").replace(/```$/, "");
        return <pre key={pi} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 14px", fontSize: fs(11), fontFamily: "'JetBrains Mono',monospace", overflow: "auto", margin: "6px 0", whiteSpace: "pre-wrap" }}>{code}</pre>;
      }
      // Safe React-based inline formatting — NO dangerouslySetInnerHTML
      // Split on bold (**text**) and inline code (`text`) patterns
      const tokens = [];
      const regex = /(\*\*.*?\*\*|`[^`]+`)/g;
      let last = 0;
      let match;
      while ((match = regex.exec(part)) !== null) {
        if (match.index > last) tokens.push({ type: 'text', value: part.slice(last, match.index) });
        const m = match[0];
        if (m.startsWith('**') && m.endsWith('**')) {
          tokens.push({ type: 'bold', value: m.slice(2, -2) });
        } else if (m.startsWith('`') && m.endsWith('`')) {
          tokens.push({ type: 'code', value: m.slice(1, -1) });
        }
        last = match.index + m.length;
      }
      if (last < part.length) tokens.push({ type: 'text', value: part.slice(last) });
      return <span key={pi}>{tokens.map((tok, ti) => {
        if (tok.type === 'bold') return <strong key={ti}>{tok.value}</strong>;
        if (tok.type === 'code') return <code key={ti} style={{ background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4, fontSize: fs(11), fontFamily: "'JetBrains Mono',monospace" }}>{tok.value}</code>;
        return <span key={ti}>{tok.value}</span>;
      })}</span>;
    });
  };

  // Search
  const filteredMessages = useMemo(() => {
    if (!searchQ) return messages;
    const q = searchQ.toLowerCase();
    return messages.filter(m => (m.content || '').toLowerCase().includes(q));
  }, [messages, searchQ]);

  // Quick actions by mode
  const quickActions = useMemo(() => {
    if (!course) return [
      { label: "What should I study?", prompt: "Based on my progress and schedule, what should I focus on right now?" },
      { label: "Am I on track?", prompt: "Look at my study pace and schedule. Am I on track to finish on time? Give specific numbers." },
      { label: "Plan my week", prompt: "Help me plan my study schedule for this week based on my queue and available hours." },
      { label: "Priority order", prompt: "What order should I study my courses in and why? Consider prerequisites and difficulty." },
      { label: "Degree overview", prompt: "Give me a snapshot of where I stand across all courses — hours remaining, courses started, estimated finish." },
      { label: "What's due soon?", prompt: "Do I have any upcoming exams or deadlines? What should I be preparing for?" },
      { label: "Study tips", prompt: "What are the most effective study strategies for my current courses and schedule?" },
      { label: "Burnout check", prompt: "Based on my study patterns and pace, am I at risk of burnout? What should I adjust?" },
    ];
    const name = course.name;
    const code = course.courseCode || '';
    const isOA = (course.assessmentType || '').toLowerCase().includes('oa');
    const isPA = (course.assessmentType || '').toLowerCase().includes('pa');
    const weakAreas = safeArr(course.preAssessmentWeakAreas).join(', ') || 'the hardest topics';
    const actions = {
      tutor: [
        { label: "Explain key concepts", prompt: `What are the most important concepts in ${name}? Help me understand them one at a time.` },
        { label: "Simplify hardest topic", prompt: `What's the hardest topic in ${name}? Explain it with a simple analogy a non-expert would understand.` },
        { label: "Compare & contrast", prompt: `What are the most commonly confused concepts in ${name}? Show me a clear side-by-side comparison.` },
        { label: "Memory tricks", prompt: `Give me effective mnemonics and memory aids for the key facts and concepts in ${name}.` },
        { label: "Real-world examples", prompt: `Give me real-world examples for each major concept in ${name}. How are these used in actual practice?` },
        { label: "Teach me from scratch", prompt: `Pretend I know nothing about ${name}. Start from the absolute basics and build up, step by step.` },
        { label: "Explain like I'm 5", prompt: `Explain the core concept of ${name} in the simplest terms possible, like you're explaining to a child.` },
        { label: "What's the big picture?", prompt: `How does everything in ${name} connect? Give me a high-level map of how all the topics relate to each other.` },
        { label: "Common misconceptions", prompt: `What do students most commonly get wrong in ${name}? Help me avoid those mistakes.` },
        { label: "Why does this matter?", prompt: `Why is ${name} important in the real world? How will I use this knowledge in my career?` },
        { label: "Prerequisite check", prompt: `What should I already know before diving into ${name}? Test my prerequisite knowledge.` },
        { label: "Create flashcards", prompt: `Create 10 flashcard-style Q&A pairs for the most important facts in ${name}. Front: question. Back: answer.` },
      ],
      quiz: [
        { label: "Quiz me (5 Q)", prompt: `Give me 5 practice questions for ${name}. Wait for my answer before revealing the correct one.` },
        { label: "Quiz me (10 Q)", prompt: `Give me 10 practice questions for ${name} covering different topics. Grade me as I go.` },
        { label: "Scenario question", prompt: `Give me an application-level scenario question for ${name} matching the ${isOA ? 'OA' : isPA ? 'PA' : 'assessment'} format.` },
        { label: "Rapid fire", prompt: `Ask me 10 rapid-fire questions about ${name}. One at a time, quick pace. Grade me at the end.` },
        { label: "Weak area drill", prompt: `Quiz me specifically on my weak areas in ${name}: ${weakAreas}. Focus on the topics I'm struggling with.` },
        { label: "True or false", prompt: `Give me 10 true/false statements about ${name}. Include common misconceptions as traps.` },
        { label: "Fill in the blank", prompt: `Give me 8 fill-in-the-blank questions for key definitions and concepts in ${name}.` },
        { label: "Match concepts", prompt: `Give me a matching exercise: 8 terms on the left, 8 definitions on the right for ${name}. Let me match them.` },
        { label: "Explain it back", prompt: `Ask me to explain a key concept from ${name} in my own words, then evaluate if my understanding is correct.` },
        { label: "Multi-select practice", prompt: `Give me 5 "select ALL that apply" questions for ${name} — the hardest format. Grade strictly.` },
        { label: "Exam simulation", prompt: `Simulate a mini-exam: 10 questions, mixed difficulty, timed feel. ${isOA ? 'Match OA format.' : isPA ? 'Focus on concepts I need for the PA.' : ''} Grade at the end with per-topic breakdown.` },
        { label: "Competency check", prompt: `Test me on each competency area of ${name}. One question per competency. Tell me which ones I pass and which need work.` },
      ],
      plan: [
        { label: "What's next?", prompt: "Based on my task queue and progress, what should I study next and why?" },
        { label: "Am I on track?", prompt: "Am I on track to finish on time? Show me the math — hours remaining vs days remaining vs daily pace." },
        { label: "Optimize my week", prompt: "Look at my schedule and queue. Are there gaps? Am I spending too much or too little on any topic?" },
        { label: "Catch-up plan", prompt: "I've fallen behind. Give me a concrete, specific catch-up plan for the next 3 days with exact tasks." },
        { label: "When will I finish?", prompt: `At my current pace, when will I finish ${name}? And when will I finish all courses?` },
        { label: "Rebalance courses", prompt: "Look at my time allocation across courses. Should I rebalance? Am I over-investing or under-investing anywhere?" },
        { label: "Prep for exam", prompt: `Help me plan my ${isOA ? 'OA' : isPA ? 'PA' : 'assessment'} preparation for ${name}. When should I take the pre-assessment? When should I schedule the exam?` },
        { label: "Weekend plan", prompt: "I have extra time this weekend. What should I focus on to make the most impact?" },
        { label: "Daily breakdown", prompt: "Break down today's study plan into specific time blocks with topics and techniques for each block." },
        { label: "Milestone check", prompt: `Where should I be this week according to the lesson plan milestones for ${name}? Am I ahead or behind?` },
      ],
      coach: [
        { label: "Check my progress", prompt: "Give me honest, data-driven feedback on my study progress. Don't sugarcoat it — be direct." },
        { label: "Motivate me", prompt: `I'm losing motivation on ${name}. Give me a concrete micro-goal for the next 30 minutes that I can definitely achieve.` },
        { label: "I'm stuck", prompt: `I'm stuck on ${name} and frustrated. Help me break through — suggest a different approach or angle.` },
        { label: "Celebrate wins", prompt: "What have I accomplished recently? Remind me how far I've come with specific numbers." },
        { label: "Accountability check", prompt: "Hold me accountable. Did I hit my targets this week? What did I miss and what should I do about it?" },
        { label: "Energy management", prompt: "Based on my schedule and study patterns, when are my best focus hours? How should I structure my day?" },
        { label: "Overcome procrastination", prompt: "I keep putting off studying. Give me a specific, no-excuses plan to start in the next 5 minutes." },
        { label: "Confidence boost", prompt: `Am I ready for the ${isOA ? 'OA' : isPA ? 'PA' : 'assessment'} in ${name}? Rate my readiness honestly and tell me what to do if I'm not ready.` },
        { label: "Rest day?", prompt: "Should I take a rest day today? Based on my streak and recent study load, would a break help or hurt?" },
        { label: "Weekly reflection", prompt: "Help me reflect on my study week. What went well? What didn't? What should I change next week?" },
      ],
    };
    return actions[chatMode] || actions.tutor;
  }, [course, chatMode]);

  // Session divider check
  const getSessionDivider = (idx) => {
    if (idx === 0) return null;
    const prev = messages[idx - 1];
    const curr = messages[idx];
    // Simple heuristic: if there's a gap in messages (checked via content patterns)
    // For now, just show divider at the start of the conversation
    return null;
  };

  // Follow-up suggestions based on last AI message
  const followUpSuggestions = useMemo(() => {
    if (messages.length === 0 || loading) return [];
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return [];
    const base = chatMode === 'quiz'
      ? [{ label: "Next question", prompt: "Give me another question." }, { label: "Explain why", prompt: "Explain why that answer is correct and why the others are wrong." }, { label: "Harder question", prompt: "Give me a harder question on the same topic." }, { label: "Different topic", prompt: "Switch to a different topic and quiz me." }]
      : chatMode === 'tutor'
      ? [{ label: "Tell me more", prompt: "Can you explain that in more detail?" }, { label: "Give an example", prompt: "Can you give me a concrete, real-world example?" }, { label: "Quiz me on this", prompt: "Quiz me on what we just discussed to check my understanding." }, { label: "Simpler please", prompt: "That was too complex. Can you simplify it?" }]
      : chatMode === 'coach'
      ? [{ label: "What's my next step?", prompt: "What exactly should I do right now? Be specific." }, { label: "Set a goal", prompt: "Set me a specific, measurable study goal for today." }, { label: "How am I doing?", prompt: "Give me a quick progress check with numbers." }]
      : [{ label: "Show my schedule", prompt: "Show me what's on my schedule today and this week." }, { label: "Reschedule", prompt: "I need to adjust my plan. What can I move around?" }, { label: "What's realistic?", prompt: "Given my current pace, what can I realistically accomplish this week?" }];
    return base;
  }, [messages, loading, chatMode]);

  // Course progress for context bar
  const courseProgress = useMemo(() => {
    if (!course) return null;
    const queue = data.taskQueue || [];
    const code = (course.courseCode || '').toUpperCase();
    const total = queue.filter(t => (t.course_code || '').toUpperCase() === code && t.category !== 'break').length;
    const done = queue.filter(t => (t.course_code || '').toUpperCase() === code && t.done && t.category !== 'break').length;
    return total > 0 ? { total, done, pct: Math.round(done / total * 100) } : null;
  }, [course, data.taskQueue]);

  const modeColors = { tutor: T.blue, quiz: T.purple, plan: T.accent, coach: '#f59e0b' };
  const modeIcons = { tutor: '📚', quiz: '🎯', plan: '📅', coach: '💪' };
  const modeLabels = { tutor: 'Tutor', quiz: 'Quiz', plan: 'Plan', coach: 'Coach' };

  return (
    <div className="fade" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexShrink: 0 }}>
        <div>
          <h1 style={{ fontSize: fs(22), fontWeight: 800, marginBottom: 1 }}>Study Chat</h1>
          <p style={{ color: T.dim, fontSize: fs(10), margin: 0 }}>AI study companion · {modeLabels[chatMode]} mode</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select value={selCourse} onChange={e => setSelCourse(e.target.value)} style={{ width: 200, fontSize: fs(11), padding: '6px 8px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.input, color: T.text }}>
            <option value="">General Help</option>
            {(data.courses || []).map(c => <option key={c.id} value={c.id}>{c.courseCode ? `${c.courseCode} — ` : ''}{c.name} {hasCtx(c) ? "✓" : ""}</option>)}
          </select>
          {messages.length > 0 && <Btn small v="ghost" onClick={exportChat} title="Export chat as markdown">📋</Btn>}
          {messages.length >= 6 && <Btn small v="ghost" onClick={compactChat} disabled={compacting} title={`Condense ${messages.length} messages into a summary to reduce context size (~${contextTokensK}k tokens). Keeps the last 4 messages.`}>{compacting ? '⏳' : '⚡'} Compact</Btn>}
          <Btn small v="ghost" onClick={() => setData(d => ({ ...d, chatHistories: { ...d.chatHistories, [chatKey]: [] } }))} title="Clear all messages">Clear</Btn>
        </div>
      </div>

      {/* Mode selector + concise toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0 }}>
        <div style={{ display: 'flex', background: T.input, borderRadius: 8, padding: 2, flex: '0 0 auto' }}>
          {Object.entries(modeLabels).map(([key, label]) => (
            <button key={key} onClick={() => setChatMode(key)} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
              background: chatMode === key ? modeColors[key] : 'transparent',
              color: chatMode === key ? '#fff' : T.soft,
              fontWeight: chatMode === key ? 700 : 500, fontSize: fs(10), transition: 'all .12s',
            }}>{modeIcons[key]} {label}</button>
          ))}
        </div>
        <button onClick={() => setConcise(!concise)} title={concise ? 'Concise mode: AI gives short, bullet-point answers (2-3 sentences). Click to switch to detailed responses.' : 'Detailed mode: AI gives full explanations with examples and context. Click to switch to concise, brief answers.'} style={{
          padding: '5px 12px', borderRadius: 6, fontSize: fs(9), cursor: 'pointer',
          border: `1px solid ${concise ? T.accent : T.border}`, background: concise ? T.accentD : 'transparent',
          color: concise ? T.accent : T.dim, fontWeight: 600,
        }}>{concise ? 'Concise' : 'Detailed'}</button>
      </div>

      {/* Enhanced context bar */}
      {course && (
        <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, padding: '8px 14px', marginBottom: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: fs(12), fontWeight: 700, color: T.text }}>{course.courseCode || ''} {course.name}</span>
            <Badge color={STATUS_C[course.status] || T.dim} bg={(STATUS_C[course.status] || T.dim) + "22"}>{STATUS_L[course.status] || course.status}</Badge>
            {course.assessmentType && <Badge color={T.blue} bg={T.blueD}>{course.assessmentType}</Badge>}
            {course.examDate && <Badge color={T.red} bg={`${T.red}22`}>{Math.max(0, diffDays(todayStr(), course.examDate))}d to exam</Badge>}
            {courseProgress && <span style={{ fontSize: fs(9), color: T.dim, marginLeft: 'auto' }}>{courseProgress.pct}% · {courseProgress.done}/{courseProgress.total} tasks</span>}
          </div>
          {/* Progress bar */}
          {courseProgress && (
            <div style={{ height: 3, borderRadius: 2, background: T.input, overflow: 'hidden', marginTop: 4 }}>
              <div style={{ height: '100%', width: `${courseProgress.pct}%`, background: T.accent, borderRadius: 2, transition: 'width .3s' }} />
            </div>
          )}
          {/* Weak areas */}
          {safeArr(course.preAssessmentWeakAreas).length > 0 && (
            <div style={{ fontSize: fs(9), color: T.orange, marginTop: 4 }}>Weak areas: {safeArr(course.preAssessmentWeakAreas).join(', ')}</div>
          )}
        </div>
      )}

      {/* Expandable context drawer — always visible regardless of course selection */}
      <button onClick={() => setShowContext(!showContext)} style={{ background: 'none', border: 'none', color: T.dim, fontSize: fs(10), cursor: 'pointer', marginBottom: 6, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: fs(10), transition: 'transform .2s', transform: showContext ? 'rotate(90deg)' : 'rotate(0)', display: 'inline-block' }}>▶</span>
        {showContext ? 'Hide AI context' : 'What the AI knows'}
      </button>
      {showContext && (
        <div style={{ fontSize: fs(10), color: T.dim, marginBottom: 8, padding: '8px 12px', background: T.bg2, borderRadius: 8, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto', lineHeight: 1.5, border: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 700, color: T.soft, marginBottom: 4 }}>System Prompt (base):</div>
          {buildSystemPrompt(data, '', selCourse)}
          <div style={{ fontWeight: 700, color: T.soft, marginTop: 8, marginBottom: 4 }}>Mode: {chatMode}</div>
          {MODE_PROMPTS[chatMode] || ''}
          <div style={{ fontWeight: 700, color: T.soft, marginTop: 8, marginBottom: 4 }}>Per-message context:</div>
          {buildContext()}
        </div>
      )}

      {!profile && <div style={{ padding: "40px 0", textAlign: "center", color: T.dim }}><p style={{ fontSize: fs(13) }}>Connect an AI profile in Settings to start chatting.</p></div>}

      {/* Context size warning */}
      {contextTokens > 64000 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', marginBottom: 6, borderRadius: 8, background: contextTokens > 200000 ? `${T.red}15` : `${T.orange}15`, border: `1px solid ${contextTokens > 200000 ? T.red : T.orange}33`, flexShrink: 0 }}>
          <span style={{ fontSize: fs(10), color: contextTokens > 200000 ? T.red : T.orange, fontWeight: 600 }}>
            {contextTokens > 200000 ? '⚠️' : '💡'} Chat context: ~{contextTokensK}k tokens ({messages.length} messages)
            {contextTokens > 200000 ? ' — context is very large, responses may degrade.' : ' — consider compacting to keep responses sharp.'}
          </span>
          <button onClick={compactChat} disabled={compacting} style={{ padding: '3px 10px', borderRadius: 5, border: `1px solid ${T.accent}`, background: T.accentD, color: T.accent, fontSize: fs(9), cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
            {compacting ? 'Compacting...' : '⚡ Compact now'}
          </button>
        </div>
      )}

      {/* Search */}
      {profile && messages.length > 3 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexShrink: 0 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: '0 10px', gap: 6 }}>
            <Ic.IcSearch s={12} c={T.dim} />
            <input value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="Search messages..." style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: T.text, fontSize: fs(11), padding: '6px 0' }} />
            {searchQ && <button onClick={() => setSearchQ('')} style={{ background: 'none', border: 'none', color: T.dim, cursor: 'pointer' }}><Ic.X s={10} /></button>}
          </div>
        </div>
      )}

      {/* Messages */}
      {profile && <div style={{ flex: 1, overflowY: "auto", marginBottom: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ padding: "16px 0", color: T.dim }}>
            <p style={{ marginBottom: 12, textAlign: "center", fontSize: fs(13) }}>
              {chatMode === 'quiz' ? `Ready to test your knowledge on ${course?.name || 'your courses'}?` :
               chatMode === 'plan' ? 'Let me help you plan your study schedule.' :
               chatMode === 'coach' ? 'Let me check your progress and keep you on track.' :
               `Ask about ${course ? course.name : "anything"}.`}
            </p>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
              {quickActions.map((q, i) => (
                <button key={i} onClick={() => sendMessage(q.prompt)} style={{
                  background: T.input, border: `1px solid ${modeColors[chatMode]}33`, borderRadius: 8,
                  padding: "8px 14px", color: T.soft, fontSize: fs(11), cursor: "pointer", fontWeight: 500,
                  transition: 'all .12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = modeColors[chatMode]; e.currentTarget.style.color = T.text; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = `${modeColors[chatMode]}33`; e.currentTarget.style.color = T.soft; }}
                >{q.label}</button>
              ))}
            </div>
          </div>
        )}
        {filteredMessages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "78%", padding: "10px 14px", borderRadius: 12, fontSize: fs(13), lineHeight: 1.6,
              background: m.role === "user" ? T.accent : T.card,
              color: m.role === "user" ? "#060e09" : T.text,
              border: m.role === "user" ? "none" : `1px solid ${T.border}`, whiteSpace: "pre-wrap",
            }}>
              {m.hasImage && <span style={{ fontSize: fs(10), opacity: .7 }}>📷 Image attached<br /></span>}
              {/* Collapsible thinking block */}
              {m.thinking && <ThinkingBlock thinking={m.thinking} T={T} />}
              {m.role === "assistant" ? renderMd(m.content) : m.content}
            </div>
          </div>
        ))}
        {/* "Just tell me" escape in Tutor mode */}
        {chatMode === 'tutor' && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !loading && messages[messages.length - 1]?.content?.includes('?') && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: -4 }}>
            <button onClick={() => sendMessage("Just tell me the answer directly.")} style={{
              padding: '4px 12px', borderRadius: 12, border: `1px solid ${T.border}`,
              background: T.input, color: T.dim, fontSize: fs(9), cursor: 'pointer',
            }}>Just tell me</button>
          </div>
        )}
        {loading && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", color: modeColors[chatMode], fontSize: fs(12) }}>
          <Ic.Spin s={14} />
          {chatMode === 'quiz' ? 'Preparing question...' : chatMode === 'plan' ? 'Checking your schedule...' : chatMode === 'coach' ? 'Analyzing your progress...' : 'Thinking...'}
        </div>}
        <div ref={messagesEnd} />
      </div>}

      {/* Follow-up suggestion chips */}
      {profile && followUpSuggestions.length > 0 && messages.length > 0 && !loading && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0, marginBottom: 6, overflowX: "auto", paddingBottom: 2 }}>
          {followUpSuggestions.map((q, i) => (
            <button key={i} onClick={() => sendMessage(q.prompt)} style={{
              background: T.input, border: `1px solid ${modeColors[chatMode]}33`, borderRadius: 7,
              padding: "5px 12px", color: T.dim, fontSize: fs(10), cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
            }}>{q.label}</button>
          ))}
        </div>
      )}

      {/* Image preview */}
      {imgPrev && <div style={{ padding: "4px 0", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
        <img src={imgPrev} style={{ height: 40, borderRadius: 6, border: `1px solid ${T.border}` }} alt="upload" />
        <span style={{ fontSize: fs(9), color: T.soft }}>{imgFile?.name}</span>
        <button onClick={() => { setImgFile(null); setImgPrev(null); }} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer" }}><Ic.X s={12} /></button>
      </div>}

      {/* Input bar */}
      {profile && <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        <button onClick={() => fileRef.current?.click()} style={{ background: T.input, border: `1px solid ${T.border}`, borderRadius: 8, padding: "0 12px", cursor: "pointer", color: T.soft, display: "flex", alignItems: "center" }}><Ic.Img s={14} /></button>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImg} />
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()} placeholder={`${chatMode === 'quiz' ? 'Answer or ask for a question' : chatMode === 'plan' ? 'Ask about scheduling' : chatMode === 'coach' ? 'Check in on progress' : `Ask about ${course ? course.name : "studying"}`}...`} style={{ flex: 1, padding: "10px 14px", fontSize: fs(13), borderRadius: 8, border: `1px solid ${T.border}`, background: T.input, color: T.text }} />
        <Btn onClick={() => sendMessage()} disabled={!loading && (!input.trim() && !imgFile)} style={{ padding: "10px 18px", background: loading ? T.red : modeColors[chatMode] }}>{loading ? <span style={{ fontSize: fs(11), fontWeight: 700 }}>Stop</span> : <Ic.Send s={14} />}</Btn>
      </div>}
      <div style={{ fontSize: fs(8), color: T.dim, textAlign: "center", padding: "3px 0 0", flexShrink: 0 }}>AI responses are not a substitute for your course materials or instructor.</div>
    </div>
  );
};

export default StudyChatPage;
